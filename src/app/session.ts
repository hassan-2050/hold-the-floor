// Session controller (outside React). Owns the camera and mic tracks, the
// SDK client, the engine, the agent voice, the recorder and replay. Every
// stop path (Stop button, Esc, F8, window close, quit) ends in stopSensing().
import { THRESHOLDS } from '../../config/thresholds';
import { startMic, type MicSource } from '../audio/micSource';
import { Interviewer, QUESTION_SETS } from '../agent/interviewer';
import { AgentVoice } from '../agent/voice';
import { toCsv, toMarkdown } from '../results/metrics';
import { errorInfo } from '../sensing/errors';
import { lookupFromXY } from '../features/geometry';
import { packetLine, Recorder } from '../sensing/recording';
import { parseRecording, Replayer } from '../sensing/replay';
import { SdkClient } from '../sensing/sdkClient';
import type { RawPacket } from '../sensing/types';
import { Engine, type EnginePacket } from '../turn/engine';
import type { CalibrationResult, CalibrationStep } from '../features/calibration';
import type { TurnEvent } from '../turn/events';
import { useApp } from '../state/store';
import { dbg, dbgEnabled, r1, r3 } from './debug';

const now = (): number => performance.timeOrigin + performance.now();

const PROBE_PHASE_TEXT: Record<string, string> = {
  rest: 'Calibration: sitting still and silent.',
  press: 'Calibration: lips gently pressed.',
  relax: 'Relaxing.',
  speak: 'Counting aloud, breathing out while speaking.',
  pause: 'Pause: stopping to breathe in, then continuing.',
  exhale: 'Control pause: breathing out, not in.',
  set: 'Lips parted, silent.',
  done: 'Protocol finished.',
};

class Session {
  engine: Engine | null = null;
  private sdk: SdkClient | null = null;
  private camStream: MediaStream | null = null;
  private mic: MicSource | null = null;
  private voice: AgentVoice | null = null;
  private interviewer: Interviewer | null = null;
  private recorder: Recorder | null = null;
  private replayer: Replayer | null = null;
  private tickTimer: number | null = null;
  private tickCount = 0;
  private lastAnnounce = 0;
  private replayWallStart = 0;
  private replayRecStart = 0;
  private offEngine: (() => void) | null = null;
  /** Camera preview element (calibration mirror). */
  previewStream: MediaStream | null = null;
  private stopListeners = new Set<() => void>();
  /** While true, a voice cancel is not reported to the engine as "agent finished". */
  private reopening = false;
  /** The question being answered before the agent moved on. */
  private prevQuestion: { text: string | null; index: number } = { text: null, index: 0 };
  private lastBeat = 0;
  private lastCode: number | null = null;

