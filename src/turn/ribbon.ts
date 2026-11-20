// Ring buffer behind the floor ribbon: 20 s at 30 Hz of lane values, plus
// time-stamped markers (holds, ends, ghost-timer cut-ins, fallbacks).
// Pure data; the canvas reads it directly every animation frame so React
// never re-renders at 30 Hz.
import { THRESHOLDS } from '../../config/thresholds';
import { CUE_NAMES, type CueName, type CueStatus, type PolicyName } from './events';

export const LANE_OFF = 0;
export const LANE_ON = 1;
export const LANE_UNAVAILABLE = -1;
export const LANE_WARMING = -2;

export const laneValue = (s: CueStatus): number =>
  s === 'on' ? LANE_ON : s === 'off' ? LANE_OFF : s === 'warming' ? LANE_WARMING : LANE_UNAVAILABLE;

export type RibbonMarker =
  | { kind: 'end'; t: number; policy: PolicyName; reason: string }
  | { kind: 'ghost'; t: number; policy: PolicyName; cutoff: boolean }
  | { kind: 'fallback'; t: number; on: boolean };

export class Ribbon {
  readonly size: number;
  readonly t: Float64Array;
  /** Mic level 0..1 above the floor; NaN while the mic is muted or off. */
  readonly voice: Float32Array;
  readonly speaking: Uint8Array;
  readonly lanes: Record<CueName, Int8Array>;
  /** Index into CUE_NAMES of the holding cue, or -1. */
  readonly hold: Int8Array;
  /** 1 while the agent speaks. */
  readonly agent: Uint8Array;
  markers: RibbonMarker[] = [];
  /** Number of samples written so far (monotonic). */
  count = 0;

  constructor(seconds: number = THRESHOLDS.ui.ribbonSeconds, hz: number = THRESHOLDS.ui.ribbonHz) {
    this.size = Math.ceil(seconds * hz) + 2;
    this.t = new Float64Array(this.size);
    this.voice = new Float32Array(this.size);
    this.speaking = new Uint8Array(this.size);
    this.lanes = { lips: new Int8Array(this.size), head: new Int8Array(this.size), breath: new Int8Array(this.size), talking: new Int8Array(this.size) };
    this.hold = new Int8Array(this.size);
    this.agent = new Uint8Array(this.size);
  }

  push(s: { t: number; voice: number; speaking: boolean; cues: Record<CueName, CueStatus>; hold: CueName | null; agent: boolean }): void {
    const i = this.count % this.size;
    this.t[i] = s.t;
    this.voice[i] = s.voice;
    this.speaking[i] = s.speaking ? 1 : 0;
    for (const c of CUE_NAMES) this.lanes[c][i] = laneValue(s.cues[c]);
    this.hold[i] = s.hold ? CUE_NAMES.indexOf(s.hold) : -1;
    this.agent[i] = s.agent ? 1 : 0;
    this.count++;
    const oldest = s.t - (this.size / THRESHOLDS.ui.ribbonHz) * 1000;
    if (this.markers.length && this.markers[0]!.t < oldest) this.markers = this.markers.filter((m) => m.t >= oldest);
  }

  mark(m: RibbonMarker): void {
    this.markers.push(m);
  }

  /** Iterate samples oldest → newest. */
  forEach(fn: (i: number) => void): void {
    const n = Math.min(this.count, this.size);
    const start = this.count - n;
    for (let k = 0; k < n; k++) fn((start + k) % this.size);
  }

  clear(): void {
    this.count = 0;
    this.markers = [];
  }
}
