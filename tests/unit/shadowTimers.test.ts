import { describe, expect, it } from 'vitest';
import { ShadowTimers } from '../../src/turn/shadowTimers';
import type { TurnEvent } from '../../src/turn/events';

const tickTo = (s: ShadowTimers, from: number, to: number): TurnEvent[] => {
  const ev: TurnEvent[] = [];
  for (let t = from; t <= to; t += 10) ev.push(...s.tick(t));
  return ev;
};

describe('ShadowTimers', () => {
  it('each fixed timer reports its would-be end at silence start + its length', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechStart(0);
    s.speechEnd(1000);
    const ev = tickTo(s, 1000, 6000).filter((e) => e.type === 'shadow.end');
    expect(ev.map((e) => [e.policy, e.t])).toEqual([
      ['fixed-700', 1700],
      ['fixed-2000', 3000],
      ['fixed-3000', 4000],
      ['fixed-4000', 5000],
    ]);
  });

  it('a 3 s pause with speech resuming: 0.7 s and 2 s timers cut off, 3 s and 4 s do not', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechStart(0);
    s.speechEnd(1000);
    tickTo(s, 1000, 3990);
    const cut = s.speechStart(4000 - 10); // resumed after 2.99 s
    expect(cut.map((e) => (e as { policy: string }).policy).sort()).toEqual(['fixed-2000', 'fixed-700']);
  });

  it('speech resuming more than 2.5 s after a timer fired is not a cut-off', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechEnd(0);
    tickTo(s, 0, 3300);
    // 0.7 s fired 2.6 s before the resume: not a cut-off. 2 s and 3 s were.
    const cut = s.speechStart(3300);
    expect(cut.map((e) => (e as { policy: string }).policy)).toEqual(['fixed-2000', 'fixed-3000']);
  });

  it('a resume processed after a later tick still counts by its own time (mic latency)', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechEnd(0);
    // Live demo, answer 3: the speech start 2.46 s after the 0.7 s timer fired
    // reached the engine only after a tick at 2.56 s.
    tickTo(s, 0, 3260);
    const cut = s.speechStart(3160);
    expect(cut.map((e) => (e as { policy: string }).policy)).toEqual(['fixed-700', 'fixed-2000', 'fixed-3000']);
  });

  it('markEnd lets another policy be scored the same way', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechEnd(0);
    s.markEnd('hold-the-floor', 700);
    const cut = s.speechStart(1500);
    expect(cut).toContainEqual({ type: 'shadow.cutoff', t: 1500, policy: 'hold-the-floor', turn: 1 });
  });

  it('nothing is evaluated after the real turn ends', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechEnd(0);
    s.endTurn();
    expect(tickTo(s, 0, 6000)).toEqual([]);
  });

  it('remaining() counts down for the 2 s comparison view', () => {
    const s = new ShadowTimers();
    s.beginTurn(1);
    s.speechEnd(1000);
    expect(s.remaining(1500, 2000)).toBe(1500);
    tickTo(s, 1000, 3000);
    expect(s.remaining(3100, 2000)).toBeNull();
  });
});
