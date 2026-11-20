// Replay: feeds a numbers-only recording through the same Engine as live
// sensing. Pure (no SDK, no DOM). The UI drives `advanceTo` from a clock;
// tests and the ablation script call `runAll`.
import { lookupFromSubset } from '../features/geometry';
import type { Engine, EnginePacket } from '../turn/engine';
import { THRESHOLDS } from '../../config/thresholds';
import type { RecLine, RecordingHeader } from './recording';

export interface TimedInput {
  t: number;
  line: RecLine;
}

export interface ParsedRecording {
  header: RecordingHeader | null;
  inputs: TimedInput[];
  start: number;
  end: number;
  /** Probe logs: protocol phases, mapped to calibration steps. */
  isProbe: boolean;
}

const lineTime = (l: RecLine): number | null => {
  switch (l.k) {
    case 'm':
    case 'v':
    case 'e':
      return l.rx;
    case 'hdr':
      return null;
    default:
      return 't' in l ? l.t : null;
  }
};

export function parseRecording(text: string): ParsedRecording {
  let header: RecordingHeader | null = null;
  const inputs: TimedInput[] = [];
  let isProbe = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let l: RecLine & { k: string };
    try {
      l = JSON.parse(raw);
    } catch {
      continue;
    }
    if (l.k === 'hdr') {
      header = l as RecordingHeader;
      continue;
    }
    if (l.k === 'p') isProbe = true;
    if (!['m', 'v', 'e', 'sdk', 'a', 'agent', 'cal', 'act', 'p', 'started'].includes(l.k)) continue;
    // Probe logs mark the SDK start as {k:'started', rx}.
    if ((l.k as string) === 'started') {
      inputs.push({ t: (l as unknown as { rx: number }).rx, line: { k: 'sdk', t: (l as unknown as { rx: number }).rx, s: 'started' } });
      continue;
    }
    const t = lineTime(l);
    if (t === null || !Number.isFinite(t)) continue;
    // v1 files stamped "agent speaking" when the question was queued; the
    // live engine only saw it once the voice began. Split such a line into
    // the question text (at the stamp) and the start of speech (later).
    if (l.k === 'agent' && l.speaking === true && (header?.v ?? 1) < 2) {
      const start = t + THRESHOLDS.replay.v1AgentStartDelayMs;
      if (l.text !== undefined) inputs.push({ t, line: { k: 'agent', t, text: l.text } });
      inputs.push({ t: start, line: { k: 'agent', t: start, speaking: true } });
      continue;
    }
    inputs.push({ t, line: l });
  }
  inputs.sort((a, b) => a.t - b.t);
  return { header, inputs, start: inputs[0]?.t ?? 0, end: inputs.at(-1)?.t ?? 0, isProbe };
}

/** Probe phases → calibration steps and turn boundaries. */
function probeMapping(phase: string): 'rest' | 'press' | 'question' | null | 'turn' | 'stop' {
  if (phase === 'rest') return 'rest';
  if (phase === 'press') return 'press';
  if (phase === 'relax') return null;
  if (phase === 'speak' || phase === 'pause' || phase === 'exhale') return 'turn';
  return 'stop';
}

export class Replayer {
  private i = 0;
  private nextTick: number;
  private probeTurnOpen = false;
  private probeCalDone = false;
  private sdkSeen = false;
  readonly tickMs = 1000 / 30;

  constructor(
    readonly rec: ParsedRecording,
    readonly engine: Engine,
    private readonly onLine?: (l: RecLine) => void,
  ) {
    this.nextTick = rec.start;
  }

  get position(): number {
    return this.i < this.rec.inputs.length ? this.rec.inputs[this.i]!.t : this.rec.end;
  }

  get done(): boolean {
    return this.i >= this.rec.inputs.length;
  }

  /** Feed everything up to recording time `t`, ticking at 30 Hz in between. */
  advanceTo(t: number): void {
    const e = this.engine;
    const inputs = this.rec.inputs;
    while (this.i < inputs.length && inputs[this.i]!.t <= t) {
      const { t: at, line } = inputs[this.i]!;
      while (this.nextTick <= at) {
        e.tick(this.nextTick);
        this.nextTick += this.tickMs;
      }
      this.apply(at, line);
      this.onLine?.(line);
      this.i++;
    }
    while (this.nextTick <= t) {
      e.tick(this.nextTick);
      this.nextTick += this.tickMs;
    }
  }

  runAll(): void {
    this.advanceTo(this.rec.end + 3000);
  }

  private apply(at: number, l: RecLine): void {
    const e = this.engine;
    switch (l.k) {
      case 'm': {
        if (!this.sdkSeen) {
          this.sdkSeen = true;
          e.sdkStarted(at);
        }
        const p: EnginePacket = {
          rxMs: l.rx,
          landmarks: (l.lm ?? []).map((x) => ({ tMs: x.t / 1000, pts: lookupFromSubset(x.k), stable: x.s === 1, reset: x.r === 1 })),
          chest: (l.c ?? []).map((c) => ({ v: c[0], stable: c[1] === 1, tUs: c[2] })),
          talking: (l.tk ?? []).map((x) => ({ detected: x[0] === 1, stable: x[1] === 1, tUs: x[2] })),
          rate: (l.r ?? []).map((x) => ({ v: x[0], stable: x[1] === 1, conf: x[2], tUs: x[3] })),
        };
        e.packet(p);
        break;
      }
      case 'v':
        e.validation(l.code, l.hint);
        break;
      case 'e':
        e.sdkError(l.code, l.message);
        break;
      case 'sdk':
        if (l.s === 'started') {
          this.sdkSeen = true;
          e.sdkStarted(at);
        } else e.sdkStopped();
        break;
      case 'a':
        e.micSample(l.t, l.db);
        break;
      case 'agent':
        if (l.text) e.setQuestion(l.text);
        if (l.speaking !== undefined) e.agentSpeakingChanged(l.speaking, l.t);
        break;
      case 'cal':
        if (l.step) e.beginCalibration(l.step);
        else e.finishCalibration();
        break;
      case 'act':
        if (l.a === 'send') e.send(l.t);
        else if (l.a === 'oracle') e.oracleDone(l.t);
        else e.notDone(l.t);
        break;
      case 'p':
        this.probePhase(at, l.phase);
        break;
      default:
        break;
    }
  }

  /**
   * Probe logs have no agent: the protocol's rest/press steps calibrate,
   * and the speak/pause cycles form one long oracle turn that ends when the
   * protocol ends.
   */
  private probePhase(at: number, phase: string): void {
    const e = this.engine;
    const m = probeMapping(phase);
    if (m === 'rest' || m === 'press') {
      e.beginCalibration(m);
      return;
    }
    if (m === null) {
      if (e.calibrator.current) e.calibrator.stop();
      return;
    }
    if (m === 'turn' && !this.probeTurnOpen) {
      if (!this.probeCalDone) {
        e.finishCalibration();
        this.probeCalDone = true;
      }
      e.setQuestion('Probe protocol: count aloud, pause, breathe');
      e.agentSpeakingChanged(true, at - 1);
      e.agentSpeakingChanged(false, at);
      this.probeTurnOpen = true;
      return;
    }
    if (m === 'stop' && this.probeTurnOpen) {
      if (e.options.oracle) e.oracleDone(at);
      else e.send(at);
      this.probeTurnOpen = false;
    }
  }
}
