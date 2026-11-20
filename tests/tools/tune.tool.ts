// Threshold tuning on a saved live session (numbers only). Replays it with
// each variant, with Hold the Floor's decisions shadowed, and scores every
// answer against what actually happened. The true end of an answer is your
// last speech before the agent spoke again; a premature end is a decision in
// a pause after which you kept talking.
//   RECORDING=<saved session.jsonl> npm run tune
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { test } from 'vitest';
import { THRESHOLDS } from '../../config/thresholds';
import { parseRecording, Replayer } from '../../src/sensing/replay';
import { Engine } from '../../src/turn/engine';
import type { CueName } from '../../src/turn/events';

type Knobs = { pressMinMargin: number; pressAnchor: number | null; listenWeight: number; pressMinDepth: number };

const VARIANTS: { label: string; knobs: Knobs }[] = [
  { label: 'old: 0.03 margin, 50/50', knobs: { pressMinMargin: 0.03, pressAnchor: null, listenWeight: 0.5, pressMinDepth: 0 } },
  { label: 'rest − 3 MAD, 50/50', knobs: { pressMinMargin: 0.006, pressAnchor: null, listenWeight: 0.5, pressMinDepth: 0 } },
  { label: 'anchor 0.35, 50/50', knobs: { pressMinMargin: 0.006, pressAnchor: 0.35, listenWeight: 0.5, pressMinDepth: 0 } },
  { label: 'anchor 0.35, 50/50, min depth 0.05', knobs: { pressMinMargin: 0.006, pressAnchor: 0.35, listenWeight: 0.5, pressMinDepth: 0.05 } },
  { label: 'anchor 0.35, listening, min depth 0.05', knobs: { pressMinMargin: 0.006, pressAnchor: 0.35, listenWeight: 1, pressMinDepth: 0.05 } },
  { label: 'anchor 0.25, listening, min depth 0.05', knobs: { pressMinMargin: 0.006, pressAnchor: 0.25, listenWeight: 1, pressMinDepth: 0.05 } },
  { label: 'anchor 0.5, listening, min depth 0.05', knobs: { pressMinMargin: 0.006, pressAnchor: 0.5, listenWeight: 1, pressMinDepth: 0.05 } },
  { label: 'pressed cue off', knobs: { pressMinMargin: 0.006, pressAnchor: 0.35, listenWeight: 0.5, pressMinDepth: 1 } },
];

function score(text: string, knobs: Knobs) {
  Object.assign(THRESHOLDS.lips as unknown as Knobs, knobs);
  const rec = parseRecording(text);
  const engine = new Engine({ oracle: true, micEnabled: rec.header?.micEnabled ?? true, cameraEnabled: rec.header?.cameraEnabled ?? true });
  const starts: number[] = [];
  const ends: number[] = [];
  const decisions: number[] = [];
  const holds: Record<CueName, number> = { lips: 0, talking: 0, breath: 0, head: 0 };
  engine.on((e) => {
    if (e.type === 'mic.edge') (e.kind === 'speech-start' ? starts : ends).push(e.t);
    else if (e.type === 'shadow.end' && (e.policy === 'hold-the-floor' || e.policy === 'fallback-timer')) decisions.push(e.t);
    else if (e.type === 'turn.hold') holds[e.cue]++;
  });
  new Replayer(rec, engine).runAll();
  // Answer windows: agent finished → agent starts again. Skip the warm-up.
  const agent = rec.inputs
    .filter((x) => x.line.k === 'agent' && typeof (x.line as { speaking?: boolean }).speaking === 'boolean')
    .map((x) => ({ t: x.t, on: (x.line as { speaking: boolean }).speaking }));
  const windows: [number, number][] = [];
  for (let i = 0; i < agent.length; i++) {
    if (agent[i]!.on) continue;
    const next = agent.slice(i + 1).find((a) => a.on);
    if (next) windows.push([agent[i]!.t, next.t]);
  }
  let premature = 0;
  const delays: number[] = [];
  let censored = 0;
  for (const [a, b] of windows.slice(1)) {
    const lastEnd = ends.filter((t) => t > a && t < b).at(-1);
    if (lastEnd === undefined) continue;
    for (const d of decisions.filter((t) => t > a && t < b)) if (starts.some((s) => s > d && s < b)) premature++;
    const first = decisions.find((t) => t >= lastEnd && t < b);
    if (first !== undefined) delays.push(first - lastEnd);
    else {
      censored++;
      delays.push(b - lastEnd);
    }
  }
  const sorted = [...delays].sort((x, y) => x - y);
  const med = sorted.length ? (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2 : NaN;
  return { answers: delays.length, premature, med, delays: sorted, censored, holds };
}

test('tune', () => {
  const file = process.env.RECORDING;
  if (!file) throw new Error('Set RECORDING to a saved session .jsonl');
  const text = readFileSync(file, 'utf8');
  const rows = VARIANTS.map((v) => {
    const r = score(text, v.knobs);
    const h = r.holds;
    return `| ${v.label} | ${r.answers} | ${r.premature} | ${(r.med / 1000).toFixed(2)} s | ${r.delays.map((d) => (d / 1000).toFixed(1)).join(' ')}${r.censored ? ` (${r.censored} undecided)` : ''} | ${h.lips}/${h.talking}/${h.breath}/${h.head} |`;
  });
  // eslint-disable-next-line no-console
  console.log(
    [`Tuning on ${basename(file)}`, '', '| Variant | Answers | Premature ends | Median reply | Reply delays (s) | Holds lips/talk/breath/head |', '| --- | ---: | ---: | ---: | --- | --- |', ...rows].join('\n'),
  );
});