  // ---- devices ------------------------------------------------------------
  async openCamera(): Promise<MediaStream> {
    const s = useApp.getState().settings;
    const [w, h] = s.captureSize === '960x540' ? [960, 540] : [THRESHOLDS.camera.width, THRESHOLDS.camera.height];
    const base: MediaTrackConstraints = {
      ...(s.cameraId ? { deviceId: { exact: s.cameraId } } : {}),
      width: { ideal: w },
      height: { ideal: h },
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: { ideal: 30, min: 25 } }, audio: false });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: { ideal: 30 } }, audio: false });
    }
    this.camStream = stream;
    this.previewStream = stream;
    useApp.getState().set({ cameraOn: true });
    const vt = stream.getVideoTracks()[0];
    const set = vt?.getSettings();
    dbg('camera-open', { label: vt?.label, width: set?.width, height: set?.height, fps: set?.frameRate, chosen: s.cameraId ? s.cameraId.slice(0, 8) : 'default' });
    for (const t of stream.getVideoTracks()) t.addEventListener('ended', () => this.cameraEnded());
    return stream;
  }

  private cameraEnded(): void {
    if (!this.camStream) return;
    this.banner('error', errorInfo(7));
  }

  // ---- live session ---------------------------------------------------------
  /** Start sensing for calibration + conversation (after consent). */
  async startLive(): Promise<void> {
    await this.stopSensing();
    this.resetEngine();
    const st = useApp.getState();
    const { consent, settings } = st;
    const engine = new Engine({
      oracle: settings.oracle,
      micEnabled: consent.mic,
      cameraEnabled: consent.camera,
      arbiter: this.arbiterSettings(),
    });
    this.attachEngine(engine);
    this.recorder = new Recorder({ created: new Date().toISOString(), oracle: settings.oracle, micEnabled: consent.mic, cameraEnabled: consent.camera, settings: { ...settings, cameraId: null, micId: null } });
    st.set({ mode: 'live', banner: null, results: null });
    dbg('start-live', { camera: consent.camera, mic: consent.mic, oracle: settings.oracle, size: settings.captureSize });
    // Tick from the start so the screen shows the live state while devices open.
    this.startTicking();
    if (consent.mic) await this.startMicrophone();
    if (consent.camera) await this.startCamera();
  }

  private async startMicrophone(): Promise<void> {
    const s = useApp.getState().settings;
    try {
      this.mic = await startMic(
        (smp) => {
          this.engine?.micSample(smp.tMs, smp.db);
          this.recorder?.add({ k: 'a', t: Math.round(smp.tMs * 10) / 10, db: Math.round(smp.db * 100) / 100 });
        },
        { deviceId: s.micId, noiseSuppression: s.noiseSuppression },
      );
      useApp.getState().set({ micOn: true });
      dbg('mic-on', { label: this.mic.label, baseLatency: r3(this.mic.baseLatency), outputLatency: r3(this.mic.outputLatency) });
    } catch (e) {
      dbg('mic-failed', { err: `${(e as Error).name}: ${(e as Error).message}` });
      this.banner('error', {
        title: 'Microphone not available',
        message: 'The app will use camera cues and the Send button (Enter) instead of your voice.',
        action: 'continue',
        actionLabel: 'OK',
        autoRetry: false,
      });
    }
  }

  async startCamera(): Promise<void> {
    if (!this.engine) return;
    let stream: MediaStream;
    try {
      stream = await this.openCamera();
    } catch (e) {
      dbg('camera-failed', { err: `${(e as Error).name}: ${(e as Error).message}` });
      this.banner('error', errorInfo(7));
      return;
    }
    const engine = this.engine;
    this.sdk = new SdkClient({
      packet: (p) => this.onPacket(p),
      validation: (code, hint, rx) => {
        if (code !== this.lastCode) {
          this.lastCode = code;
          dbg('validation', { code, hint });
        }
        engine.validation(code, hint);
        this.recorder?.add({ k: 'v', rx: Math.round(rx * 10) / 10, code, hint });
      },
      status: (s) => dbg('sdk-status', { s }),
      error: (code, message, retryable, rx) => {
        dbg('sdk-error', { code: String(code), message, retryable });
        engine.sdkError(typeof code === 'number' ? code : -1, message);
        this.recorder?.add({ k: 'e', rx, code: typeof code === 'number' ? code : -1, message });
        this.banner('error', errorInfo(code, message), () => void this.restartCamera());
      },
      started: (rx) => {
        dbg('sdk-started', {});
        engine.sdkStarted(rx);
        this.recorder?.add({ k: 'sdk', t: rx, s: 'started' });
      },
      stopped: (rx) => {
        engine.sdkStopped();
        this.recorder?.add({ k: 'sdk', t: rx, s: 'stopped' });
      },
    });
    const t0 = now();
    try {
      await this.sdk.start(stream, () => window.htf.keyForSdk());
      dbg('sdk-start-resolved', { ms: Math.round(now() - t0) });
    } catch (e) {
      const err = e as { code?: number | string; message?: string };
      dbg('sdk-start-failed', { ms: Math.round(now() - t0), code: String(err.code ?? ''), message: err.message ?? '' });
      this.banner('error', errorInfo(err.code ?? 0, err.message), () => void this.restartCamera());
    }
  }

  /** Turn camera and mic back on after Stop, keeping the conversation. */
  async resumeSensing(): Promise<void> {
    if (!this.engine || this.mode !== 'live') return;
    const { consent } = useApp.getState();
    if (consent.mic && !this.mic) await this.startMicrophone();
    if (consent.camera && !this.camStream) await this.startCamera();
  }

  async restartCamera(): Promise<void> {
    useApp.getState().set({ banner: null });
    await this.stopCameraOnly();
    await this.startCamera();
  }

  private onPacket(p: RawPacket): void {
    const ep: EnginePacket = {
      rxMs: p.rxMs,
      landmarks: p.landmarks.map((l) => ({ tMs: l.tUs / 1000, pts: lookupFromXY(l.xy), stable: l.stable, reset: l.reset })),
      chest: p.chest,
      talking: p.talking,
      rate: p.rate,
    };
    this.engine?.packet(ep);
    this.recorder?.add(packetLine(p));
  }

  /** End-to-end tests only (no camera, no key): feed SDK-shaped numbers. */
  testFeed(p: RawPacket): void {
    if (!useApp.getState().info?.e2e) return;
    this.onPacket(p);
  }

  /** End-to-end tests only: act as if the SDK started and reports OK. */
  testSdkStarted(): void {
    if (!useApp.getState().info?.e2e || !this.engine) return;
    this.engine.sdkStarted(now());
    this.engine.validation(0, '');
  }

  // ---- calibration ----------------------------------------------------------
  calibrationStep(step: CalibrationStep): void {
    dbg('cal-step', { step, framesSoFar: this.engine?.calibrator.counts ?? null });
    this.engine?.beginCalibration(step);
    this.recorder?.add({ k: 'cal', t: now(), step });
  }

  finishCalibration(): CalibrationResult | null {
    if (!this.engine) return null;
    this.recorder?.add({ k: 'cal', t: now(), step: null });
    const r = this.engine.finishCalibration();
    const th = this.engine.lips.thresholds;
    dbg('cal-result', {
      frames: r.frames,
      quality: r.quality,
      weak: r.weak,
      lips: !!r.lips,
      head: !!r.head,
      apRest: r3(r.lips?.aperture.median),
      apMad: r3(r.lips?.aperture.mad),
      hRest: r3(r.lips?.height.median),
      hMad: r3(r.lips?.height.mad),
      pressed: r3(r.lips?.pressedHeight ?? null),
      setThr: r3(th.set),
      pressThr: r3(th.press),
      pressEnabled: this.engine.lips.pressEnabled,
      floorDb: r1(r.mic.floorDb),
      speechDb: r1(r.mic.speechDb ?? null),
    });
    return r;
  }

  /** The calibration warm-up question is spoken like a normal question. */
  async sayCalibrationQuestion(text: string): Promise<void> {
    this.ensureVoice();
    await this.speak(text);
  }

  // ---- conversation -------------------------------------------------------------
  async beginConversation(): Promise<void> {
    const st = useApp.getState();
    this.ensureVoice();
    this.interviewer = new Interviewer(QUESTION_SETS[st.settings.questionSet]);
    // The calibration warm-up answer is not part of the results.
    this.engine?.resetResults();
    st.set({ questionTotal: this.interviewer.total, questionIndex: 0 });
    this.wsSend({ type: 'session.start', t: now(), oracle: st.settings.oracle });
    await this.askNext();
  }

  private async askNext(): Promise<void> {
    const iv = this.interviewer;
    if (!iv) return;
    const st0 = useApp.getState();
    this.prevQuestion = { text: st0.question, index: st0.questionIndex };
    const line = iv.next();
    const st = useApp.getState();
    if (line.question) {
      st.set({ question: line.question, questionIndex: iv.index + 1 });
      this.engine?.setQuestion(line.question);
      this.recorder?.add({ k: 'agent', t: now(), text: line.question });
      await this.speak(line.say, false);
    } else {
      st.set({ question: null });
      await this.speak(line.say, false);
      await this.finish();
    }
  }

  private async speak(text: string, record = true): Promise<void> {
    if (record) this.recorder?.add({ k: 'agent', t: now(), text });
    await this.voice?.say(text);
  }

  private ensureVoice(): void {
    const s = useApp.getState().settings;
    if (!this.voice) {
      this.voice = new AgentVoice({ voiceName: s.voiceName, rate: s.voiceRate }, (speaking) => {
        const t = now();
        if (this.reopening) {
          useApp.getState().set({ agentSpeaking: speaking });
          return;
        }
        this.engine?.agentSpeakingChanged(speaking, t);
        // Recorded when the voice really starts/stops: what the engine saw.
        this.recorder?.add({ k: 'agent', t, speaking });
        useApp.getState().set({ agentSpeaking: speaking });
        this.wsSend({ type: 'agent.speaking', t, speaking });
      });
      this.voice.silent = !!useApp.getState().info?.e2e;
    } else this.voice.setOptions({ voiceName: s.voiceName, rate: s.voiceRate });
  }

  send(): void {
    const t = now();
    this.recorder?.add({ k: 'act', t, a: 'send' });
    this.engine?.send(t);
  }

  oracleDone(): void {
    const t = now();
    this.recorder?.add({ k: 'act', t, a: 'oracle' });
    this.engine?.oracleDone(t);
  }

  /** "I wasn't finished": stop the agent and give the floor back. */
  notDone(): void {
    const t = now();
    // Stop the agent without starting a new turn, and show the question
    // the user was still answering.
    this.reopening = true;
    this.voice?.cancel();
    this.reopening = false;
    this.interviewer?.back();
    useApp.getState().set({ question: this.prevQuestion.text, questionIndex: this.prevQuestion.index });
    if (this.prevQuestion.text) this.engine?.setQuestion(this.prevQuestion.text);
    this.recorder?.add({ k: 'act', t, a: 'notdone' });
    this.engine?.notDone(t);
    // Silent on purpose: speaking would start a new turn instead of
    // reopening this one.
    this.announce('Go on, the floor is yours');
  }

  private onEvent(ev: TurnEvent): void {
    dbg('event', ev as unknown as Record<string, unknown>);
    this.wsSend(ev);
    if (ev.type === 'turn.hold') this.announce(`Holding: ${ev.cue === 'talking' ? 'still talking' : `${ev.cue} ${ev.detail}`}`);
    if (ev.type === 'quality.fallback' && this.mode === 'live') {
      const s = useApp.getState();
      s.set({
        banner: {
          kind: 'fallback',
          title: `Camera cues paused — using ${(s.settings.fallbackTimerMs / 1000).toFixed(1)} s timer`,
          message: ev.hint,
        },
      });
    }
    if (ev.type === 'quality.restored') {
      const b = useApp.getState().banner;
      if (b?.kind === 'fallback') useApp.getState().set({ banner: null });
    }
    if (ev.type === 'turn.end' && this.mode === 'live') {
      this.announce('Your turn ended');
      if (this.interviewer) void this.askNext();
    }
  }

  private get mode(): 'live' | 'replay' {
    return useApp.getState().mode;
  }

  private announce(text: string): void {
    const t = now();
    if (t - this.lastAnnounce < THRESHOLDS.ui.announceMinMs) return;
    this.lastAnnounce = t;
    useApp.getState().set({ announcement: text });
  }

  // ---- replay -------------------------------------------------------------------
  async startReplay(text: string, label: string): Promise<void> {
    await this.stopSensing();
    this.resetEngine();
    const rec = parseRecording(text);
    const engine = new Engine({
      oracle: rec.header?.oracle ?? true,
      micEnabled: rec.header?.micEnabled ?? true,
      cameraEnabled: rec.header?.cameraEnabled ?? true,
      arbiter: this.arbiterSettings(),
    });
    this.attachEngine(engine);
    this.replayer = new Replayer(rec, engine, (l) => {
      if (l.k === 'agent' && l.text) useApp.getState().set({ question: l.text });
      if (l.k === 'p') useApp.getState().set({ question: PROBE_PHASE_TEXT[l.phase] ?? l.phase });
    });
    // Calibration is processed instantly; playback starts 2 s before the
    // first conversation question (after the last calibration step), so
    // viewers do not wait through the rest steps or the warm-up.
    let calEnd = -1;
    rec.inputs.forEach((x, i) => {
      if (x.line.k === 'cal' && x.line.step === null) calEnd = i;
    });
    const firstTurn = rec.inputs.find((x, i) => i > calEnd && ((x.line.k === 'agent' && x.line.text !== undefined) || (x.line.k === 'p' && x.line.phase === 'speak')));
    const startAt = firstTurn ? Math.max(rec.start, firstTurn.t - 2000) : rec.start;
    this.replayer.advanceTo(startAt);
    // As in a live session, results count the conversation only, not the
    // calibration warm-up answer.
    if (calEnd >= 0) engine.resetResults();
    this.replayRecStart = startAt;
    this.replayWallStart = now();
    useApp.getState().set({
      mode: 'replay',
      results: null,
      question: 'Replay starting…',
      banner: { kind: 'replay', title: 'REPLAY - recorded numbers, not live', message: `${label}. No camera or microphone is used.` },
    });
    this.startTicking();
  }

  // ---- ticking --------------------------------------------------------------------
  private startTicking(): void {
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    const every = Math.round(1000 / THRESHOLDS.ui.ribbonHz);
    const storeEvery = Math.max(1, Math.round(THRESHOLDS.ui.ribbonHz / THRESHOLDS.ui.storeHz));
    this.tickTimer = window.setInterval(() => {
      const e = this.engine;
      if (!e) return;
      if (this.replayer) {
        this.replayer.advanceTo(this.replayRecStart + (now() - this.replayWallStart));
        if (this.replayer.done) {
          void this.finish();
          return;
        }
      } else e.tick(now());
      if (++this.tickCount % storeEvery === 0) useApp.getState().set({ snapshot: e.snapshot() });
      if (dbgEnabled() && now() - this.lastBeat >= 1000) {
        this.lastBeat = now();
        this.beat(e);
      }
    }, every);
  }

  /** Debug heartbeat: one line per second describing the engine state. */
  private beat(e: Engine): void {
    const s = e.snapshot();
    const st = useApp.getState();
    dbg('beat', {
      screen: st.screen,
      state: s.state,
      turn: s.turn,
      qOk: s.quality.ok,
      qReason: s.quality.reason,
      code: s.quality.validationCode,
      hint: s.quality.hint,
      lmHz: s.quality.landmarkHz,
      breathStable: s.quality.breathingStable,
      breathConf: r1(s.breathConfidence),
      fallback: s.fallback,
      cues: Object.entries(s.cues)
        .map(([k, v]) => `${k}:${v.status}/${v.detail}`)
        .join(' '),
      lipsReady: s.lipsReady,
      headReady: s.headReady,
      cal: s.calibrating,
      calFrames: s.calibrationFrames,
      lipShape: s.readings.lipShape,
      ap: r3(s.readings.aperture),
      h: r3(s.readings.lipHeight),
      yaw: r1(s.readings.yawDeg),
      pitch: r1(s.readings.pitchDeg),
      breath: r1(s.readings.breathSlope),
      mic: r1(s.micLevel),
      speaking: s.speaking,
      agent: s.agentSpeaking,
      camOn: st.cameraOn,
      micOn: st.micOn,
      sdk: this.sdk?.running ?? false,
    });
  }

  private attachEngine(engine: Engine): void {
    this.offEngine?.();
    this.engine = engine;
    this.offEngine = engine.on((ev) => {
      if (ev.type !== 'mic.edge') this.onEvent(ev);
    });
  }

  private resetEngine(): void {
    this.offEngine?.();
    this.offEngine = null;
    this.engine = null;
    this.lastCode = null;
    // Never show a previous session's cue lights.
    useApp.getState().set({ snapshot: null });
    this.replayer = null;
    this.interviewer = null;
    this.tickCount = 0;
  }

  arbiterSettings(): Partial<import('../turn/arbiter').ArbiterConfig> {
    const s = useApp.getState().settings;
    return { candidateSilenceMs: s.candidateSilenceMs, hardCapMs: s.hardCapMs, fallbackTimerMs: s.fallbackTimerMs, enabled: { ...s.cues } };
  }

  applySettings(): void {
    this.engine?.configure(this.arbiterSettings());
    this.ensureVoiceOptions();
  }

  private ensureVoiceOptions(): void {
    const s = useApp.getState().settings;
    this.voice?.setOptions({ voiceName: s.voiceName, rate: s.voiceRate });
  }

  // ---- results ----------------------------------------------------------------------
  async finish(): Promise<void> {
    const e = this.engine;
    const replay = this.mode === 'replay';
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    await this.stopSensing();
    this.voice?.cancel();
    if (!e) return;
    const st = useApp.getState();
    st.set({
      results: { summary: e.results.summary(), markdown: toMarkdown(e.results), csv: toCsv(e.results), canSave: !replay && !!this.recorder, savedAs: null },
      screen: 'results',
      banner: null,
    });
    this.wsSend({ type: 'session.stop', t: now() });
  }

  async saveSession(name: string): Promise<string | null> {
    if (!this.recorder) return null;
    const info = await window.htf.saveSession(name, this.recorder.text());
    return info.id;
  }

  // ---- stop -------------------------------------------------------------------------
  private async stopCameraOnly(): Promise<void> {
    // Tracks first: the camera light goes off without waiting for the SDK.
    for (const t of this.camStream?.getTracks() ?? []) t.stop();
    this.camStream = null;
    this.previewStream = null;
    useApp.getState().set({ cameraOn: false });
    const sdk = this.sdk;
    this.sdk = null;
    await sdk?.stop();
  }

  /** Stop button / Esc / F8 / close / quit: camera and mic off within 1 s. */
  async stopSensing(): Promise<void> {
    const t0 = now();
    const mic = this.mic;
    this.mic = null;
    for (const t of mic?.stream.getTracks() ?? []) t.stop();
    useApp.getState().set({ micOn: false });
    await Promise.race([Promise.all([this.stopCameraOnly(), mic?.stop()]), new Promise((r) => setTimeout(r, THRESHOLDS.stop.budgetMs))]);
    if (this.engine && !this.replayer) {
      this.engine.sdkStopped();
    }
    for (const l of this.stopListeners) l();
    dbg('stop', { ms: Math.round(now() - t0) });
    if (now() - t0 > THRESHOLDS.stop.budgetMs) console.warn('stopSensing exceeded its 1 s budget');
  }

  onStop(fn: () => void): () => void {
    this.stopListeners.add(fn);
    return () => this.stopListeners.delete(fn);
  }

  /** Leave the session entirely (back to Welcome). */
  async end(): Promise<void> {
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.voice?.cancel();
    await this.stopSensing();
    this.resetEngine();
    this.recorder = null;
    useApp.getState().set({ snapshot: null, question: null, banner: null, mode: 'live' });
  }

  get hasEngine(): boolean {
    return this.engine !== null;
  }

  get calibration(): CalibrationResult | null {
    return this.engine?.calibrationResult ?? null;
  }

  // ---- misc ---------------------------------------------------------------------------
  private banner(kind: 'error' | 'info', info: ReturnType<typeof errorInfo>, action?: () => void): void {
    useApp.getState().set({ banner: { kind, title: info.title, message: info.message, actionLabel: info.actionLabel, ...(action ? { action } : {}) } });
  }

  private wsSend(ev: unknown): void {
    if (useApp.getState().settings.websocket) window.htf.wsSend(ev);
  }
}

export const session = new Session();
