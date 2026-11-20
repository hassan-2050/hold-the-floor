// Landmark geometry → per-frame features. Distances are divided by the
// inter-ocular distance (33↔263) so they don't depend on camera distance.
import type { SignalFrame } from '../turn/events';
import { LM } from './landmarkIndex';

/** Looks up landmark i as [x, y] pixels, or null when absent. */
export type PointLookup = (i: number) => readonly [number, number] | null;

/** Lookup over the SDK's interleaved x,y array. */
export function lookupFromXY(xy: readonly number[]): PointLookup {
  return (i) => {
    const x = xy[2 * i];
    const y = xy[2 * i + 1];
    return x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y) ? null : [x, y];
  };
}

/** Lookup over a recorded subset `{ index: [x, y] }`. */
export function lookupFromSubset(sub: Readonly<Record<number, readonly [number, number]>>): PointLookup {
  return (i) => sub[i] ?? null;
}

const dist = (a: readonly [number, number] | null, b: readonly [number, number] | null): number | null =>
  a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null;

export function frameFeatures(pts: PointLookup, tMs: number, rxMs: number, valid: boolean): SignalFrame {
  const eR = pts(LM.eyeOuterRight);
  const eL = pts(LM.eyeOuterLeft);
  const iod = dist(eR, eL);
  const ok = valid && iod !== null && iod > 1;
  const norm = (d: number | null): number | null => (ok && d !== null ? d / iod! : null);
  const nose = pts(LM.noseTip);
  let noseDx: number | null = null;
  let noseDy: number | null = null;
  if (ok && nose && eR && eL) {
    noseDx = (nose[0] - (eR[0] + eL[0]) / 2) / iod!;
    noseDy = (nose[1] - (eR[1] + eL[1]) / 2) / iod!;
  }
  return {
    tMs,
    rxMs,
    aperture: norm(dist(pts(LM.innerUpperLip), pts(LM.innerLowerLip))),
    lipHeight: norm(dist(pts(LM.outerUpperLip), pts(LM.outerLowerLip))),
    noseDx,
    noseDy,
    iodPx: iod,
    landmarksValid: ok,
  };
}
