#!/usr/bin/env node
// Turns a probe log or a saved session into a replay fixture with only the
// numbers the engine reads. Drops the full face mesh, device names, camera
// IDs and settings dumps.
//
// Usage: node scripts/make-fixture.mjs <in.jsonl> <out.jsonl> [--label "text"]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: node scripts/make-fixture.mjs <in.jsonl> <out.jsonl> [--label "text"]');
  process.exit(1);
}
const labelIdx = rest.indexOf('--label');
const label = labelIdx >= 0 ? rest[labelIdx + 1] : 'Recorded session';

const KEEP = new Set(['m', 'v', 'e', 'a', 'p', 'started', 'sdk', 'agent', 'cal', 'act']);
const out = [];
let src = null;
for (const raw of readFileSync(inPath, 'utf8').split(/\r?\n/)) {
  if (!raw.trim()) continue;
  const l = JSON.parse(raw);
  if (l.k === 'hdr') {
    src = l;
    continue;
  }
  if (!KEEP.has(l.k)) continue;
  if (l.k === 'm') {
    delete l.full;
    delete l.pt;
    for (const x of l.lm ?? []) {
      delete x.full;
      delete x.n;
    }
  }
  if (l.k === 'v') delete l.ts;
  out.push(JSON.stringify(l));
}
// A saved session keeps its own modes; a probe log replays as one oracle turn.
const header = {
  k: 'hdr',
  v: 1,
  app: 'hold-the-floor',
  created: new Date().toISOString(),
  oracle: src ? !!src.oracle : true,
  micEnabled: src ? src.micEnabled !== false : true,
  cameraEnabled: src ? src.cameraEnabled !== false : true,
  settings: { label, source: src ? 'session' : 'stage-1-probe' },
};
writeFileSync(outPath, [JSON.stringify(header), ...out].join('\n') + '\n');
console.log(`wrote ${out.length + 1} lines to ${outPath}`);
