// The engine: one pipeline from SDK numbers + mic loudness to turn
// decisions. Live sensing and replay both feed it the same inputs, so a
// replay reproduces the same holds. Pure: no Electron, React or SDK; the
// caller supplies all times (epoch ms).
import { THRESHOLDS } from '../../config/thresholds';
import { MicDetector } from '../audio/detector';
import { Calibrator, type CalibrationResult, type CalibrationStep } from '../features/calibration';
import { frameFeatures, type PointLookup } from '../features/geometry';
import { HeadPose } from '../features/headPose';
import { InhaleDetector } from '../features/inhale';
import { LipsExtractor, type LipBaselines } from '../features/lips';
import { baselineOf } from '../features/stats';
import { TalkingRecency } from '../features/talking';
import { SessionResults } from '../results/metrics';
import { QualityGate } from '../sensing/qualityGate';
import type { RawRate, RawSample, RawTalking } from '../sensing/types';
import { TurnArbiter, defaultArbiterConfig, type ArbiterConfig } from './arbiter';
import type { ArbiterState, CueName, CueStates, EndReason, LipShape, MicEdge, PolicyName, Quality, TurnEvent } from './events';
import { CUE_NAMES } from './events';
import { Ribbon } from './ribbon';
import { ShadowTimers } from './shadowTimers';

export interface EngineLandmarks {
  /** Frame time, epoch ms. */
  tMs: number;
  pts: PointLookup;
  stable: boolean;
  reset: boolean;
}

export interface EnginePacket {
  rxMs: number;
  landmarks: EngineLandmarks[];
  chest: RawSample[];
  talking: RawTalking[];
  rate: RawRate[];
}

export interface EngineOptions {
  oracle: boolean;
  arbiter?: Partial<ArbiterConfig>;
  /** Microphone declined: speech edges come from visible mouth movement. */
  micEnabled: boolean;
  /** Camera declined: cues never available; the fixed timer decides. */
  cameraEnabled: boolean;
}

export interface EngineSnapshot {
  t: number;
  state: ArbiterState;
  turn: number;
  holdCue: CueName | null;
  holdDetail: string;
  cues: CueStates;
  quality: Quality;
  fallback: boolean;
  speaking: boolean;
  micLevel: number | null;
  micMuted: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  agentSpeaking: boolean;
  oracle: boolean;
  calibrating: CalibrationStep | null;
  /** Valid face frames collected per calibration step. */
  calibrationFrames: Record<CalibrationStep, number>;
  lipsReady: boolean;
  /** Pressed-lip cue usable (the calibrated press was clearly firmer than rest). */
  pressEnabled: boolean;
  /** SDK breathing-rate confidence, 0-100; the breath cue starts at 45. */
  breathConfidence: number | null;
  headReady: boolean;
  lastEnd: { t: number; reason: EndReason; policy: PolicyName; silenceMs: number } | null;
  /** ms until the 2.0 s shadow timer would end the current silence, or null. */
  twoSecondRemaining: number | null;
  /** Time the 2.0 s shadow timer last fired (for the comparison view). */
  twoSecondFiredAt: number | null;
  /** Oracle mode: Hold the Floor's decision in the current silence, if made. */
  htfWouldEndAt: number | null;
  readings: { yawDeg: number | null; pitchDeg: number | null; aperture: number | null; lipHeight: number | null; breathSlope: number | null; lipShape: LipShape | null };
}

type Listener = (e: TurnEvent | (MicEdge & { type: 'mic.edge' })) => void;

const LIP_WORD: Record<LipShape, string> = { rest: 'rest', pressed: 'pressed', set: 'set', moving: 'moving' };

export class Engine {
  readonly gate = new QualityGate();
  readonly lips = new LipsExtractor();
  readonly head = new HeadPose();
  readonly inhale = new InhaleDetector();
  readonly talking = new TalkingRecency();
  readonly mic = new MicDetector();
  readonly calibrator = new Calibrator();
  readonly arbiter: TurnArbiter;
  readonly shadows = new ShadowTimers();
  readonly ribbon = new Ribbon();
  results: SessionResults;

