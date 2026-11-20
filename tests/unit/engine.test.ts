// End-to-end core scenarios on synthetic signals: the Stage 4 checkpoint
// behaviour (held 3 s pressed-lip pause, fast end after relaxing), covered
// lens fallback, shadow-timer cut-offs and results.
import { describe, expect, it } from 'vitest';
import { Engine, type EnginePacket } from '../../src/turn/engine';
import type { TurnEvent } from '../../src/turn/events';
import { toCsv, toMarkdown } from '../../src/results/metrics';
import { face, type FaceSpec } from './helpers';

interface Script {
  /** Mic level (dBFS) at time t. */
  db: (t: number) => number;
  /** Face at time t, or null when not visible. */
  face: (t: number) => FaceSpec | null;
  /** Validation code at time t. */
  code?: (t: number) => number;
}

function calibrated(oracle = false): Engine {
  const e = new Engine({ oracle, micEnabled: true, cameraEnabled: true });
  e.applyCalibration({
    lips: { aperture: { median: 0, mad: 0, n: 300 }, height: { median: 0.232, mad: 0.0145, n: 300 }, pressedHeight: 0.167 },
    head: { dx0: 0, dy0: 0.5 },
    mic: { floorDb: -65, speechDb: -40 },
    frames: { rest: 300, press: 150, question: 300 },
    quality: { rest: 'good', press: 'good' },
    weak: [],
  });
  return e;
}

/** Simulate 30 Hz camera packets (40 ms delivery delay), 50 Hz mic and 30 Hz ticks. */
function simulate(e: Engine, from: number, to: number, s: Script): TurnEvent[] {
  const events: TurnEvent[] = [];
  e.on((ev) => {
    if (ev.type !== 'mic.edge') events.push(ev);
  });
  let nextCam = from;
  let nextMic = from;
  let nextTick = from;
  for (let t = from; t <= to; t += 1) {
    if (t >= nextMic) {
      e.micSample(t, s.db(t));
      nextMic += 20;
    }
    if (t >= nextCam + 40) {
      const ft = nextCam;
      const spec = s.face(ft);
      e.validation(s.code?.(ft) ?? (spec ? 0 : 1), '');
      const p: EnginePacket = {
        rxMs: t,
        landmarks: spec ? [{ tMs: ft, pts: face(spec), stable: true, reset: false }] : [],
        chest: [],
        talking: spec ? [{ detected: false, stable: true, tUs: ft * 1000 }] : [],
        rate: [],
      };
      e.packet(p);
      nextCam += 33.3;
    }
    if (t >= nextTick) {
      e.tick(t);
      nextTick += 33.3;
    }
  }
  return events;
}

const SPEAK = -35;
const QUIET = -66;

