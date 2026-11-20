// Head cue: turned away (yaw) or tilted (pitch) beyond 15° from the
// calibrated forward pose for at least 300 ms. The angle comes from the
// nose tip's offset from the eye-corner midpoint: angle = atan(Δ / depth).
import { THRESHOLDS } from '../../config/thresholds';
import type { SignalFrame } from '../turn/events';

export interface HeadBaseline {
  dx0: number;
  dy0: number;
}

export interface HeadReading {
  yawDeg: number | null;
  pitchDeg: number | null;
  /** Beyond the angle threshold for at least turnMinMs. null = unmeasured. */
  turned: boolean | null;
}

const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export class HeadPose {
  private readonly cfg = THRESHOLDS.head;
  private base: HeadBaseline | null = null;
  private beyondSince: number | null = null;

  setBaseline(b: HeadBaseline): void {
    this.base = b;
    this.beyondSince = null;
  }

  get ready(): boolean {
    return this.base !== null;
  }

  update(f: SignalFrame): HeadReading {
    if (!this.base || f.noseDx === null || f.noseDy === null) {
      this.beyondSince = null;
      return { yawDeg: null, pitchDeg: null, turned: null };
    }
    const { noseDepth, turnDeg, turnMinMs } = this.cfg;
    const yawDeg = toDeg(Math.atan((f.noseDx - this.base.dx0) / noseDepth));
    const pitchDeg = toDeg(Math.atan((f.noseDy - this.base.dy0) / noseDepth));
    const beyond = Math.abs(yawDeg) > turnDeg || Math.abs(pitchDeg) > turnDeg;
    if (beyond) this.beyondSince ??= f.tMs;
    else this.beyondSince = null;
    const turned = this.beyondSince !== null && f.tMs - this.beyondSince >= turnMinMs;
    return { yawDeg, pitchDeg, turned };
  }
}