  private opts: EngineOptions;
  private listeners = new Set<Listener>();
  private lastFrameRx = -Infinity;
  private lipShape: LipShape | null = null;
  private headTurned: boolean | null = null;
  private yaw: number | null = null;
  private pitch: number | null = null;
  private aperture: number | null = null;
  private lipHeight: number | null = null;
  private breathSlope: number | null = null;
  private breathStatus: 'warming' | 'on' | 'off' | 'unavailable' = 'unavailable';
  /** Latest SDK breathing-rate confidence (0-100; "stable" at 45). */
  private breathConf: number | null = null;
  private agentSpeaking = false;
  private visualSpeaking = false;
  private visualQuietSince: number | null = null;
  private lastEnd: EngineSnapshot['lastEnd'] = null;
  private twoSecondFiredAt: number | null = null;
  private htfWouldEndAt: number | null = null;
  private quality: Quality = { ok: false, reason: 'not-started', hint: '', validationCode: null, landmarkHz: 0, breathingStable: false };
  private cueStates: CueStates = blankCues();
  private now = 0;
  private calibration: CalibrationResult | null = null;
  private listenAp: number[] = [];
  private listenH: number[] = [];
  private question = '';

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.arbiter = new TurnArbiter({ ...defaultArbiterConfig(), ...opts.arbiter, drivesAgent: !opts.oracle });
    this.results = new SessionResults(opts.oracle);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: Parameters<Listener>[0]): void {
    for (const l of this.listeners) l(e);
  }

  configure(arbiter: Partial<ArbiterConfig>): void {
    this.arbiter.configure(arbiter);
  }

  /** Start counting results from here (after calibration). */
  resetResults(): void {
    this.results = new SessionResults(this.opts.oracle);
  }

  get options(): Readonly<EngineOptions> {
    return this.opts;
  }

  // ---- SDK inputs -------------------------------------------------------
  sdkStarted(t: number): void {
    this.gate.sdkStarted(t);
  }

  sdkStopped(): void {
    this.gate.sdkStopped();
  }

  sdkError(code: number, message: string): void {
    this.gate.error(code, message);
  }

  validation(code: number, hint: string): void {
    this.gate.validation(code, hint);
  }

  packet(p: EnginePacket): void {
    for (const l of p.landmarks) {
      const valid = l.stable && !l.reset;
      this.gate.landmarks(p.rxMs, valid);
      if (l.reset) {
        this.lips.reset();
        this.inhale.reset();
      }
      const f = frameFeatures(l.pts, l.tMs, p.rxMs, valid);
      if (!f.landmarksValid) continue;
      this.lastFrameRx = p.rxMs;
      this.calibrator.frame(f);
      const lr = this.lips.update(f);
      this.lipShape = lr.shape;
      this.aperture = lr.aperture;
      this.lipHeight = lr.height;
      this.talking.pushMoving(p.rxMs, lr.shape === 'moving');
      const hr = this.head.update(f);
      this.headTurned = hr.turned;
      this.yaw = hr.yawDeg;
      this.pitch = hr.pitchDeg;
      // Quiet listening refreshes the lip baseline (plan: calibration + quiet listening).
      if (this.agentSpeaking && lr.shape !== 'moving' && f.aperture !== null && f.lipHeight !== null) {
        this.listenAp.push(f.aperture);
        this.listenH.push(f.lipHeight);
        if (this.listenAp.length > 450) {
          this.listenAp.shift();
          this.listenH.shift();
        }
      }
    }
    for (const c of p.chest) this.inhale.push(c.tUs / 1000, c.v, c.stable);
    for (const t of p.talking) this.talking.pushSdk(p.rxMs, t.detected);
    const lastChest = p.chest.at(-1);
    const lastRate = p.rate.at(-1);
    if (lastChest || lastRate) this.gate.breathing((lastChest ?? lastRate)!.stable);
    if (lastRate) this.breathConf = lastRate.conf;
  }

  // ---- mic --------------------------------------------------------------
  micSample(tMs: number, db: number): void {
    if (!this.opts.micEnabled) return;
    if (!this.agentSpeaking) this.calibrator.mic(db);
    for (const e of this.mic.push(tMs, db)) this.edge(e);
  }

  private edge(e: MicEdge): void {
    this.results.edge(e);
    if (e.kind === 'speech-start') {
      this.htfWouldEndAt = null;
      for (const ev of this.shadows.speechStart(e.t)) this.handle(ev);
      for (const ev of this.arbiter.speechStart(e.t)) this.handle(ev);
    } else {
      this.shadows.speechEnd(e.t);
      this.arbiter.speechEnd(e.t);
    }
    this.emit({ ...e, type: 'mic.edge' });
  }

  // ---- agent ------------------------------------------------------------
  setQuestion(text: string): void {
    this.question = text;
  }

  agentSpeakingChanged(speaking: boolean, t: number): void {
    this.agentSpeaking = speaking;
    for (const e of this.mic.setAgentSpeaking(speaking, t)) this.edge(e);
    if (speaking) {
      this.arbiter.agentStarted(t);
      this.shadows.endTurn();
    } else {
      this.refreshLipBaseline();
      this.arbiter.agentFinished(t);
      this.shadows.beginTurn(this.arbiter.turn);
      this.results.beginTurn(this.arbiter.turn, this.question);
      this.visualSpeaking = false;
    }
  }

  // ---- user actions -----------------------------------------------------
  send(t: number): void {
    for (const ev of this.arbiter.send(t)) this.handle(ev);
  }

  oracleDone(t: number): void {
    if (!this.opts.oracle) return;
    this.tick(t);
    for (const ev of this.arbiter.oracleDone(t)) this.handle(ev);
  }

  /** "I wasn't finished": reopen the same turn and count a cut-off. */
  notDone(t: number): void {
    const turn = this.arbiter.turn;
    this.handle({ type: 'user.not-done', t, turn });
    this.results.reopen();
    this.agentSpeaking = false;
    this.mic.setAgentSpeaking(false, t);
    this.arbiter.agentStarted(t);
    this.arbiter.state = 'WAITING';
    this.shadows.beginTurn(turn);
  }

  // ---- calibration --------------------------------------------------------
  beginCalibration(step: CalibrationStep): void {
    this.calibrator.begin(step);
  }

  finishCalibration(): CalibrationResult {
    this.calibrator.stop();
    const r = this.calibrator.result();
    this.applyCalibration(r);
    return r;
  }

  applyCalibration(r: CalibrationResult): void {
    this.calibration = r;
    if (r.lips) this.lips.setBaselines(r.lips);
    if (r.head) this.head.setBaseline(r.head);
    this.mic.calibrate(r.mic);
  }

  get calibrationResult(): CalibrationResult | null {
    return this.calibration;
  }

  private refreshLipBaseline(): void {
    const cal = this.calibration?.lips;
    if (!cal || this.listenAp.length < 90) return;
    const a = baselineOf(this.listenAp);
    const h = baselineOf(this.listenH);
    if (!a || !h) return;
    const w = THRESHOLDS.lips.listenWeight;
    const mix = (c: number, l: number): number => (1 - w) * c + w * l;
    const blended: LipBaselines = {
      aperture: { median: mix(cal.aperture.median, a.median), mad: Math.max(cal.aperture.mad, a.mad), n: cal.aperture.n + a.n },
      height: { median: mix(cal.height.median, h.median), mad: Math.max(cal.height.mad, h.mad), n: cal.height.n + h.n },
      pressedHeight: cal.pressedHeight ?? null,
    };
    this.lips.setBaselines(blended);
  }

  // ---- tick ---------------------------------------------------------------
  tick(now: number): TurnEvent[] {
    this.now = now;
    const out: TurnEvent[] = [];
    const g = this.opts.cameraEnabled ? this.gate.tick(now) : { quality: { ...this.quality, ok: false, reason: 'not-started' as const }, events: [] };
    this.quality = g.quality;
    for (const ev of g.events) {
      out.push(ev);
      this.handle(ev);
    }

    // Breath reading at the newest sample.
    const br = this.inhale.read();
    this.breathStatus = br.status;
    this.breathSlope = br.slopeAmp;

    this.cueStates = this.computeCues(now);
    const active = {} as Record<CueName, boolean>;
    const detail = {} as Record<CueName, string>;
    for (const c of CUE_NAMES) {
      active[c] = this.cueStates[c].status === 'on';
      detail[c] = this.cueStates[c].detail;
    }

    if (!this.opts.micEnabled) this.visualVoice(now);

    for (const ev of this.shadows.tick(now)) {
      out.push(ev);
      this.handle(ev);
    }
    for (const ev of this.arbiter.tick(now, { active, detail, cameraOk: this.quality.ok })) {
      out.push(ev);
      this.handle(ev);
    }

    const lvl = this.mic.level;
    const th = this.mic.thresholds;
    this.ribbon.push({
      t: now,
      voice: lvl === null || !this.opts.micEnabled ? NaN : Math.max(0, Math.min(1, (lvl - th.floor) / Math.max(12, th.speech - th.floor + 12))),
      speaking: this.opts.micEnabled ? this.mic.isSpeaking : this.visualSpeaking,
      cues: { lips: this.cueStates.lips.status, head: this.cueStates.head.status, breath: this.cueStates.breath.status, talking: this.cueStates.talking.status },
      hold: this.arbiter.holdingCue,
      agent: this.agentSpeaking,
    });
    return out;
  }

  /** Mic declined: speech = visible mouth movement, with a 150 ms release. */
  private visualVoice(now: number): void {
    const talking = this.quality.ok && this.talking.recent(now) !== null;
    if (talking) {
      this.visualQuietSince = null;
      if (!this.visualSpeaking && !this.agentSpeaking) {
        this.visualSpeaking = true;
        this.edge({ kind: 'speech-start', t: now });
      }
    } else if (this.visualSpeaking) {
      this.visualQuietSince ??= now;
      if (now - this.visualQuietSince >= THRESHOLDS.mic.silenceMinMs) {
        this.visualSpeaking = false;
        this.edge({ kind: 'speech-end', t: this.visualQuietSince });
      }
    }
  }

  private computeCues(now: number): CueStates {
    const cues = blankCues();
    if (!this.opts.cameraEnabled) return cues;
    const fresh = now - this.lastFrameRx <= THRESHOLDS.quality.staleMs;
    const camOk = this.quality.ok;
    // Lips
    if (camOk && fresh && this.lips.ready && this.lipShape !== null) {
      const on = this.lipShape === 'pressed' || this.lipShape === 'set';
      cues.lips = { status: on ? 'on' : 'off', detail: on ? LIP_WORD[this.lipShape] : this.lipShape === 'moving' ? 'moving' : 'relaxed' };
    } else if (!this.lips.ready && camOk && fresh) cues.lips = { status: 'off', detail: this.calibrator.current ? 'learning…' : 'seen' };
    // Talking (visible)
    if (camOk && fresh) {
      const src = this.talking.recent(now);
      cues.talking = { status: src ? 'on' : 'off', detail: src ? 'talking' : 'quiet' };
    }
    // Head
    if (camOk && fresh && this.head.ready && this.headTurned !== null) {
      cues.head = { status: this.headTurned ? 'on' : 'off', detail: this.headTurned ? 'turned' : 'forward' };
    } else if (!this.head.ready && camOk && fresh) cues.head = { status: 'off', detail: this.calibrator.current ? 'learning…' : 'seen' };
    // Breath: only during silence (talking degrades the trace), only when stable.
    const excessiveMotion = this.quality.validationCode === 12;
    if (this.breathStatus === 'warming') {
      const pct = this.breathConf ? Math.min(99, Math.round((this.breathConf / 45) * 100)) : 0;
      cues.breath = { status: 'warming', detail: pct > 0 ? `warming up ${pct}%` : 'warming up' };
    }
    else if (camOk && !excessiveMotion && (this.breathStatus === 'on' || this.breathStatus === 'off')) {
      const silent = !(this.opts.micEnabled ? this.mic.isSpeaking : this.visualSpeaking);
      const on = this.breathStatus === 'on' && silent;
      cues.breath = { status: on ? 'on' : 'off', detail: on ? 'breathing in' : 'steady' };
    }
    return cues;
  }

  private handle(ev: TurnEvent): void {
    this.results.event(ev);
    switch (ev.type) {
      case 'turn.end':
        this.lastEnd = { t: ev.t, reason: ev.reason, policy: ev.policy, silenceMs: ev.silenceMs };
        this.ribbon.mark({ kind: 'end', t: ev.t, policy: ev.policy, reason: ev.reason });
        // The real turn is over: shadow timers stop for this turn.
        for (const e of this.shadows.tick(ev.t)) this.handle(e);
        this.shadows.endTurn();
        break;
      case 'shadow.end':
        if (ev.policy === 'hold-the-floor' || ev.policy === 'fallback-timer') {
          this.htfWouldEndAt = ev.t;
          this.shadows.markEnd(ev.policy, ev.t);
          this.ribbon.mark({ kind: 'end', t: ev.t, policy: ev.policy, reason: 'shadow' });
        } else {
          this.ribbon.mark({ kind: 'ghost', t: ev.t, policy: ev.policy, cutoff: false });
          if (ev.policy === 'fixed-2000') this.twoSecondFiredAt = ev.t;
        }
        break;
      case 'shadow.cutoff': {
        const m = [...this.ribbon.markers].reverse().find((x) => x.kind === 'ghost' && x.policy === ev.policy);
        if (m && m.kind === 'ghost') m.cutoff = true;
        break;
      }
      case 'quality.fallback':
        this.ribbon.mark({ kind: 'fallback', t: ev.t, on: true });
        break;
      case 'quality.restored':
        this.ribbon.mark({ kind: 'fallback', t: ev.t, on: false });
        break;
      default:
        break;
    }
    this.emit(ev);
  }

  snapshot(): EngineSnapshot {
    const hold = this.arbiter.holdingCue;
    return {
      t: this.now,
      state: this.arbiter.state,
      turn: this.arbiter.turn,
      holdCue: hold,
      holdDetail: hold ? this.cueStates[hold].detail : '',
      cues: this.cueStates,
      quality: this.quality,
      fallback: this.opts.cameraEnabled ? this.gate.inFallback : true,
      speaking: this.opts.micEnabled ? this.mic.isSpeaking : this.visualSpeaking,
      micLevel: this.mic.level,
      micMuted: this.mic.muted,
      micEnabled: this.opts.micEnabled,
      cameraEnabled: this.opts.cameraEnabled,
      agentSpeaking: this.agentSpeaking,
      oracle: this.opts.oracle,
      calibrating: this.calibrator.current,
      calibrationFrames: this.calibrator.counts,
      lipsReady: this.lips.ready,
      pressEnabled: this.lips.pressEnabled,
      breathConfidence: this.breathConf,
      headReady: this.head.ready,
      lastEnd: this.lastEnd,
      twoSecondRemaining: this.shadows.remaining(this.now, 2000),
      twoSecondFiredAt: this.twoSecondFiredAt,
      htfWouldEndAt: this.htfWouldEndAt,
      readings: {
        yawDeg: this.yaw,
        pitchDeg: this.pitch,
        aperture: this.aperture,
        lipHeight: this.lipHeight,
        breathSlope: this.breathSlope,
        lipShape: this.lipShape,
      },
    };
  }
}

function blankCues(): CueStates {
  return {
    lips: { status: 'unavailable', detail: 'not visible' },
    head: { status: 'unavailable', detail: 'not visible' },
    breath: { status: 'unavailable', detail: 'not visible' },
    talking: { status: 'unavailable', detail: 'not visible' },
  };
}
