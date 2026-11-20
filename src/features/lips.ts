// Lip cue: pressed (outer lips squeezed together), set (parted and held
// still, a speech posture), or moving (visible talking).
import { THRESHOLDS } from '../../config/thresholds';
import type { LipShape, SignalFrame } from '../turn/events';
import { TimeWindow, type Baseline } from './stats';

export interface LipBaselines {
  aperture: Baseline;
  height: Baseline;
  /** Median outer height measured while pressing (calibration step 2), if any. */
  pressedHeight?: number | null;
}

export interface LipReading {
  /** null when lips cannot be measured on this frame. */
  shape: LipShape | null;
  aperture: number | null;
  height: number | null;
}

export class LipsExtractor {
  private readonly cfg = THRESHOLDS.lips;
  private base: LipBaselines | null = null;
  private readonly ap = new TimeWindow(Math.max(THRESHOLDS.lips.setStillMs, THRESHOLDS.lips.movingWindowMs) + 100);
  private setThr = NaN;
  private pressThr = NaN;
  private pressOn = true;

  setBaselines(b: LipBaselines): void {
    this.base = b;
    const { madK, setMinMargin, pressMinMargin } = this.cfg;
    this.setThr = b.aperture.median + Math.max(madK * b.aperture.mad, setMinMargin);
    let press = b.height.median - Math.max(madK * b.height.mad, pressMinMargin);
    // With a measured "pressed" height, put the line halfway between rest
    // and pressed, but never closer to rest than 2 MAD / two-thirds of the
    // minimum margin (plan decision point 3: per-user pressed calibration).
    const p = b.pressedHeight;
    const anchor = this.cfg.pressAnchor;
    this.pressOn = true;
    if (p !== null && p !== undefined && Number.isFinite(p) && b.height.median - p < this.cfg.pressMinDepth) {
      // The calibrated press looked like resting lips: pressed holds are off.
      this.pressOn = false;
      this.pressThr = -Infinity;
      return;
    }
    if (p !== null && p !== undefined && Number.isFinite(p) && p < b.height.median) {
      if (anchor !== null) {
        // Part-way from the user's own deliberate press toward rest, never
        // closer to rest than the 3 MAD line.
        press = Math.min(p + anchor * (b.height.median - p), press);
      } else {
        const mid = (b.height.median + p) / 2;
        const closest = b.height.median - Math.max(2 * b.height.mad, (2 / 3) * pressMinMargin);
        press = Math.min(Math.max(press, mid), closest);
      }
    }
    this.pressThr = press;
  }

  get thresholds(): { set: number; press: number } {
    return { set: this.setThr, press: this.pressThr };
  }

  get ready(): boolean {
    return this.base !== null;
  }

  /** False when the calibrated press was too close to rest to tell apart. */
  get pressEnabled(): boolean {
    return this.pressOn;
  }

  reset(): void {
    this.ap.clear();
  }

  update(f: SignalFrame): LipReading {
    if (!this.base || f.aperture === null || f.lipHeight === null) {
      this.ap.clear();
      return { shape: null, aperture: f.aperture, height: f.lipHeight };
    }
    const t = f.tMs;
    this.ap.push(t, f.aperture);
    const shape = this.classify(t, f.aperture, f.lipHeight);
    return { shape, aperture: f.aperture, height: f.lipHeight };
  }

  private classify(t: number, aperture: number, height: number): LipShape {
    const { movingWindowMs, movingRange, setStillMs, setStillRate } = this.cfg;
    // Moving: the aperture changed by at least movingRange in the window.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = this.ap.length - 1; i >= 0 && this.ap.t[i]! >= t - movingWindowMs; i--) {
      const v = this.ap.v[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo >= movingRange) return 'moving';

    // Set: open beyond threshold and held still for setStillMs.
    if (aperture > this.setThr) {
      const first = this.ap.t[0]!;
      if (t - first >= setStillMs - 40) {
        let sLo = Infinity;
        let sHi = -Infinity;
        let allOpen = true;
        for (let i = this.ap.length - 1; i >= 0 && this.ap.t[i]! >= t - setStillMs; i--) {
          const v = this.ap.v[i]!;
          if (v <= this.setThr) allOpen = false;
          if (v < sLo) sLo = v;
          if (v > sHi) sHi = v;
        }
        if (allOpen && (sHi - sLo) / (setStillMs / 1000) < setStillRate) return 'set';
      }
    }
    if (height < this.pressThr) return 'pressed';
    return 'rest';
  }
}
