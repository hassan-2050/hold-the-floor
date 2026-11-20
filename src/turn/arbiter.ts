// The turn arbiter: decides when the user's turn is over.
//
//   AGENT ──agent done──▶ WAITING ──speech──▶ LISTENING
//   LISTENING ──silence ≥ 400 ms──▶ CANDIDATE_END
//   CANDIDATE_END ──cue engaged (true ≥ 120 ms)──▶ HOLDING
//   CANDIDATE_END / HOLDING ──no cue for 300 ms──▶ END_OF_TURN
//   CANDIDATE_END / HOLDING ──silence ≥ hard cap (8 s)──▶ END_OF_TURN
//   HOLDING ──speech──▶ LISTENING (no penalty)
//   any user state ──Send / Enter──▶ END_OF_TURN
//
// Weak cues: head turned alone holds at most 2.5 s per silence (plan) and
// breathing in alone at most 1.5 s (Stage 1; see thresholds.ts). With lips
// or talking present they hold without these limits.
//
// While camera quality is bad, cues are ignored and a fixed silence timer
// (default 2.0 s) ends the turn instead. Head-turned alone can hold for at
// most 2.5 s per silence. Pure: no clocks are read; the caller passes `now`.
import { THRESHOLDS } from '../../config/thresholds';
import { CUE_NAMES, type ArbiterState, type CueName, type EndReason, type PolicyName, type TurnEvent } from './events';

export interface ArbiterConfig {
  candidateSilenceMs: number;
  releaseMs: number;
  cueEngageMs: number;
  hardCapMs: number;
  headOnlyMaxMs: number;
  breathOnlyMaxMs: number;
  fallbackTimerMs: number;
  enabled: Record<CueName, boolean>;
  /**
   * When false (oracle test mode) the arbiter does not end the real turn:
   * its decision is reported as a shadow end, and the turn ends on Space.
   */
  drivesAgent: boolean;
}

export function defaultArbiterConfig(): ArbiterConfig {
  const a = THRESHOLDS.arbiter;
  return {
    candidateSilenceMs: a.candidateSilenceMs,
    releaseMs: a.releaseMs,
    cueEngageMs: a.cueEngageMs,
    hardCapMs: a.hardCapMs,
    headOnlyMaxMs: a.headOnlyMaxMs,
    breathOnlyMaxMs: a.breathOnlyMaxMs,
    fallbackTimerMs: a.fallbackTimerMs,
    enabled: { lips: true, head: true, breath: true, talking: true },
    drivesAgent: true,
  };
}

export interface CueInput {
  /** Raw (undebounced) cue values. Unavailable cues must be passed as false. */
  active: Record<CueName, boolean>;
  /** Words for the hold label, e.g. { lips: 'set' }. */
  detail: Record<CueName, string>;
  /** Camera quality OK: cues may be used. */
  cameraOk: boolean;
}

/** Strongest evidence first, for labelling a hold. */
const PRIORITY: readonly CueName[] = ['lips', 'talking', 'breath', 'head'];

export class TurnArbiter {
  state: ArbiterState = 'AGENT';
  turn = 0;
  private cfg: ArbiterConfig;
  private silenceSince: number | null = null;
  private candidateAt: number | null = null;
  private lastCueAt = -Infinity;
  private trueSince: Record<CueName, number | null> = { lips: null, head: null, breath: null, talking: null };
  private weakSince: number | null = null;
  private weakSpent = new Set<CueName>();
  private heldThisSilence = false;
  private holdCue: CueName | null = null;
  private lastSpeechEnd: number | null = null;
  /** Oracle mode: the arbiter already reported its shadow end for this silence. */
  private shadowEnded = false;

  constructor(cfg: ArbiterConfig = defaultArbiterConfig()) {
    this.cfg = { ...cfg, enabled: { ...cfg.enabled } };
  }

  configure(cfg: Partial<ArbiterConfig>): void {
    this.cfg = { ...this.cfg, ...cfg, enabled: { ...this.cfg.enabled, ...(cfg.enabled ?? {}) } };
  }

  get config(): Readonly<ArbiterConfig> {
    return this.cfg;
  }

  /** Cue currently holding the floor (HOLDING only). */
  get holdingCue(): CueName | null {
    return this.state === 'HOLDING' ? this.holdCue : null;
  }

  get silenceStart(): number | null {
    return this.silenceSince;
  }

  // ---- agent ------------------------------------------------------------
  agentStarted(_t: number): void {
    this.state = 'AGENT';
    this.clearSilence();
  }

  /** The agent finished speaking: a new user turn begins. */
  agentFinished(_t: number): void {
    this.turn++;
    this.state = 'WAITING';
    this.clearSilence();
    this.lastSpeechEnd = null;
  }

  // ---- mic edges ----------------------------------------------------------
  speechStart(t: number): TurnEvent[] {
    const ev: TurnEvent[] = [];
    if (this.state === 'AGENT') return ev;
    if (this.state === 'END_OF_TURN') {
      // In driving mode the agent is about to speak; in oracle mode the
      // user simply continues and the arbiter keeps watching.
      if (this.cfg.drivesAgent) return ev;
    }
    if (this.state === 'HOLDING' || this.state === 'CANDIDATE_END' || this.state === 'END_OF_TURN') {
      ev.push({ type: 'turn.resume', t });
    }
    this.state = 'LISTENING';
    this.clearSilence();
    return ev;
  }

