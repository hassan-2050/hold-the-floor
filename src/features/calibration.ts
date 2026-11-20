// Calibration: personal baselines from three short steps (plan F2).
//   rest     10 s relaxed and silent → lip rest, head forward, mic noise floor
//   press     5 s lips gently pressed → per-user "pressed" height
//   question  answer one easy question → speech level (until breathing is stable)
// Baselines live for the session only unless the user saves the session.
import { THRESHOLDS } from '../../config/thresholds';
import { floorFrom, speechLevelFrom, type MicCalibration } from '../audio/detector';
import type { SignalFrame } from '../turn/events';
import type { HeadBaseline } from './headPose';
import type { LipBaselines } from './lips';
import { baselineOf, median } from './stats';

export type CalibrationStep = 'rest' | 'press' | 'question';

export type StepQuality = 'good' | 'low' | 'missing';

export interface CalibrationResult {
  lips: LipBaselines | null;
  head: HeadBaseline | null;
  mic: MicCalibration;
  frames: Record<CalibrationStep, number>;
  /** good = plenty of face frames; low = usable but slow tracking; missing = unusable. */
  quality: { rest: StepQuality; press: StepQuality };
  /** Steps that collected too few face frames to use (rest must be repeated). */
  weak: CalibrationStep[];
}

export class Calibrator {
  private step: CalibrationStep | null = null;
  private readonly ap: number[] = [];
  private readonly h: number[] = [];
  private readonly dx: number[] = [];
  private readonly dy: number[] = [];
  private readonly pressH: number[] = [];
  private readonly floorDb: number[] = [];
  private readonly speechDb: number[] = [];
  private readonly frames: Record<CalibrationStep, number> = { rest: 0, press: 0, question: 0 };

  get current(): CalibrationStep | null {
    return this.step;
  }

  /** Valid face frames collected per step so far. */
  get counts(): Record<CalibrationStep, number> {
    return { ...this.frames };
  }

  begin(step: CalibrationStep): void {
    this.step = step;
    // Restarting a step discards what it collected before.
    if (step === 'rest') {
      this.ap.length = 0;
      this.h.length = 0;
      this.dx.length = 0;
      this.dy.length = 0;
      this.floorDb.length = 0;
    } else if (step === 'press') {
      this.pressH.length = 0;
    } else {
      this.speechDb.length = 0;
    }
    this.frames[step] = 0;
  }

  stop(): void {
    this.step = null;
  }

  frame(f: SignalFrame): void {
    if (!this.step || !f.landmarksValid) return;
    this.frames[this.step]++;
    if (this.step === 'rest') {
      if (f.aperture !== null) this.ap.push(f.aperture);
      if (f.lipHeight !== null) this.h.push(f.lipHeight);
      if (f.noseDx !== null) this.dx.push(f.noseDx);
      if (f.noseDy !== null) this.dy.push(f.noseDy);
    } else if (this.step === 'press') {
      if (f.lipHeight !== null) this.pressH.push(f.lipHeight);
    }
  }

  mic(db: number): void {
    if (this.step === 'rest') this.floorDb.push(db);
    else if (this.step === 'question') this.speechDb.push(db);
  }

  result(): CalibrationResult {
    const c = THRESHOLDS.calibration;
    const grade = (n: number, min: number, good: number): StepQuality => (n < min ? 'missing' : n < good ? 'low' : 'good');
    const quality = {
      rest: grade(this.frames.rest, c.minRestFrames, c.goodRestFrames),
      press: grade(this.frames.press, c.minPressFrames, c.goodPressFrames),
    };
    const restOk = quality.rest !== 'missing';
    const a = restOk ? baselineOf(this.ap) : null;
    const h = restOk ? baselineOf(this.h) : null;
    // The pressed height is optional; it is used only if the step saw the face.
    const pressMedian = quality.press !== 'missing' && this.pressH.length ? median(this.pressH) : null;
    const lips: LipBaselines | null = a && h ? { aperture: a, height: h, pressedHeight: pressMedian } : null;
    const head: HeadBaseline | null = restOk && this.dx.length && this.dy.length ? { dx0: median(this.dx), dy0: median(this.dy) } : null;
    const floor = this.floorDb.length >= 25 ? floorFrom(this.floorDb) : THRESHOLDS.mic.defaultFloorDb;
    const mic: MicCalibration = { floorDb: floor, speechDb: speechLevelFrom(this.speechDb) };
    const weak = (['rest', 'press'] as const).filter((s) => quality[s] === 'missing');
    return { lips, head, mic, frames: { ...this.frames }, quality, weak };
  }
}