describe('Engine scenarios', () => {
  it('holds a 3 s pressed-lip pause and replies ~0.3-0.5 s after the lips relax', () => {
    const e = calibrated();
    e.sdkStarted(0);
    e.agentSpeakingChanged(true, 0);
    e.agentSpeakingChanged(false, 1500);
    // Speak 2000-4000, pressed-lip silent block 4000-7000, relax, then silent.
    const speaking = (t: number): boolean => t >= 2000 && t < 4000;
    const ev = simulate(e, 0, 10000, {
      db: (t) => (speaking(t) ? SPEAK : QUIET),
      face: (t) => (t >= 4000 && t < 7000 ? { height: 0.15 } : { aperture: speaking(t) ? (Math.floor(t / 120) % 2) * 0.08 : 0 }),
    });
    // Mouth movement at the end of speech may hold first (talking); the
    // pressed lips must take over and carry the pause.
    const holds = ev.filter((x) => x.type === 'turn.hold');
    expect(holds).toContainEqual(expect.objectContaining({ cue: 'lips', detail: 'pressed' }));
    const end = ev.find((x) => x.type === 'turn.end')!;
    expect(end).toMatchObject({ reason: 'cues-relaxed', policy: 'hold-the-floor' });
    const afterRelax = end.t - 7000;
    expect(afterRelax).toBeGreaterThan(250);
    expect(afterRelax).toBeLessThan(600);
    // The 0.7 s and 2 s shadow timers fired during the block (would cut in).
    const ghosts = ev.filter((x) => x.type === 'shadow.end').map((x) => (x as { policy: string }).policy);
    expect(ghosts).toEqual(expect.arrayContaining(['fixed-700', 'fixed-2000']));
  });

  it('without cues, the turn ends ~0.7 s after speech stops (no slower than needed)', () => {
    const e = calibrated();
    e.sdkStarted(0);
    e.agentSpeakingChanged(true, 0);
    e.agentSpeakingChanged(false, 1500);
    const ev = simulate(e, 0, 6000, {
      db: (t) => (t >= 2000 && t < 3000 ? SPEAK : QUIET),
      face: () => ({ aperture: 0 }),
    });
    const end = ev.find((x) => x.type === 'turn.end')!;
    expect(end).toMatchObject({ reason: 'no-cue' });
    expect(end.t - 3000).toBeGreaterThan(650);
    expect(end.t - 3000).toBeLessThan(900);
  });

  it('covered lens mid-pause: falls back to the 2.0 s timer, never shorter', () => {
    const e = calibrated();
    e.sdkStarted(0);
    e.agentSpeakingChanged(true, 0);
    e.agentSpeakingChanged(false, 1500);
    const ev = simulate(e, 0, 8000, {
      db: (t) => (t >= 2000 && t < 3000 ? SPEAK : QUIET),
      face: (t) => (t < 3000 ? { aperture: 0 } : null),
    });
    const end = ev.find((x) => x.type === 'turn.end')!;
    expect(end).toMatchObject({ reason: 'fallback-timer', policy: 'fallback-timer' });
    expect(end.t - 3000).toBeGreaterThanOrEqual(1990);
    expect(ev.some((x) => x.type === 'quality.fallback')).toBe(true);
  });

  it('results: the 2 s timer would cut off a 3 s pause; Hold the Floor did not', () => {
    const e = calibrated(true); // oracle mode: all policies shadowed
    e.sdkStarted(0);
    e.setQuestion('Tell me about a place you like.');
    e.agentSpeakingChanged(true, 0);
    e.agentSpeakingChanged(false, 1500);
    // Speech 2000-3000, pressed-lip pause 3000-5900 (2.9 s), speech 5900-6900, done.
    const speaking = (t: number): boolean => (t >= 2000 && t < 3000) || (t >= 5900 && t < 6900);
    simulate(e, 0, 9000, {
      db: (t) => (speaking(t) ? SPEAK : QUIET),
      face: (t) => (t >= 3000 && t < 5900 ? { height: 0.15 } : { aperture: speaking(t) ? (Math.floor(t / 120) % 2) * 0.08 : 0 }),
    });
    e.oracleDone(9000);
    const s = e.results.summary();
    const by = Object.fromEntries(s.policies.map((p) => [p.policy, p]));
    expect(by['fixed-700']!.cutoffs).toBe(1);
    expect(by['fixed-2000']!.cutoffs).toBe(1);
    expect(by['fixed-3000']!.cutoffs).toBe(0);
    expect(by['hold-the-floor']!.cutoffs).toBe(0);
    expect(by['hold-the-floor']!.medianDelayMs).toBeGreaterThan(600);
    expect(by['hold-the-floor']!.medianDelayMs).toBeLessThan(900);
    expect(toCsv(e.results)).toContain('2.0 s timer,1');
    expect(toMarkdown(e.results)).toContain('| Hold the Floor | 0 |');
  });

  it('Send ends the turn immediately', () => {
    const e = calibrated();
    e.sdkStarted(0);
    e.agentSpeakingChanged(true, 0);
    e.agentSpeakingChanged(false, 100);
    const seen: TurnEvent[] = [];
    e.on((x) => {
      if (x.type === 'turn.end') seen.push(x);
    });
    e.send(500);
    expect(seen[0]).toMatchObject({ reason: 'send' });
  });

  it('arbiter tick stays well under 2 ms', () => {
    const e = calibrated();
    e.sdkStarted(0);
    e.agentSpeakingChanged(true, 0);
    e.agentSpeakingChanged(false, 100);
    simulate(e, 0, 20000, { db: () => QUIET, face: () => ({ aperture: 0 }) });
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) e.tick(20000 + i * 33);
    expect((performance.now() - t0) / 300).toBeLessThan(2);
  });
});
