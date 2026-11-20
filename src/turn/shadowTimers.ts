// Shadow timers: fixed 0.7 / 2 / 3 / 4 s silence timers that run on the
// same live input as the arbiter and never drive the agent. Each reports
// when it would have ended the turn. If the user's speech resumes within
// 2.5 s of that moment, it would have cut them off.
//
// Other policies (the live arbiter in oracle mode) can register their ends
// with `markEnd` to get cut-offs counted the same way.
import { THRESHOLDS } from '../../config/thresholds';
import type { PolicyName, TurnEvent } from './events';

export const fixedPolicyName = (ms: number): PolicyName => `fixed-${ms}`;

interface Pending {
  policy: PolicyName;
  t: number;
}

export class ShadowTimers {
  private readonly policies: readonly number[];
  private readonly resumeMs: number;
  private turn = 0;
  private active = false;
  private silenceSince: number | null = null;
  private fired = new Set<number>();
  private pending: Pending[] = [];

  constructor(policiesMs: readonly number[] = THRESHOLDS.shadow.policiesMs, resumeMs: number = THRESHOLDS.shadow.cutOffResumeMs) {
    this.policies = [...policiesMs].sort((a, b) => a - b);
    this.resumeMs = resumeMs;
  }

  get names(): PolicyName[] {
    return this.policies.map(fixedPolicyName);
  }

  /** A new user turn starts (agent finished speaking). */
  beginTurn(turn: number): void {
    this.turn = turn;
    this.active = true;
    this.silenceSince = null;
    this.fired.clear();
    this.pending = [];
  }

  /** The real turn ended; nothing more is evaluated until the next turn. */
  endTurn(): void {
    this.active = false;
    this.silenceSince = null;
    this.pending = [];
  }

  speechStart(t: number): TurnEvent[] {
    if (!this.active) return [];
    const ev: TurnEvent[] = [];
    for (const p of this.pending) {
      if (t - p.t <= this.resumeMs && t >= p.t) ev.push({ type: 'shadow.cutoff', t, policy: p.policy, turn: this.turn });
    }
    this.pending = [];
    this.silenceSince = null;
    this.fired.clear();
    return ev;
  }

  speechEnd(t: number): void {
    if (!this.active) return;
    this.silenceSince = t;
    this.fired.clear();
  }

  markEnd(policy: PolicyName, t: number): void {
    if (!this.active) return;
    this.pending.push({ policy, t });
  }

  /** Seconds-of-silence check; emits a shadow.end at the exact would-be time. */
  tick(now: number): TurnEvent[] {
    if (!this.active || this.silenceSince === null) return [];
    const ev: TurnEvent[] = [];
    for (const ms of this.policies) {
      if (this.fired.has(ms)) continue;
      const at = this.silenceSince + ms;
      if (now >= at) {
        this.fired.add(ms);
        const policy = fixedPolicyName(ms);
        this.pending.push({ policy, t: at });
        ev.push({ type: 'shadow.end', t: at, policy, turn: this.turn });
      }
    }
    // Pending ends stay until speech resumes or the turn ends. Live, the
    // mic edge can arrive after a later tick (audio latency); the cut-off is
    // judged on the edge time itself, so ticks never discard them.
    return ev;
  }

  /** Time until a given policy would fire in the current silence (ms), or null. */
  remaining(now: number, ms: number): number | null {
    if (!this.active || this.silenceSince === null || this.fired.has(ms)) return null;
    return this.silenceSince + ms - now;
  }
}
