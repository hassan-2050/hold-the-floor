// Session results: per-turn records and a per-policy summary of would-be
// cut-offs and reply delay, from the same live input. Pure.
//
// Definitions (plan F8):
// - cut-off: a policy ended the turn and the user's speech resumed within
//   2.5 s. Fixed timers: counted from shadow.cutoff. Hold the Floor: in
//   oracle mode from its shadow.cutoff; in normal mode from "I wasn't
//   finished" presses (the mic is ignored while the agent talks, so a
//   resume cannot be heard).
// - premature end (oracle mode only): a policy ended the turn and the user
//   then kept talking before pressing Space, however long the pause. This
//   is the ground-truth count; the 2.5 s cut-off window can flatter fast
//   policies when pauses are long.
// - reply delay: end time − the user's last speech offset. A fixed timer's
//   delay is its length by definition.
import { THRESHOLDS } from '../../config/thresholds';
import { median } from '../features/stats';
import type { CueName, EndReason, MicEdge, PolicyName, TurnEvent } from '../turn/events';

export interface TurnRecord {
  turn: number;
  question: string;
  firstSpeech: number | null;
  lastSpeechEnd: number | null;
  end: { t: number; reason: EndReason; policy: PolicyName } | null;
  /** Oracle mode: when Hold the Floor would have ended (final decision). */
  htfEnd: number | null;
  /** Oracle mode: Hold the Floor had not decided yet when Space was pressed. */
  htfUndecided: boolean;
  holds: Partial<Record<CueName, number>>;
  cutoffs: Partial<Record<PolicyName, number>>;
  /** Oracle mode: ends followed by more speech before Space. */
  premature: Partial<Record<PolicyName, number>>;
  notDone: number;
  /** Silent gaps inside the turn (ms), between speech segments. */
  pauses: number[];
}

export interface PolicySummary {
  policy: PolicyName;
  label: string;
  cutoffs: number;
  /** Oracle mode only; null otherwise. */
  premature: number | null;
  medianDelayMs: number | null;
  turns: number;
}

export interface SessionSummary {
  oracle: boolean;
  turns: number;
  policies: PolicySummary[];
  holdsByCue: Record<CueName, number>;
  fallbackCount: number;
  endsByReason: Partial<Record<EndReason, number>>;
}

export const policyLabel = (p: PolicyName): string =>
  p === 'hold-the-floor' ? 'Hold the Floor' : p === 'fallback-timer' ? 'Fallback timer' : p === 'oracle' ? 'You (Space)' : `${(Number(p.slice(6)) / 1000).toFixed(1)} s timer`;

export class SessionResults {
  readonly turns: TurnRecord[] = [];
  private cur: TurnRecord | null = null;
  private speechOn = false;
  private lastEnd: number | null = null;
  private fallbacks = 0;
  private shadowHtf: number | null = null;
  /** Policies that ended during the current silence. */
  private silenceEnds = new Set<PolicyName>();

  constructor(readonly oracle: boolean, readonly policiesMs: readonly number[] = THRESHOLDS.shadow.policiesMs) {}

  beginTurn(turn: number, question: string): void {
    this.closeTurn();
    this.cur = {
      turn,
      question,
      firstSpeech: null,
      lastSpeechEnd: null,
      end: null,
      htfEnd: null,
      htfUndecided: false,
      holds: {},
      cutoffs: {},
      premature: {},
      notDone: 0,
      pauses: [],
    };
    this.turns.push(this.cur);
    this.speechOn = false;
    this.lastEnd = null;
    this.shadowHtf = null;
    this.silenceEnds.clear();
  }

  /** "I wasn't finished": the same turn reopens. */
  reopen(): void {
    if (!this.cur) return;
    this.cur.notDone++;
    this.cur.end = null;
  }

  edge(e: MicEdge): void {
    const r = this.cur;
    if (!r || r.end) return;
    if (e.kind === 'speech-start') {
      if (r.firstSpeech === null) r.firstSpeech = e.t;
      else if (this.lastEnd !== null) r.pauses.push(e.t - this.lastEnd);
      for (const p of this.silenceEnds) r.premature[p] = (r.premature[p] ?? 0) + 1;
      this.silenceEnds.clear();
      this.speechOn = true;
      this.shadowHtf = null;
    } else {
      this.speechOn = false;
      this.lastEnd = e.t;
      r.lastSpeechEnd = e.t;
    }
  }

  event(ev: TurnEvent): void {
    if (ev.type === 'quality.fallback') this.fallbacks++;
    const r = this.cur;
    if (!r) return;
    switch (ev.type) {
      case 'turn.hold':
        r.holds[ev.cue] = (r.holds[ev.cue] ?? 0) + 1;
        break;
      case 'turn.end':
        if (!r.end) r.end = { t: ev.t, reason: ev.reason, policy: ev.policy };
        if (ev.policy === 'oracle') {
          r.htfEnd = this.shadowHtf;
          r.htfUndecided = this.shadowHtf === null;
        }
        break;
      case 'shadow.end':
        if (ev.policy === 'hold-the-floor' || ev.policy === 'fallback-timer') {
          this.shadowHtf = ev.t;
          this.silenceEnds.add('hold-the-floor');
        } else this.silenceEnds.add(ev.policy);
        break;
      case 'shadow.cutoff':
        r.cutoffs[ev.policy] = (r.cutoffs[ev.policy] ?? 0) + 1;
        break;
      default:
        break;
    }
  }

