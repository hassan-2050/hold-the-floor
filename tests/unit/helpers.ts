// Synthetic landmark sets for tests: a frontal face with IOD = 200 px.
import { lookupFromSubset, type PointLookup } from '../../src/features/geometry';

export interface FaceSpec {
  /** Inner-lip aperture in IOD units. */
  aperture?: number;
  /** Outer-lip height in IOD units. */
  height?: number;
  /** Head yaw/pitch, degrees (converted with the 0.4 IOD nose depth). */
  yawDeg?: number;
  pitchDeg?: number;
}

export const IOD = 200;

export function face(spec: FaceSpec = {}): PointLookup {
  const ap = (spec.aperture ?? 0) * IOD;
  const h = (spec.height ?? 0.23) * IOD;
  const dx = Math.tan(((spec.yawDeg ?? 0) * Math.PI) / 180) * 0.4 * IOD;
  const dy = Math.tan(((spec.pitchDeg ?? 0) * Math.PI) / 180) * 0.4 * IOD;
  const cy = 450;
  return lookupFromSubset({
    33: [540, 300],
    263: [740, 300],
    1: [640 + dx, 400 + dy],
    13: [640, cy - ap / 2],
    14: [640, cy + ap / 2],
    0: [640, cy - h / 2],
    17: [640, cy + h / 2],
    61: [600, cy],
    291: [680, cy],
  });
}
