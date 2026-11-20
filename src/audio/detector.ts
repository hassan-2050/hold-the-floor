// Voice activity from loudness numbers (pure; no Web Audio here).
//
// speech  = above floor + speechDb for ≥ 60 ms
// silence = below floor + 6 dB for ≥ 150 ms
// The floor comes from calibration silence. speechDb is 12 dB unless the
// speech level measured in calibration leaves less room (Stage 1: laptop
// mics can give only ~10 dB of margin). While the agent speaks, and for
// 200 ms after, the mic is ignored (half-duplex).
import { THRESHOLDS } from '../../config/thresholds';
import { median, quantile } from '../features/stats';
import type { MicEdge } from '../turn/events';

export interface MicCalibration {
  floorDb: number;
  /** p90 level while answering the calibration question, if measured. */
  speechDb?: number | null;
}

export function speechThresholdDb(cal: MicCalibration): number {
  const c = THRESHOLDS.mic;
  const fixed = c.speechAboveFloorDb;
  if (cal.speechDb === null || cal.speechDb === undefined || !Number.isFinite(cal.speechDb)) return cal.floorDb + fixed;
  const margin = cal.speechDb - cal.floorDb;
  const adaptive = Math.max(c.minSpeechAboveFloorDb, margin * c.adaptiveFraction);
  return cal.floorDb + Math.min(fixed, adaptive);
}

/** Floor = median of calibration-silence levels. */
export function floorFrom(levels: readonly number[]): number {
  return levels.length ? median(levels) : THRESHOLDS.mic.defaultFloorDb;
}

/** Speech level = p90 of levels during the calibration answer. */
export function speechLevelFrom(levels: readonly number[]): number | null {
  return levels.length >= 25 ? quantile(levels, 0.9) : null;
}

type Run = 'loud' | 'quiet' | 'mid';

export class MicDetector {
  private readonly c = THRESHOLDS.mic;
  private floor: number;
  private speechAt: number;
  private silenceAt: number;
  private speaking = false;
  private run: Run = 'quiet';
  private runStart = -Infinity;
  private mutedUntil = -Infinity;
  private agentSpeaking = false;
  /** Latest level, for the Voice lane (null while muted). */
  level: number | null = null;
  /** Time of the latest speech-end edge (silence start), or null while speaking. */
  silenceSince: number | null = null;

  constructor(cal: MicCalibration = { floorDb: THRESHOLDS.mic.defaultFloorDb }) {
    this.floor = cal.floorDb;
    this.speechAt = speechThresholdDb(cal);
    this.silenceAt = cal.floorDb + this.c.silenceAboveFloorDb;
    this.silenceSince = null;
  }

  calibrate(cal: MicCalibration): void {
    this.floor = cal.floorDb;
    this.speechAt = speechThresholdDb(cal);
    this.silenceAt = Math.min(cal.floorDb + this.c.silenceAboveFloorDb, this.speechAt - 1);
  }

  get thresholds(): { floor: number; speech: number; silence: number } {
    return { floor: this.floor, speech: this.speechAt, silence: this.silenceAt };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Half-duplex: the agent's own voice must not count as the user. */
  setAgentSpeaking(speaking: boolean, t: number): MicEdge[] {
    const edges: MicEdge[] = [];
    this.agentSpeaking = speaking;
    if (speaking) {
      this.mutedUntil = Infinity;
      if (this.speaking) {
        this.speaking = false;
        this.silenceSince = t;
        edges.push({ kind: 'speech-end', t });
      }
    } else {
      this.mutedUntil = t + this.c.halfDuplexTailMs;
    }
    this.run = 'quiet';
    this.runStart = t;
    return edges;
  }

  get muted(): boolean {
    return this.agentSpeaking;
  }

  /** Feed one 20 ms window ending at tMs. Returns any voice edges. */
  push(tMs: number, db: number): MicEdge[] {
    if (this.agentSpeaking || tMs < this.mutedUntil) {
      this.level = null;
      return [];
    }
    this.level = db;
    const type: Run = db > this.speechAt ? 'loud' : db < this.silenceAt ? 'quiet' : 'mid';
    if (type !== this.run) {
      this.run = type;
      // The window covers the 20 ms before tMs.
      this.runStart = tMs - this.c.windowMs;
    }
    const dur = tMs - this.runStart;
    if (!this.speaking && type === 'loud' && dur >= this.c.speechMinMs) {
      this.speaking = true;
      this.silenceSince = null;
      return [{ kind: 'speech-start', t: this.runStart }];
    }
    if (this.speaking && type === 'quiet' && dur >= this.c.silenceMinMs) {
      this.speaking = false;
      this.silenceSince = this.runStart;
      return [{ kind: 'speech-end', t: this.runStart }];
    }
    return [];
  }
}
