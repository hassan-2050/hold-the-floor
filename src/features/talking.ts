// Talking cue: visible talking. The SDK flag (face.talking.detected) counts
// when it was true within the last 300 ms; mouth movement from the lips
// extractor counts too. Stage 1 found the SDK flag too slow to rely on
// alone (0% true while counting aloud), so movement is the fast path.
import { THRESHOLDS } from '../../config/thresholds';

export class TalkingRecency {
  private lastSdkTrue = -Infinity;
  private lastMoving = -Infinity;
  private seenSdk = false;

  /** SDK talking sample, keyed by receive time (when the app knew). */
  pushSdk(rxMs: number, detected: boolean): void {
    this.seenSdk = true;
    if (detected) this.lastSdkTrue = rxMs;
  }

  pushMoving(rxMs: number, moving: boolean): void {
    if (moving) this.lastMoving = rxMs;
  }

  reset(): void {
    this.lastSdkTrue = -Infinity;
    this.lastMoving = -Infinity;
  }

  get hasSdk(): boolean {
    return this.seenSdk;
  }

  /** Which source says "talking" right now, if any. */
  recent(now: number): 'sdk' | 'mouth' | null {
    if (now - this.lastMoving <= THRESHOLDS.talking.mouthRecentMs) return 'mouth';
    if (now - this.lastSdkTrue <= THRESHOLDS.talking.recentMs) return 'sdk';
    return null;
  }
}
