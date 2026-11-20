import { describe, expect, it } from 'vitest';
import { TurnArbiter, defaultArbiterConfig, type CueInput } from '../../src/turn/arbiter';
import type { CueName, TurnEvent } from '../../src/turn/events';

const none: Record<CueName, boolean> = { lips: false, head: false, breath: false, talking: false };
const detail: Record<CueName, string> = { lips: 'set', head: 'turned', breath: 'breathing in', talking: 'talking' };
const cues = (on: Partial<Record<CueName, boolean>> = {}, cameraOk = true): CueInput => ({ active: { ...none, ...on }, detail, cameraOk });

/** Advance in 10 ms steps, collecting events. */
function run(a: TurnArbiter, from: number, to: number, input: CueInput | ((t: number) => CueInput)): TurnEvent[] {
  const ev: TurnEvent[] = [];
  for (let t = from; t <= to; t += 10) ev.push(...a.tick(t, typeof input === 'function' ? input(t) : input));
  return ev;
}

function speakingArbiter(cfg = {}): TurnArbiter {
  const a = new TurnArbiter({ ...defaultArbiterConfig(), ...cfg });
  a.agentFinished(0);
  a.speechStart(100);
  a.speechEnd(1000); // silence starts at 1000
  return a;
}

describe('TurnArbiter transitions', () => {
  it('AGENT → WAITING on agent finished, and ignores speech while the agent talks', () => {
    const a = new TurnArbiter();
    expect(a.state).toBe('AGENT');
    expect(a.speechStart(10)).toEqual([]);
    expect(a.state).toBe('AGENT');
    a.agentFinished(20);
    expect(a.state).toBe('WAITING');
    expect(a.turn).toBe(1);
  });

  it('WAITING never ends on silence before the user has spoken', () => {
    const a = new TurnArbiter();
    a.agentFinished(0);
    expect(run(a, 0, 20000, cues())).toEqual([]);
    expect(a.state).toBe('WAITING');
  });

  it('WAITING → LISTENING on speech', () => {
    const a = new TurnArbiter();
    a.agentFinished(0);
    a.speechStart(50);
    expect(a.state).toBe('LISTENING');
  });

  it('LISTENING stays while speaking, → CANDIDATE_END at 400 ms of silence', () => {
    const a = speakingArbiter();
    run(a, 1000, 1390, cues());
    expect(a.state).toBe('LISTENING');
    a.tick(1400, cues());
    expect(a.state).toBe('CANDIDATE_END');
  });

  it('no cue: END_OF_TURN 300 ms after the candidate point (700 ms of silence), reason no-cue', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 2000, cues());
    const end = ev.find((e) => e.type === 'turn.end');
    expect(end).toMatchObject({ type: 'turn.end', t: 1700, reason: 'no-cue', policy: 'hold-the-floor', silenceMs: 700 });
    expect(a.state).toBe('END_OF_TURN');
  });

  it('respects a configured candidate silence (300-600 ms)', () => {
    const a = speakingArbiter({ candidateSilenceMs: 600 });
    const ev = run(a, 1000, 2500, cues());
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ t: 1900 });
  });

  it('CANDIDATE_END → HOLDING when a cue has been true for 120 ms', () => {
    const a = speakingArbiter();
    // Lips set from 1350: engaged at 1470.
    const ev = run(a, 1000, 1500, (t) => cues({ lips: t >= 1350 }));
    const hold = ev.find((e) => e.type === 'turn.hold');
    expect(hold).toMatchObject({ type: 'turn.hold', cue: 'lips', detail: 'set', t: 1470 });
    expect(a.state).toBe('HOLDING');
    expect(a.holdingCue).toBe('lips');
  });

  it('a cue true for less than 120 ms never engages', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 2200, (t) => cues({ lips: t >= 1400 && t < 1500 }));
    expect(ev.some((e) => e.type === 'turn.hold')).toBe(false);
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ reason: 'no-cue' });
  });

  it('HOLDING → END_OF_TURN 300 ms after the cue relaxes (reason cues-relaxed)', () => {
    const a = speakingArbiter();
    // Pressed-lip pause 1000..4000, then relaxed.
    const ev = run(a, 1000, 5000, (t) => cues({ lips: t < 4000 }));
    const end = ev.find((e) => e.type === 'turn.end');
    expect(end).toMatchObject({ reason: 'cues-relaxed' });
    // Last engaged tick 3990 → end at 4290 (≈ 0.3 s after relaxing).
    expect((end as { t: number }).t).toBe(4290);
  });

  it('HOLDING → LISTENING when speech resumes, with turn.resume', () => {
    const a = speakingArbiter();
    run(a, 1000, 2000, cues({ lips: true }));
    expect(a.state).toBe('HOLDING');
    const ev = a.speechStart(2010);
    expect(ev).toEqual([{ type: 'turn.resume', t: 2010 }]);
    expect(a.state).toBe('LISTENING');
  });

  it('hard cap ends a hold at 8 s of silence', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 10000, cues({ lips: true }));
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ reason: 'hard-cap', t: 9000 });
  });

  it('head turned alone holds at most 2.5 s', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 6000, cues({ head: true }));
    const hold = ev.find((e) => e.type === 'turn.hold')!;
    const end = ev.find((e) => e.type === 'turn.end')!;
    expect(hold).toMatchObject({ cue: 'head' });
    expect(end.t - hold.t).toBeGreaterThanOrEqual(2500);
    expect(end.t - hold.t).toBeLessThanOrEqual(2500 + 300 + 10);
  });

  it('breathing in alone holds at most 1.5 s', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 6000, cues({ breath: true }));
    const hold = ev.find((e) => e.type === 'turn.hold')!;
    const end = ev.find((e) => e.type === 'turn.end')!;
    expect(hold).toMatchObject({ cue: 'breath' });
    expect(end.t - hold.t).toBeGreaterThanOrEqual(1500);
    expect(end.t - hold.t).toBeLessThanOrEqual(1500 + 300 + 10);
  });

  it('breath extends a lips hold without the 1.5 s limit', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 6000, cues({ breath: true, lips: true }));
    expect(ev.some((e) => e.type === 'turn.end')).toBe(false);
  });

  it('head plus another cue can hold past 2.5 s', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 6000, cues({ head: true, lips: true }));
    expect(ev.some((e) => e.type === 'turn.end')).toBe(false);
  });

  it('switching cue re-labels the hold', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 3000, (t) => cues({ lips: t < 2000, breath: t >= 1800 }));
    const holds = ev.filter((e) => e.type === 'turn.hold').map((e) => (e as { cue: string }).cue);
    expect(holds).toEqual(['lips', 'breath']);
  });

  it('disabled cues are ignored', () => {
    const a = speakingArbiter({ enabled: { lips: false, head: true, breath: true, talking: true } });
    const ev = run(a, 1000, 2000, cues({ lips: true }));
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ reason: 'no-cue' });
  });

  it('camera not OK: cues are ignored and the 2.0 s fallback timer ends the turn', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 3500, cues({ lips: true }, false));
    expect(ev.some((e) => e.type === 'turn.hold')).toBe(false);
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ reason: 'fallback-timer', policy: 'fallback-timer', t: 3000 });
  });

  it('quality loss during a hold switches to the fallback timer', () => {
    const a = speakingArbiter();
    const ev = run(a, 1000, 4000, (t) => cues({ lips: true }, t < 2000));
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ reason: 'fallback-timer', t: 3000 });
  });

  it('Send ends the turn from WAITING, LISTENING, CANDIDATE_END and HOLDING', () => {
    for (const setup of ['WAITING', 'LISTENING', 'CANDIDATE_END', 'HOLDING'] as const) {
      const a = new TurnArbiter();
      a.agentFinished(0);
      if (setup !== 'WAITING') {
        a.speechStart(10);
        if (setup !== 'LISTENING') {
          a.speechEnd(100);
          run(a, 100, setup === 'CANDIDATE_END' ? 510 : 800, cues({ lips: setup === 'HOLDING' }));
        }
      }
      expect(a.state).toBe(setup);
      const ev = a.send(1000);
      expect(ev).toEqual([expect.objectContaining({ type: 'turn.end', reason: 'send' })]);
      expect(a.state).toBe('END_OF_TURN');
    }
  });

  it('Send does nothing while the agent is speaking', () => {
    const a = new TurnArbiter();
    expect(a.send(10)).toEqual([]);
  });

  it('in driving mode, speech after END_OF_TURN is ignored until the agent cycle', () => {
    const a = speakingArbiter();
    run(a, 1000, 2000, cues());
    expect(a.state).toBe('END_OF_TURN');
    expect(a.speechStart(2100)).toEqual([]);
    expect(a.state).toBe('END_OF_TURN');
  });

  it('oracle mode: decisions are shadow ends, the turn ends only on Space', () => {
    const a = speakingArbiter({ drivesAgent: false });
    const ev = run(a, 1000, 3000, cues());
    expect(ev.filter((e) => e.type === 'turn.end')).toEqual([]);
    expect(ev.find((e) => e.type === 'shadow.end')).toMatchObject({ policy: 'hold-the-floor', t: 1700 });
    // The user goes on speaking: back to LISTENING.
    expect(a.speechStart(3100)).toEqual([{ type: 'turn.resume', t: 3100 }]);
    a.speechEnd(4000);
    const done = a.oracleDone(4500);
    expect(done).toEqual([expect.objectContaining({ type: 'turn.end', reason: 'oracle', policy: 'oracle' })]);
  });

  it('a new silence after resuming starts fresh timers', () => {
    const a = speakingArbiter();
    run(a, 1000, 1300, cues());
    a.speechStart(1310);
    a.speechEnd(2000);
    const ev = run(a, 2000, 3000, cues());
    expect(ev.find((e) => e.type === 'turn.end')).toMatchObject({ t: 2700, silenceMs: 700 });
  });
});
