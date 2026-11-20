import { describe, expect, it } from 'vitest';
import { frameFeatures, lookupFromXY } from '../../src/features/geometry';
import { HeadPose } from '../../src/features/headPose';
import { InhaleDetector } from '../../src/features/inhale';
import { LipsExtractor } from '../../src/features/lips';
import { TalkingRecency } from '../../src/features/talking';
import { Calibrator } from '../../src/features/calibration';
import { face } from './helpers';

const fr = (spec: Parameters<typeof face>[0], t: number, valid = true) => frameFeatures(face(spec), t, t, valid);

describe('geometry', () => {
  it('normalises lip distances by inter-ocular distance', () => {
    const f = fr({ aperture: 0.1, height: 0.25 }, 0);
    expect(f.aperture).toBeCloseTo(0.1, 6);
    expect(f.lipHeight).toBeCloseTo(0.25, 6);
    expect(f.iodPx).toBe(200);
  });
  it('invalid landmark sets give nulls, never guesses', () => {
    const f = fr({}, 0, false);
    expect(f.aperture).toBeNull();
    expect(f.noseDx).toBeNull();
    expect(f.landmarksValid).toBe(false);
  });
  it('reads the interleaved SDK array', () => {
    const xy = new Array(478 * 2).fill(0);
    xy[33 * 2] = 100;
    xy[263 * 2] = 300;
    const p = lookupFromXY(xy);
    expect(p(263)).toEqual([300, 0]);
    expect(p(500)).toBeNull();
  });
});

const lipsCalibrated = (pressedHeight: number | null = null): LipsExtractor => {
  const l = new LipsExtractor();
  l.setBaselines({ aperture: { median: 0, mad: 0, n: 300 }, height: { median: 0.232, mad: 0.0145, n: 300 }, pressedHeight });
  return l;
};

describe('LipsExtractor', () => {
  it('rest when closed and relaxed', () => {
    const l = lipsCalibrated();
    let shape = null;
    for (let t = 0; t < 500; t += 33) shape = l.update(fr({ aperture: 0, height: 0.232 }, t)).shape;
    expect(shape).toBe('rest');
  });

  it('pressed when outer height drops below rest − 3 MAD (Stage 1 values)', () => {
    const l = lipsCalibrated();
    expect(l.thresholds.press).toBeCloseTo(0.232 - 0.0435, 4);
    let shape = null;
    for (let t = 0; t < 500; t += 33) shape = l.update(fr({ aperture: 0, height: 0.167 }, t)).shape;
    expect(shape).toBe('pressed');
  });

  it('live demo values: ordinary closed lips after an answer are not "pressed", a deliberate press is', () => {
    const base = { aperture: { median: 0, mad: 0, n: 300 }, height: { median: 0.209, mad: 0.002, n: 300 }, pressedHeight: 0.132 };
    const l = new LipsExtractor();
    l.setBaselines(base);
    // 35% of the way from the calibrated press (0.132) up to rest (0.209).
    expect(l.thresholds.press).toBeCloseTo(0.132 + 0.35 * (0.209 - 0.132), 4);
    let shape = null;
    for (let t = 0; t < 500; t += 33) shape = l.update(fr({ aperture: 0, height: 0.175 }, t)).shape;
    expect(shape).toBe('rest'); // lips simply closed after speaking (live: 0.166-0.184)
    const p = new LipsExtractor();
    p.setBaselines(base);
    for (let t = 0; t < 500; t += 33) shape = p.update(fr({ aperture: 0, height: 0.14 }, t)).shape;
    expect(shape).toBe('pressed'); // a firm press like calibration step 2
  });

  it('a soft calibration press (too close to rest) turns the pressed cue off', () => {
    const l = new LipsExtractor();
    l.setBaselines({ aperture: { median: 0, mad: 0, n: 300 }, height: { median: 0.25, mad: 0.003, n: 300 }, pressedHeight: 0.202 });
    expect(l.pressEnabled).toBe(false);
    let shape = null;
    for (let t = 0; t < 500; t += 33) shape = l.update(fr({ aperture: 0, height: 0.15 }, t)).shape;
    expect(shape).toBe('rest');
  });

  it('a calibrated pressed height anchors the line, never closer to rest than 3 MAD', () => {
    const l = lipsCalibrated(0.167);
    // Anchored: 0.167 + 0.35 * 0.065 = 0.1898, above the 3 MAD line (0.1885), so 3 MAD wins.
    expect(l.thresholds.press).toBeCloseTo(0.232 - 3 * 0.0145, 4);
  });

  it('set needs the lips parted beyond the floor margin and held still ≥ 250 ms', () => {
    const l = lipsCalibrated();
    expect(l.thresholds.set).toBeCloseTo(0.03, 6); // MAD 0 → absolute floor
    const shapes: (string | null)[] = [];
    for (let t = 0; t <= 400; t += 33) shapes.push(l.update(fr({ aperture: 0.09 }, t)).shape);
    // The jump from 0 is "moving" for the first 300 ms window only if it moved; start already open:
    expect(shapes.at(-1)).toBe('set');
    expect(shapes[0]).not.toBe('set');
  });

  it('moving when the aperture changes quickly (visible talking)', () => {
    const l = lipsCalibrated();
    let shape = null;
    for (let t = 0; t < 600; t += 33) shape = l.update(fr({ aperture: (Math.floor(t / 100) % 2) * 0.08 }, t)).shape;
    expect(shape).toBe('moving');
  });

  it('uncalibrated or invalid frames report null', () => {
    expect(new LipsExtractor().update(fr({}, 0)).shape).toBeNull();
    expect(lipsCalibrated().update(fr({}, 0, false)).shape).toBeNull();
  });
});

