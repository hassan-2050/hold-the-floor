// Web replay page only. vite.web.config.mts aliases
// '@smartspectra/node-sdk/renderer' and '@smartspectra/node-sdk/messages' to
// this file, so no SmartSpectra code is shipped to the web. SmartSpectra runs
// only in the desktop app; the web page replays recorded numbers and never
// starts the SDK. Values mirror the SDK 3.5.0 typings.
const DESKTOP_ONLY = 'SmartSpectra runs in the desktop app. This web page only replays recorded numbers.';

export const MetricType = { CHEST_BREATHING: 0, ABDOMEN_BREATHING: 1, BREATHING_RATE: 2, FACE_LANDMARKS: 11, TALKING: 13 } as const;

export const breathingMetrics = [MetricType.CHEST_BREATHING, MetricType.ABDOMEN_BREATHING, MetricType.BREATHING_RATE];

export class SmartSpectraSDK {
  constructor() {
    throw new Error(DESKTOP_ONLY);
  }
}

export function decodeMetrics(): never {
  throw new Error(DESKTOP_ONLY);
}