  speechEnd(t: number): void {
    if (this.state !== 'LISTENING') return;
    this.silenceSince = t;
    this.lastSpeechEnd = t;
    this.candidateAt = null;
    this.heldThisSilence = false;
    this.weakSpent.clear();
    this.weakSince = null;
    this.shadowEnded = false;
  }

  // ---- user actions -------------------------------------------------------
  /** Enter / Send: always ends the turn. */
  send(t: number): TurnEvent[] {
    if (this.state === 'AGENT' || this.state === 'END_OF_TURN') return [];
    return this.end(t, 'send', 'hold-the-floor', true);
  }

  /** Oracle mode: Space = "I am truly done". */
  oracleDone(t: number): TurnEvent[] {
    if (this.state === 'AGENT') return [];
    const ev: TurnEvent[] = [];
    ev.push(this.endEvent(t, 'oracle', 'oracle'));
    this.state = 'END_OF_TURN';
    return ev;
  }

  // ---- tick ---------------------------------------------------------------
  tick(now: number, input: CueInput): TurnEvent[] {
    this.trackCues(now, input);
    const ev: TurnEvent[] = [];
    if (this.state === 'LISTENING' && this.silenceSince !== null) {
      if (now - this.silenceSince >= this.cfg.candidateSilenceMs) {
        this.state = 'CANDIDATE_END';
        this.candidateAt = this.silenceSince + this.cfg.candidateSilenceMs;
      }
    }
    if (this.state !== 'CANDIDATE_END' && this.state !== 'HOLDING') return ev;
    if (this.silenceSince === null || this.candidateAt === null) return ev;
    if (this.shadowEnded) return ev;

    const silence = now - this.silenceSince;
    if (!input.cameraOk) {
      if (this.state === 'HOLDING') this.state = 'CANDIDATE_END';
      if (silence >= this.cfg.fallbackTimerMs) return this.end(now, 'fallback-timer', 'fallback-timer');
      return ev;
    }
    if (silence >= this.cfg.hardCapMs) return this.end(now, 'hard-cap', 'hold-the-floor');

    const engaged = this.engagedCues(now);
    if (engaged.length) {
      this.lastCueAt = now;
      const cue = PRIORITY.find((c) => engaged.includes(c))!;
      if (this.state !== 'HOLDING' || cue !== this.holdCue) {
        this.state = 'HOLDING';
        this.holdCue = cue;
        this.heldThisSilence = true;
        ev.push({ type: 'turn.hold', t: now, cue, detail: input.detail[cue] });
      }
      return ev;
    }
    const since = Math.max(this.lastCueAt, this.candidateAt);
    if (now - since >= this.cfg.releaseMs) {
      return this.end(now, this.heldThisSilence ? 'cues-relaxed' : 'no-cue', 'hold-the-floor');
    }
    return ev;
  }

  // ---- internals ------------------------------------------------------------
  private trackCues(now: number, input: CueInput): void {
    for (const c of CUE_NAMES) {
      const on = input.cameraOk && this.cfg.enabled[c] && input.active[c];
      if (on) this.trueSince[c] ??= now;
      else this.trueSince[c] = null;
    }
  }

  private engagedCues(now: number): CueName[] {
    const out: CueName[] = [];
    for (const c of CUE_NAMES) {
      const since = this.trueSince[c];
      if (since !== null && now - since >= this.cfg.cueEngageMs) out.push(c);
    }
    // Weak cues (head, breath) on their own hold for a limited time per silence.
    const strong = out.some((c) => c === 'lips' || c === 'talking');
    if (strong) {
      this.weakSince = null;
      return out;
    }
    const weak = out.filter((c) => !this.weakSpent.has(c));
    if (!weak.length) {
      this.weakSince = null;
      return [];
    }
    this.weakSince ??= now;
    const limit = Math.max(...weak.map((c) => (c === 'head' ? this.cfg.headOnlyMaxMs : this.cfg.breathOnlyMaxMs)));
    if (now - this.weakSince >= limit) {
      for (const c of weak) this.weakSpent.add(c);
      this.weakSince = null;
      return [];
    }
    return weak;
  }

  private end(t: number, reason: EndReason, policy: PolicyName, force = false): TurnEvent[] {
    const e = this.endEvent(t, reason, policy);
    if (!this.cfg.drivesAgent && !force) {
      // Oracle mode: report as a shadow decision and keep listening.
      this.shadowEnded = true;
      this.holdCue = null;
      this.state = 'CANDIDATE_END';
      return [{ type: 'shadow.end', t, policy, turn: this.turn }];
    }
    this.state = 'END_OF_TURN';
    this.holdCue = null;
    return [e];
  }

  private endEvent(t: number, reason: EndReason, policy: PolicyName): TurnEvent {
    const silenceMs = this.lastSpeechEnd !== null ? t - this.lastSpeechEnd : 0;
    return { type: 'turn.end', t, reason, policy, silenceMs, turn: this.turn };
  }

  private clearSilence(): void {
    this.silenceSince = null;
    this.candidateAt = null;
    this.holdCue = null;
    this.lastCueAt = -Infinity;
    this.weakSince = null;
    this.weakSpent.clear();
    this.shadowEnded = false;
  }
}