  private closeTurn(): void {
    this.cur = null;
  }

  summary(): SessionSummary {
    const done = this.turns.filter((t) => t.end && t.firstSpeech !== null);
    const holdsByCue: Record<CueName, number> = { lips: 0, head: 0, breath: 0, talking: 0 };
    const endsByReason: Partial<Record<EndReason, number>> = {};
    for (const t of done) {
      for (const [c, n] of Object.entries(t.holds)) holdsByCue[c as CueName] += n ?? 0;
      endsByReason[t.end!.reason] = (endsByReason[t.end!.reason] ?? 0) + 1;
    }
    const htfDelays: number[] = [];
    let htfCut = 0;
    let htfPre = 0;
    for (const t of done) {
      htfPre += t.premature['hold-the-floor'] ?? 0;
      if (this.oracle) {
        htfCut += (t.cutoffs['hold-the-floor'] ?? 0) + (t.cutoffs['fallback-timer'] ?? 0);
        const end = t.htfEnd ?? (t.htfUndecided ? t.end!.t : null);
        if (end !== null && t.lastSpeechEnd !== null) htfDelays.push(end - t.lastSpeechEnd);
      } else {
        htfCut += t.notDone;
        if (t.end!.reason !== 'send' && t.lastSpeechEnd !== null) htfDelays.push(t.end!.t - t.lastSpeechEnd);
      }
    }
    const policies: PolicySummary[] = [
      {
        policy: 'hold-the-floor',
        label: policyLabel('hold-the-floor'),
        cutoffs: htfCut,
        premature: this.oracle ? htfPre : null,
        medianDelayMs: htfDelays.length ? median(htfDelays) : null,
        turns: done.length,
      },
    ];
    for (const ms of this.policiesMs) {
      const p: PolicyName = `fixed-${ms}`;
      let cut = 0;
      let pre = 0;
      for (const t of done) {
        cut += t.cutoffs[p] ?? 0;
        pre += t.premature[p] ?? 0;
      }
      policies.push({ policy: p, label: policyLabel(p), cutoffs: cut, premature: this.oracle ? pre : null, medianDelayMs: ms, turns: done.length });
    }
    return { oracle: this.oracle, turns: done.length, policies, holdsByCue, fallbackCount: this.fallbacks, endsByReason };
  }
}

// ---- export ---------------------------------------------------------------
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(res: SessionResults): string {
  const s = res.summary();
  const lines = ['section,policy,cutoffs,premature_ends,median_reply_delay_s,turns'];
  for (const p of s.policies) {
    lines.push(
      ['summary', p.label, p.cutoffs, p.premature ?? '', p.medianDelayMs === null ? '' : (p.medianDelayMs / 1000).toFixed(2), p.turns].map(csvCell).join(','),
    );
  }
  lines.push('');
  lines.push('section,turn,question,end_reason,end_policy,reply_delay_s,holds_lips,holds_talking,holds_breath,holds_head,pauses_s,cutoffs');
  for (const t of res.turns) {
    const delay = t.end && t.lastSpeechEnd !== null ? ((t.end.t - t.lastSpeechEnd) / 1000).toFixed(2) : '';
    const cut = Object.entries(t.cutoffs)
      .map(([p, n]) => `${policyLabel(p as PolicyName)}:${n}`)
      .join(' ');
    lines.push(
      [
        'turn',
        t.turn,
        t.question,
        t.end?.reason ?? '',
        t.end ? policyLabel(t.end.policy) : '',
        delay,
        t.holds.lips ?? 0,
        t.holds.talking ?? 0,
        t.holds.breath ?? 0,
        t.holds.head ?? 0,
        t.pauses.map((p) => (p / 1000).toFixed(2)).join(' '),
        cut,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

export function toMarkdown(res: SessionResults, title = 'Hold the Floor session results'): string {
  const s = res.summary();
  const out: string[] = [`# ${title}`, ''];
  out.push(`Mode: ${s.oracle ? 'oracle test (you pressed Space when truly done)' : 'conversation'} · turns: ${s.turns} · camera fallbacks: ${s.fallbackCount}`, '');
  const pre = s.oracle;
  out.push(
    pre ? '| Policy | Would-be cut-offs | Premature ends | Median reply delay |' : '| Policy | Would-be cut-offs | Median reply delay |',
    pre ? '| --- | ---: | ---: | ---: |' : '| --- | ---: | ---: |',
  );
  for (const p of s.policies) {
    const delay = p.medianDelayMs === null ? '—' : `${(p.medianDelayMs / 1000).toFixed(2)} s`;
    out.push(pre ? `| ${p.label} | ${p.cutoffs} | ${p.premature ?? '—'} | ${delay} |` : `| ${p.label} | ${p.cutoffs} | ${delay} |`);
  }
  out.push('', `Holds by cue: lips ${s.holdsByCue.lips}, talking ${s.holdsByCue.talking}, breath ${s.holdsByCue.breath}, head ${s.holdsByCue.head}.`, '');
  out.push(
    'A cut-off means the policy ended the turn and you started speaking again within 2.5 s. A premature end (oracle mode) means it ended the turn and you went on speaking before pressing Space, however long the pause. Fixed timers never drive the agent; they are evaluated on the same live input.',
    '',
  );
  return out.join('\n');
}
