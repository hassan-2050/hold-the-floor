import { describe, expect, it } from 'vitest';
import { QualityGate } from '../../src/sensing/qualityGate';
import type { TurnEvent } from '../../src/turn/events';

/** Drive the gate at 30 Hz with landmarks while `face(t)` is true. */
function run(g: QualityGate, from: number, to: number, face: (t: number) => boolean, code?: (t: number) => number) {
  const events: TurnEvent[] = [];
  const ok: boolean[] = [];
  for (let t = from; t <= to; t += 33) {
    if (code) g.validation(code(t), '');
    if (face(t)) g.landmarks(t, true);
    const r = g.tick(t);
    events.push(...r.events);
    ok.push(r.quality.ok);
  }
  return { events, ok, last: g.tick(to) };
}

describe('QualityGate', () => {
  it('starts in fallback and restores after 1 s of good frames', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    const r = run(g, 0, 2000, () => true, () => 0);
    const restored = r.events.find((e) => e.type === 'quality.restored');
    expect(restored).toBeDefined();
    expect(restored!.t).toBeGreaterThanOrEqual(1000);
    expect(r.last.quality.ok).toBe(true);
  });

  it('covered lens: cues stop immediately, fallback event within 1 s, recovery within 2 s', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    // Lens covered at 3000: no landmarks, SDK says no face.
    const covered = run(g, 2001, 6000, (t) => t < 3000, (t) => (t < 3000 ? 0 : 1));
    const fb = covered.events.find((e) => e.type === 'quality.fallback')!;
    expect(fb).toMatchObject({ reason: 'no-face' });
    expect(fb.t - 3000).toBeLessThanOrEqual(1100);
    // Cues unusable right away (no waiting for the banner).
    const uncover = run(g, 6001, 9000, () => true, () => 0);
    const back = uncover.events.find((e) => e.type === 'quality.restored')!;
    expect(back.t - 6001).toBeLessThanOrEqual(2000);
  });

  it('chest not visible (code 7) blocks cues', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    const r = run(g, 2001, 4000, () => true, () => 7);
    expect(r.ok.at(-1)).toBe(false);
    expect(r.events.find((e) => e.type === 'quality.fallback')).toMatchObject({ reason: 'validation' });
  });

  it('no landmarks under code 7: the hint explains the chest', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    g.validation(7, 'Place more of the chest in view.');
    const r = g.tick(3000);
    expect(r.quality.ok).toBe(false);
    expect(r.quality.hint).toMatch(/chest/);
  });

  it('multiple faces pause cues immediately', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    g.validation(2, '');
    const r = g.tick(2010);
    expect(r.quality.ok).toBe(false);
    expect(r.events[0]).toMatchObject({ type: 'quality.fallback', reason: 'multiple-faces' });
  });

  it('a one-frame multiple-faces report between two ticks still pauses cues', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    expect(g.tick(2010).quality.ok).toBe(true);
    // Live demo: a hand coming up to the lens was reported as a second face
    // for one status update (33 ms), then "Increase light on face".
    g.validation(2, 'Only one face is allowed.');
    g.validation(0, '');
    g.landmarks(2030, true);
    const r = g.tick(2040);
    expect(r.quality.ok).toBe(false);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'quality.fallback', reason: 'multiple-faces' }));
  });

  it('kFrameRateTooLow (11) alone is a hint, not a fallback (Stage 1)', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    const r = run(g, 2001, 5000, () => true, () => 11);
    expect(r.ok.every(Boolean)).toBe(true);
    expect(r.last.quality.hint).toMatch(/light/);
  });

  it('measured landmark rate below 15 Hz is a fallback', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    let fb: TurnEvent | undefined;
    for (let t = 2100; t < 5000; t += 100) {
      g.landmarks(t, true); // 10 Hz
      fb ??= g.tick(t).events.find((e) => e.type === 'quality.fallback');
    }
    expect(fb).toMatchObject({ reason: 'low-frame-rate' });
  });

  it('SDK errors stop cues immediately', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    g.error(5, 'network');
    const r = g.tick(2100);
    expect(r.quality.ok).toBe(false);
    expect(r.events[0]).toMatchObject({ reason: 'sdk-error' });
  });

  it('unstable/reset landmark sets above 20% block cues', () => {
    const g = new QualityGate();
    g.sdkStarted(0);
    run(g, 0, 2000, () => true, () => 0);
    for (let t = 2001; t < 3500; t += 33) {
      g.landmarks(t, Math.floor(t / 33) % 2 === 0);
      g.tick(t);
    }
    expect(g.tick(3500).quality.ok).toBe(false);
  });
});
