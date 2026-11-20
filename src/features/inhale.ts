// Breath cue: an inhale under way, read from the chest trace
// (breathing.upperTrace). Stage 1: the trace rises on the in-breath.
//
// inhale = slope over the last 400 ms, minus slow posture drift, is above
// 0.35 resting-breath amplitudes per second. Only stable samples are used
// (the SDK marks the trace stable once breathing confidence ≥ 45, after its
// ~30 s window fills). Until then the cue is 'warming'.
import { THRESHOLDS } from '../../config/thresholds';
import { quantile, slopePerSec } from './stats';

export interface InhaleReading {
  status: 'warming' | 'on' | 'off' | 'unavailable';
  /** Detrended slope in resting amplitudes per second (diagnostic). */
  slopeAmp: number | null;
}

export class InhaleDetector {
  private readonly cfg = THRESHOLDS.breath;
  private readonly t: number[] = [];
  private readonly v: number[] = [];
  private readonly stable: boolean[] = [];
  private lastT = -Infinity;
  /** Longest history we need: the rest window. */
  private readonly keepMs = Math.max(THRESHOLDS.breath.restWindowMs, 15000) + 1000;

  /** Add trace samples; duplicates (same timestamp) are ignored. */
  push(tMs: number, value: number, isStable: boolean): void {
    if (!(tMs > this.lastT) || !Number.isFinite(value)) return;
    this.lastT = tMs;
    this.t.push(tMs);
    this.v.push(value);
    this.stable.push(isStable);
    let drop = 0;
    while (drop < this.t.length && this.t[drop]! < tMs - this.keepMs) drop++;
    if (drop) {
      this.t.splice(0, drop);
      this.v.splice(0, drop);
      this.stable.splice(0, drop);
    }
  }

  reset(): void {
    this.t.length = 0;
    this.v.length = 0;
    this.stable.length = 0;
    this.lastT = -Infinity;
  }

  get hasStable(): boolean {
    return this.stable.length > 0 && this.stable[this.stable.length - 1]!;
  }

  /** Evaluate at the newest sample time. */
  read(): InhaleReading {
    const n = this.t.length;
    if (n === 0) return { status: 'unavailable', slopeAmp: null };
    if (!this.stable[n - 1]) return { status: 'warming', slopeAmp: null };
    const now = this.t[n - 1]!;
    const { slopeWindowMs, inhaleAmpPerSec, restWindowMs, minSamples, inhalePolarity } = this.cfg;

    // Stable history only.
    const ts: number[] = [];
    const vs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.stable[i] && this.t[i]! >= now - restWindowMs) {
        ts.push(this.t[i]!);
        vs.push(this.v[i]!);
      }
    }
    if (ts.length < minSamples * 3 || now - ts[0]! < 3000) return { status: 'warming', slopeAmp: null };

    // Slow drift over the rest window, removed before measuring amplitude
    // and the short slope.
    const drift = slopePerSec(ts, vs);
    const t0 = ts[0]!;
    const detr = vs.map((v, i) => v - drift * ((ts[i]! - t0) / 1000));
    const amp = quantile(detr, 0.95) - quantile(detr, 0.05);
    if (!(amp > 0)) return { status: 'off', slopeAmp: 0 };

    const wt: number[] = [];
    const wv: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (ts[i]! >= now - slopeWindowMs) {
        wt.push(ts[i]!);
        wv.push(vs[i]!);
      }
    }
    if (wt.length < minSamples) return { status: 'unavailable', slopeAmp: null };
    const slope = (slopePerSec(wt, wv) - drift) * inhalePolarity;
    const slopeAmp = slope / amp;
    return { status: slopeAmp > inhaleAmpPerSec ? 'on' : 'off', slopeAmp };
  }
}
