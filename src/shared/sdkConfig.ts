// Shared between main and renderer: the exact metric set this app asks the
// SmartSpectra SDK for. Integer codes are MetricType values from the SDK
// typings (js/index.d.ts, SDK 3.5.0). Kept as literals so this file has no
// SDK import and can be used from both processes.
//
//   CHEST_BREATHING 0, ABDOMEN_BREATHING 1, BREATHING_RATE 2  (= breathingMetrics)
//   FACE_LANDMARKS 11, TALKING 13
//
// Not requested on purpose: cardio, HRV, blinking, expressions, EDA.
export const REQUESTED_METRICS: readonly number[] = Object.freeze([0, 1, 2, 11, 13]);

/** Telemetry is always off in this app. Never change this. */
export const ENABLE_TELEMETRY = false as const;

export type ReadinessVerdict = 'ready' | 'limited' | 'blocked' | 'inconclusive';

export interface ReadinessResult {
  verdict: ReadinessVerdict;
  reason: string;
}
