// Replays the bundled real recording (Stage 1 protocol run) through the
// engine in oracle mode, where every policy is shadowed. Each 2.5 s
// count-pause-inhale cycle is a mid-turn pause.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRecording, Replayer } from '../../src/sensing/replay';
import { Engine } from '../../src/turn/engine';
import type { CueName, TurnEvent } from '../../src/turn/events';

const FIXTURE = new URL('../../fixtures/sessions/probe-protocol.jsonl', import.meta.url);

export function replayFixture(disabled: CueName[] = []) {
  const rec = parseRecording(readFileSync(FIXTURE, 'utf8'));
  const enabled = { lips: true, head: true, breath: true, talking: true };
  for (const c of disabled) enabled[c] = false;
  const engine = new Engine({ oracle: true, micEnabled: true, cameraEnabled: true, arbiter: { enabled } });
  const events: TurnEvent[] = [];
  engine.on((e) => {
    if (e.type !== 'mic.edge') events.push(e);
  });
  new Replayer(rec, engine).runAll();
  return { engine, events, rec, summary: engine.results.summary() };
}

describe('replay of the recorded protocol run', () => {
  it('parses the fixture and calibrates from its rest/press steps', () => {
    const { rec, engine } = replayFixture();
    expect(rec.isProbe).toBe(true);
    expect(rec.inputs.length).toBeGreaterThan(20000);
    const cal = engine.calibrationResult!;
    expect(cal.lips).not.toBeNull();
    expect(cal.head).not.toBeNull();
    expect(cal.mic.floorDb).toBeLessThan(-55);
  });

  it('is deterministic: two replays give identical events', () => {
    const a = replayFixture().events.map((e) => JSON.stringify(e));
    const b = replayFixture().events.map((e) => JSON.stringify(e));
    expect(a).toEqual(b);
  });

  it('Hold the Floor cuts off far fewer of the 2.5 s pauses than the 2 s timer', () => {
    const { summary } = replayFixture();
    const by = Object.fromEntries(summary.policies.map((p) => [p.policy, p]));
    // eslint-disable-next-line no-console
    console.log(
      'replay summary:',
      summary.policies.map((p) => `${p.label}: ${p.cutoffs} cut-offs, ${p.premature} premature, median delay ${p.medianDelayMs}`).join(' | '),
      '| holds',
      JSON.stringify(summary.holdsByCue),
    );
    // Every 2.5 s protocol pause is longer than 0.7 s and 2 s: those timers
    // end early in (nearly) every cycle.
    expect(by['fixed-700']!.premature).toBeGreaterThanOrEqual(24);
    expect(by['fixed-2000']!.premature).toBeGreaterThanOrEqual(20);
    expect(by['fixed-2000']!.cutoffs).toBeGreaterThanOrEqual(15);
    expect(by['hold-the-floor']!.cutoffs).toBeLessThan(by['fixed-2000']!.cutoffs);
    expect(by['hold-the-floor']!.medianDelayMs!).toBeLessThan(1000);
  });
});

describe('agent lines across recording versions', () => {
  const hdr = (v: number) => JSON.stringify({ k: 'hdr', v, app: 'hold-the-floor', created: '', oracle: false, micEnabled: true, cameraEnabled: true, settings: {} });

  it('v1: the queued question shows at once; the agent starts speaking 300 ms later', () => {
    const rec = parseRecording([hdr(1), JSON.stringify({ k: 'agent', t: 1000, speaking: true, text: 'Q?' }), JSON.stringify({ k: 'agent', t: 4000, speaking: false })].join('\n'));
    expect(rec.inputs.map((x) => [x.t, x.line])).toEqual([
      [1000, { k: 'agent', t: 1000, text: 'Q?' }],
      [1300, { k: 'agent', t: 1300, speaking: true }],
      [4000, { k: 'agent', t: 4000, speaking: false }],
    ]);
  });

  it('v2: lines are used as recorded', () => {
    const lines = [
      { k: 'agent', t: 1000, text: 'Q?' },
      { k: 'agent', t: 1390, speaking: true },
    ];
    const rec = parseRecording([hdr(2), ...lines.map((l) => JSON.stringify(l))].join('\n'));
    expect(rec.inputs.map((x) => x.line)).toEqual(lines);
  });
});

describe('replay of the bundled live demo session', () => {
  it('reproduces the decisions the live engine made', () => {
    const rec = parseRecording(readFileSync(new URL('../../fixtures/sessions/demo-session.jsonl', import.meta.url), 'utf8'));
    const engine = new Engine({ oracle: rec.header?.oracle ?? true, micEnabled: true, cameraEnabled: true });
    const ends: { turn: number; reason: string; silenceMs: number }[] = [];
    const cutoffs: string[] = [];
    engine.on((e) => {
      if (e.type === 'turn.end' && e.policy === 'hold-the-floor') ends.push({ turn: e.turn, reason: e.reason, silenceMs: e.silenceMs });
      if (e.type === 'shadow.cutoff') cutoffs.push(`${e.policy}@${e.turn}`);
    });
    new Replayer(rec, engine).runAll();
    // Live debug log of the same run: turn, reason, silence before the reply.
    const live = [
      [1, 'cues-relaxed', 868.9],
      [2, 'cues-relaxed', 914.7],
      [3, 'no-cue', 720.4],
      [4, 'cues-relaxed', 1863.5],
      [5, 'no-cue', 1547.8],
      [6, 'cues-relaxed', 1009.8],
    ] as const;
    expect(ends.map((e) => [e.turn, e.reason])).toEqual(live.map(([turn, reason]) => [turn, reason]));
    // Within two engine ticks of the live timing.
    ends.forEach((e, i) => expect(Math.abs(e.silenceMs - live[i]![2])).toBeLessThan(70));
    // Live counted these minus fixed-700@4: you resumed 2.46 s after that
    // timer fired, but the mic edge reached the engine after a tick had
    // already discarded it. Ticks no longer discard pending timer ends.
    expect(cutoffs).toEqual(['fixed-700@3', 'fixed-2000@3', 'fixed-700@4', 'fixed-2000@4', 'fixed-3000@4']);
  });
});
