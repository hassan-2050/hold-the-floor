// Small robust-statistics helpers shared by the extractors and calibration.

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median absolute deviation (unscaled). */
export function mad(values: readonly number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}

/** Least-squares slope of v over t (t in ms), in units per second. */
export function slopePerSec(ts: readonly number[], vs: readonly number[]): number {
  const n = ts.length;
  if (n < 2) return NaN;
  const t0 = ts[0]!;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = (ts[i]! - t0) / 1000;
    const y = vs[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? NaN : (n * sxy - sx * sy) / den;
}

export interface Baseline {
  median: number;
  mad: number;
  n: number;
}

export function baselineOf(values: readonly number[]): Baseline | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return { median: median(finite), mad: mad(finite), n: finite.length };
}

/** Time-ordered ring of (t, value) pairs that drops entries older than `spanMs`. */
export class TimeWindow {
  readonly t: number[] = [];
  readonly v: number[] = [];
  constructor(private readonly spanMs: number) {}

  push(t: number, v: number): void {
    this.t.push(t);
    this.v.push(v);
    this.trim(t);
  }

  trim(now: number): void {
    let drop = 0;
    while (drop < this.t.length && this.t[drop]! < now - this.spanMs) drop++;
    if (drop) {
      this.t.splice(0, drop);
      this.v.splice(0, drop);
    }
  }

  get length(): number {
    return this.t.length;
  }

  clear(): void {
    this.t.length = 0;
    this.v.length = 0;
  }
}