describe('HeadPose', () => {
  it('turned only beyond 15° for ≥ 300 ms', () => {
    const h = new HeadPose();
    h.setBaseline({ dx0: 0, dy0: 0.5 });
    // dy0 matches the helper's nose 100 px below the eye line (0.5 IOD).
    expect(h.update(fr({ yawDeg: 20 }, 0)).turned).toBe(false);
    expect(h.update(fr({ yawDeg: 20 }, 200)).turned).toBe(false);
    const r = h.update(fr({ yawDeg: 20 }, 310));
    expect(r.turned).toBe(true);
    expect(r.yawDeg).toBeCloseTo(20, 4);
    expect(h.update(fr({ yawDeg: 10 }, 400)).turned).toBe(false);
  });

  it('pitch counts too', () => {
    const h = new HeadPose();
    h.setBaseline({ dx0: 0, dy0: 0.5 });
    h.update(fr({ pitchDeg: -18 }, 0));
    expect(h.update(fr({ pitchDeg: -18 }, 300)).turned).toBe(true);
  });

  it('unmeasured without a baseline or face', () => {
    expect(new HeadPose().update(fr({}, 0)).turned).toBeNull();
  });
});

describe('InhaleDetector', () => {
  /** Resting breath: 4 s sine of amplitude 1, then an optional ramp. */
  function feed(d: InhaleDetector, untilMs: number, stable: (t: number) => boolean, extra?: (t: number) => number | null): void {
    for (let t = 0; t <= untilMs; t += 33) {
      const v = extra?.(t) ?? 0.5 * Math.sin((2 * Math.PI * t) / 4000);
      d.push(t, v, stable(t));
    }
  }

  it('warming until the trace is stable', () => {
    const d = new InhaleDetector();
    feed(d, 5000, () => false);
    expect(d.read().status).toBe('warming');
  });

  it('detects a rising (inhale) ramp, not a falling one', () => {
    const up = new InhaleDetector();
    feed(up, 20000, () => true, (t) => (t > 19000 ? 0.5 + ((t - 19000) / 1000) * 1.2 : null));
    expect(up.read().status).toBe('on');
    const down = new InhaleDetector();
    feed(down, 20000, () => true, (t) => (t > 19000 ? -((t - 19000) / 1000) * 1.2 : null));
    expect(down.read().status).toBe('off');
  });

  it('holding the breath (flat) is not an inhale', () => {
    const d = new InhaleDetector();
    feed(d, 20000, () => true, (t) => (t > 19000 ? 0.3 : null));
    expect(d.read().status).toBe('off');
  });

  it('ignores duplicate timestamps', () => {
    const d = new InhaleDetector();
    d.push(10, 1, true);
    d.push(10, 5, true);
    d.push(5, 5, true);
    expect(d.read().status).toBe('warming');
  });
});

describe('TalkingRecency', () => {
  it('true within 300 ms of the SDK flag or mouth movement', () => {
    const t = new TalkingRecency();
    t.pushSdk(1000, true);
    expect(t.recent(1300)).toBe('sdk');
    expect(t.recent(1301)).toBeNull();
    t.pushMoving(2000, true);
    expect(t.recent(2100)).toBe('mouth');
    expect(t.recent(2101)).toBeNull();
  });
});

describe('Calibrator', () => {
  it('builds lip, head and mic baselines from the steps', () => {
    const c = new Calibrator();
    c.begin('rest');
    for (let t = 0; t < 3000; t += 33) {
      c.frame(fr({ aperture: 0, height: 0.23 }, t));
      c.mic(-62 + (t % 2));
    }
    c.begin('press');
    for (let t = 0; t < 3000; t += 33) c.frame(fr({ height: 0.17 }, t));
    c.begin('question');
    for (let t = 0; t < 2000; t += 20) c.mic(t % 400 < 200 ? -30 : -60);
    const r = c.result();
    expect(r.lips?.height.median).toBeCloseTo(0.23, 6);
    expect(r.lips?.pressedHeight).toBeCloseTo(0.17, 6);
    expect(r.head?.dy0).toBeCloseTo(0.5, 6);
    expect(r.mic.floorDb).toBeGreaterThanOrEqual(-62);
    expect(r.mic.floorDb).toBeLessThanOrEqual(-61);
    expect(r.mic.speechDb).toBe(-30);
    expect(r.weak).toEqual([]);
  });

  it('flags steps with too few frames', () => {
    const c = new Calibrator();
    c.begin('rest');
    c.frame(fr({}, 0));
    const r = c.result();
    expect(r.weak).toContain('rest');
    expect(r.quality.rest).toBe('missing');
    expect(r.lips).toBeNull();
  });

  it('a slow camera (10 face frames/s) still calibrates: rest is low, press is usable', () => {
    const c = new Calibrator();
    c.begin('rest');
    for (let t = 0; t < 10000; t += 100) c.frame(fr({ aperture: 0, height: 0.23 }, t));
    c.begin('press');
    for (let t = 0; t < 5000; t += 100) c.frame(fr({ height: 0.17 }, t));
    const r = c.result();
    expect(r.weak).toEqual([]);
    expect(r.quality).toEqual({ rest: 'low', press: 'low' });
    expect(r.lips).not.toBeNull();
    expect(r.lips?.pressedHeight).toBeCloseTo(0.17, 6);
    expect(r.head).not.toBeNull();
  });

  it('a missed press step is skipped, not blocking', () => {
    const c = new Calibrator();
    c.begin('rest');
    for (let t = 0; t < 10000; t += 40) c.frame(fr({ aperture: 0, height: 0.23 }, t));
    c.begin('press');
    const r = c.result();
    expect(r.weak).toEqual(['press']);
    expect(r.lips?.pressedHeight).toBeNull();
    expect(r.lips).not.toBeNull();
  });
});
