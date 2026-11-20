// Ablation: replay a recording with every cue on, then with each cue off,
// and print one Markdown table. Usage:
//   npm run ablation                       (bundled fixture)
//   RECORDING=path/to/session.jsonl npm run ablation
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { parseRecording, Replayer } from '../../src/sensing/replay';
import { Engine } from '../../src/turn/engine';
import type { CueName } from '../../src/turn/events';

const file = process.env.RECORDING ?? fileURLToPath(new URL('../../fixtures/sessions/probe-protocol.jsonl', import.meta.url));

test('ablation', () => {
  const text = readFileSync(file, 'utf8');
  const variants: { label: string; off: CueName[] }[] = [
    { label: 'all cues', off: [] },
    { label: 'no lips', off: ['lips'] },
    { label: 'no talking', off: ['talking'] },
    { label: 'no breath', off: ['breath'] },
    { label: 'no head', off: ['head'] },
    { label: 'no camera cues', off: ['lips', 'talking', 'breath', 'head'] },
  ];
  const rows: string[] = [];
  for (const v of variants) {
    const rec = parseRecording(text);
    const enabled = { lips: true, head: true, breath: true, talking: true };
    for (const c of v.off) enabled[c] = false;
    const engine = new Engine({ oracle: true, micEnabled: rec.header?.micEnabled ?? true, cameraEnabled: rec.header?.cameraEnabled ?? true, arbiter: { enabled } });
    new Replayer(rec, engine).runAll();
    const s = engine.results.summary();
    const htf = s.policies[0]!;
    const h = s.holdsByCue;
    rows.push(
      `| ${v.label} | ${s.turns} | ${htf.cutoffs} | ${htf.premature ?? '—'} | ${htf.medianDelayMs === null ? '—' : (htf.medianDelayMs / 1000).toFixed(2) + ' s'} | ${h.lips}/${h.talking}/${h.breath}/${h.head} |`,
    );
    if (v.off.length === 0) {
      rows.unshift(
        ...s.policies.slice(1).map((p) => `| (${p.label}) | ${s.turns} | ${p.cutoffs} | ${p.premature ?? '—'} | ${((p.medianDelayMs ?? 0) / 1000).toFixed(2)} s | — |`),
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    [`Ablation on ${basename(file)}`, '', '| Variant | Turns | Cut-offs | Premature ends | Median reply delay | Holds lips/talk/breath/head |', '| --- | ---: | ---: | ---: | ---: | --- |', ...rows].join('\n'),
  );
});
