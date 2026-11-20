// Quality gate: one answer to "may the camera cues decide right now?".
// Pure (no SDK import) so it runs in unit tests and replay.
//
// Combines validation codes, landmark validity (stable, not reset),
// staleness, landmark rate and SDK errors.
// - Cues stop counting as soon as the evidence is missing. The arbiter then
//   uses the fixed timer, so a covered lens can never end a turn faster
//   than the fixed timer would.
// - The fallback banner and `quality.fallback` event follow after the
//   problem has lasted > 1 s; `quality.restored` after 1 s of good frames.
import { THRESHOLDS } from '../../config/thresholds';
import type { Quality, QualityReason, TurnEvent } from '../turn/events';
import { VALIDATION_HINTS } from './validationCodes';

/** Codes that stop the face cues (Stage 1: code 7 means no landmarks at all). */
const BLOCKING = new Set([1, 2, 5, 6, 7, 10]);

export class QualityGate {
  private readonly c = THRESHOLDS.quality;
  private code: number | null = null;
  /** A multiple-faces report arrived since the last tick. */
  private multiFaceSeen = false;
  private hint = '';
  private lmRx: number[] = [];
  private lmValid: boolean[] = [];
  private lastLmRx = -Infinity;
  private sdkError: { code: number; message: string } | null = null;
  private running = false;
  private badSince: number | null = null;
  private goodSince: number | null = null;
  private fallback = true;
  private reason: QualityReason | null = 'not-started';
  private breathingStable = false;
  private usable = false;

  sdkStarted(t: number): void {
    this.running = true;
    this.sdkError = null;
    this.badSince = t;
    this.goodSince = null;
  }

  sdkStopped(): void {
    this.running = false;
    this.usable = false;
    this.fallback = true;
    this.reason = 'not-started';
  }

  error(code: number, message: string): void {
    this.sdkError = { code, message };
  }

  validation(code: number, hint: string): void {
    this.code = code;
    this.hint = hint;
    // Every multiple-faces report counts, even one the next status replaces
    // before the engine ticks: cues pause whenever the SDK sees another face.
    if (code === 2) this.multiFaceSeen = true;
  }

  landmarks(rxMs: number, valid: boolean): void {
    this.lmRx.push(rxMs);
    this.lmValid.push(valid);
    this.lastLmRx = rxMs;
    const keep = rxMs - 1000;
    let drop = 0;
    while (drop < this.lmRx.length && this.lmRx[drop]! < keep) drop++;
    if (drop) {
      this.lmRx.splice(0, drop);
      this.lmValid.splice(0, drop);
    }
  }

  breathing(stable: boolean): void {
    this.breathingStable = stable;
  }

  /** Landmark sets per second over the last second. */
  landmarkHz(now: number): number {
    let n = 0;
    for (const t of this.lmRx) if (t >= now - 1000) n++;
    return n;
  }

  private problem(now: number): { reason: QualityReason; immediate: boolean; hint: string } | null {
    if (!this.running) return { reason: 'not-started', immediate: true, hint: 'Camera cues are off.' };
    if (this.sdkError) {
      return { reason: 'sdk-error', immediate: true, hint: this.sdkError.message };
    }
    if (this.code === 2 || this.multiFaceSeen) return { reason: 'multiple-faces', immediate: true, hint: VALIDATION_HINTS[2]! };
    if (this.code !== null && BLOCKING.has(this.code)) {
      return { reason: this.code === 1 ? 'no-face' : 'validation', immediate: false, hint: this.hint || VALIDATION_HINTS[this.code] || '' };
    }
    if (now - this.lastLmRx > this.c.staleMs) {
      // No landmarks: say what the SDK says, when it says anything useful.
      const sdkHint = this.code !== null && this.code !== 0 ? this.hint || VALIDATION_HINTS[this.code] || '' : '';
      return { reason: 'face-lost', immediate: false, hint: sdkHint || 'Your face is not visible to the camera.' };
    }
    let n = 0;
    let ok = 0;
    for (let i = 0; i < this.lmRx.length; i++) {
      if (this.lmRx[i]! >= now - this.c.validShareWindowMs) {
        n++;
        if (this.lmValid[i]) ok++;
      }
    }
    if (n > 0 && ok / n < this.c.minValidShare) return { reason: 'landmarks-reset', immediate: false, hint: 'Face tracking is unsteady.' };
    if (this.landmarkHz(now) < this.c.minLandmarkHz) {
      return { reason: 'low-frame-rate', immediate: false, hint: 'The camera is too slow. More light in front of you helps.' };
    }
    return null;
  }

  tick(now: number): { quality: Quality; events: TurnEvent[] } {
    const events: TurnEvent[] = [];
    const p = this.problem(now);
    this.multiFaceSeen = false;
    if (p) {
      this.goodSince = null;
      this.badSince ??= now;
      this.usable = false;
      if (!this.fallback && (p.immediate || now - this.badSince > this.c.badForMs)) {
        this.fallback = true;
        this.reason = p.reason;
        events.push({ type: 'quality.fallback', t: now, reason: p.reason, hint: p.hint });
      }
      if (this.fallback) this.reason = p.reason;
    } else {
      this.badSince = null;
      this.goodSince ??= now;
      if (this.fallback) {
        if (now - this.goodSince >= this.c.restoreAfterMs) {
          this.fallback = false;
          this.reason = null;
          events.push({ type: 'quality.restored', t: now });
        }
      }
      this.usable = !this.fallback;
    }
    const hint = p ? p.hint : this.code !== null && this.code !== 0 ? this.hint || VALIDATION_HINTS[this.code] || '' : '';
    return {
      quality: {
        ok: this.usable,
        reason: this.fallback ? this.reason : null,
        hint,
        validationCode: this.code,
        landmarkHz: this.landmarkHz(now),
        breathingStable: this.breathingStable,
      },
      events,
    };
  }

  get inFallback(): boolean {
    return this.fallback;
  }
}
