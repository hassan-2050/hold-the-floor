// Turns a SmartSpectra `metrics` buffer into plain numbers.
//
// Field names follow the generated protobuf typings in
// @smartspectra/node-sdk/messages (SDK 3.5.0): breathing.rate[],
// breathing.upperTrace[] (chest), breathing.lowerTrace[] (abdomen),
// face.talking[], face.landmarks[]. Every field is a repeated list; a packet
// may carry zero, one or several samples of each. Timestamps are int64
// microseconds since the Unix epoch and arrive as Long objects.
//
// Nothing is filled in: a field that is absent stays an empty list.
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { RawPacket, RawSample, RawRate, RawTalking, RawLandmarks } from './types';

type Num = number | { toString(): string } | null | undefined;

const n = (v: Num): number => (v === null || v === undefined ? NaN : Number(v));

interface PMeasurement {
  value?: number | null;
  stable?: boolean | null;
  timestamp?: Num;
}
interface PRate extends PMeasurement {
  confidence?: number | null;
}
interface PDetection {
  detected?: boolean | null;
  stable?: boolean | null;
  timestamp?: Num;
}
interface PLandmarks {
  value?: { x?: number | null; y?: number | null }[] | null;
  stable?: boolean | null;
  reset?: boolean | null;
  timestamp?: Num;
}

function samples(list: PMeasurement[] | null | undefined): RawSample[] {
  if (!list) return [];
  const out: RawSample[] = [];
  for (const m of list) {
    const v = n(m.value);
    const t = n(m.timestamp);
    if (!Number.isFinite(v) || !Number.isFinite(t)) continue;
    out.push({ v, stable: !!m.stable, tUs: t });
  }
  return out;
}

function rates(list: PRate[] | null | undefined): RawRate[] {
  if (!list) return [];
  const out: RawRate[] = [];
  for (const m of list) {
    const v = n(m.value);
    const t = n(m.timestamp);
    if (!Number.isFinite(v) || !Number.isFinite(t)) continue;
    out.push({ v, stable: !!m.stable, conf: n(m.confidence) || 0, tUs: t });
  }
  return out;
}

function talking(list: PDetection[] | null | undefined): RawTalking[] {
  if (!list) return [];
  const out: RawTalking[] = [];
  for (const d of list) {
    const t = n(d.timestamp);
    if (!Number.isFinite(t)) continue;
    out.push({ detected: !!d.detected, stable: !!d.stable, tUs: t });
  }
  return out;
}

function landmarks(list: PLandmarks[] | null | undefined): RawLandmarks[] {
  if (!list) return [];
  const out: RawLandmarks[] = [];
  for (const l of list) {
    const t = n(l.timestamp);
    const pts = l.value ?? [];
    if (!Number.isFinite(t)) continue;
    const xy = new Array<number>(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      xy[i * 2] = n(p?.x);
      xy[i * 2 + 1] = n(p?.y);
    }
    out.push({ xy, stable: !!l.stable, reset: !!l.reset, tUs: t });
  }
  return out;
}

export function decodePacket(buf: Uint8Array, packetTsUs: number, rxMs: number): RawPacket {
  const m = decodeMetrics(buf) as unknown as {
    breathing?: { rate?: PRate[]; upperTrace?: PMeasurement[]; lowerTrace?: PMeasurement[] } | null;
    face?: { talking?: PDetection[]; landmarks?: PLandmarks[] } | null;
  };
  return {
    rxMs,
    packetTsUs,
    chest: samples(m.breathing?.upperTrace),
    abdomen: samples(m.breathing?.lowerTrace),
    rate: rates(m.breathing?.rate),
    talking: talking(m.face?.talking),
    landmarks: landmarks(m.face?.landmarks),
  };
}
