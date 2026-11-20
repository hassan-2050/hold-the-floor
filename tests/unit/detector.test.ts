import { describe, expect, it } from 'vitest';
import { MicDetector, speechThresholdDb } from '../../src/audio/detector';
import type { MicEdge } from '../../src/turn/events';

function feed(d: MicDetector, from: number, to: number, db: number): MicEdge[] {
  const e: MicEdge[] = [];
  for (let t = from + 20; t <= to; t += 20) e.push(...d.push(t, db));
  return e;
}

describe('speechThresholdDb', () => {
  it('uses floor + 12 dB when speech is loud enough', () => {
    expect(speechThresholdDb({ floorDb: -60, speechDb: -30 })).toBe(-48);
  });
  it('adapts to half the margin for quiet speech, never below +6 dB', () => {
    expect(speechThresholdDb({ floorDb: -50, speechDb: -40 })).toBe(-44); // margin 10 → +6 (clamped from 5)
    expect(speechThresholdDb({ floorDb: -50, speechDb: -32 })).toBe(-41); // margin 18 → +9
  });
  it('falls back to +12 dB without a speech measurement', () => {
    expect(speechThresholdDb({ floorDb: -55 })).toBe(-43);
  });
});

describe('MicDetector', () => {
  const mk = (): MicDetector => new MicDetector({ floorDb: -60, speechDb: -30 });

  it('speech needs ≥ 60 ms above the speech threshold; the edge is at the run start', () => {
    const d = mk();
    expect(feed(d, 0, 40, -40)).toEqual([]); // 40 ms loud: not yet
    const d2 = mk();
    const e = feed(d2, 0, 100, -40);
    expect(e).toEqual([{ kind: 'speech-start', t: 0 }]);
  });

  it('silence needs ≥ 150 ms below floor + 6 dB', () => {
    const d = mk();
    feed(d, 0, 200, -40);
    expect(feed(d, 200, 320, -58)).toEqual([]);
    const d2 = mk();
    feed(d2, 0, 200, -40);
    expect(feed(d2, 200, 400, -58)).toEqual([{ kind: 'speech-end', t: 200 }]);
  });

  it('mid-level sound neither starts nor ends speech (hysteresis)', () => {
    const d = mk();
    feed(d, 0, 200, -40);
    expect(feed(d, 200, 1000, -51)).toEqual([]); // between -54 and -48
    expect(d.isSpeaking).toBe(true);
  });

  it('half-duplex: ignores the mic while the agent speaks and 200 ms after', () => {
    const d = mk();
    d.setAgentSpeaking(true, 0);
    expect(feed(d, 0, 1000, -30)).toEqual([]);
    d.setAgentSpeaking(false, 1000);
    expect(feed(d, 1000, 1180, -30)).toEqual([]);
    // The first window after the tail ends at 1200 and covers 1180-1200.
    expect(feed(d, 1180, 1400, -30)).toEqual([{ kind: 'speech-start', t: 1180 }]);
  });

  it('agent starting while the user speaks closes the speech segment', () => {
    const d = mk();
    feed(d, 0, 200, -40);
    expect(d.setAgentSpeaking(true, 250)).toEqual([{ kind: 'speech-end', t: 250 }]);
  });
});
