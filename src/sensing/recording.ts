// Numbers-only session recordings (JSON lines). Pure: no SDK import.
//
// The format is the Stage 1 probe format, so probe logs replay too:
//   {k:'hdr', v, app, created, oracle, micEnabled, cameraEnabled, settings}
//   {k:'m', rx, lm:[{t,s,r,k:{idx:[x,y]}}], c:[[v,s,tUs]], a:[...], tk:[[d,s,tUs]], r:[[v,s,conf,tUs]]}
//   {k:'v', rx, code, hint}   validation status
//   {k:'e', rx, code, message} SDK error
//   {k:'sdk', t, s:'started'|'stopped'}
//   {k:'a', t, db}            mic loudness, one value per 20 ms
//   {k:'agent', t, text}       question queued (v2)
//   {k:'agent', t, speaking}   the agent's voice started/stopped (v2; what the
//                              engine sees). v1 files wrote speaking:true with
//                              the text when the question was queued.
//   {k:'cal', t, step|null}   calibration step boundaries
//   {k:'act', t, a:'send'|'oracle'|'notdone'}
//   {k:'p', t, phase, i}      probe protocol phases (probe logs only)
// Only the landmark subset in RECORDED_LANDMARKS is kept; never frames,
// never audio, never the full face mesh.
import { RECORDED_LANDMARKS } from '../features/landmarkIndex';
import type { RawPacket } from './types';

export const RECORDING_VERSION = 2;

export interface RecordingHeader {
  k: 'hdr';
  v: number;
  app: 'hold-the-floor';
  created: string;
  oracle: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  settings?: Record<string, unknown>;
}

export type RecLine =
  | RecordingHeader
  | { k: 'm'; rx: number; lm?: { t: number; s: 0 | 1; r: 0 | 1; k: Record<number, [number, number]> }[]; c?: [number, 0 | 1, number][]; a?: [number, 0 | 1, number][]; tk?: [0 | 1, 0 | 1, number][]; r?: [number, 0 | 1, number, number][] }
  | { k: 'v'; rx: number; code: number; hint: string }
  | { k: 'e'; rx: number; code: number; message: string }
  | { k: 'sdk'; t: number; s: 'started' | 'stopped' }
  | { k: 'a'; t: number; db: number }
  | { k: 'agent'; t: number; speaking?: boolean; text?: string }
  | { k: 'cal'; t: number; step: 'rest' | 'press' | 'question' | null }
  | { k: 'act'; t: number; a: 'send' | 'oracle' | 'notdone' }
  | { k: 'p'; t: number; phase: string; i: number | null };

const r1 = (x: number): number => Math.round(x * 10) / 10;

export function packetLine(p: RawPacket): RecLine {
  const line: Extract<RecLine, { k: 'm' }> = { k: 'm', rx: r1(p.rxMs) };
  if (p.landmarks.length) {
    line.lm = p.landmarks.map((l) => {
      const k: Record<number, [number, number]> = {};
      for (const i of RECORDED_LANDMARKS) {
        const x = l.xy[2 * i];
        const y = l.xy[2 * i + 1];
        if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) k[i] = [r1(x), r1(y)];
      }
      return { t: l.tUs, s: l.stable ? 1 : 0, r: l.reset ? 1 : 0, k };
    });
  }
  if (p.chest.length) line.c = p.chest.map((s) => [s.v, s.stable ? 1 : 0, s.tUs]);
  if (p.abdomen.length) line.a = p.abdomen.map((s) => [s.v, s.stable ? 1 : 0, s.tUs]);
  if (p.talking.length) line.tk = p.talking.map((s) => [s.detected ? 1 : 0, s.stable ? 1 : 0, s.tUs]);
  if (p.rate.length) line.r = p.rate.map((s) => [s.v, s.stable ? 1 : 0, s.conf, s.tUs]);
  return line;
}

/** In-memory recorder. Nothing touches disk unless the user saves. */
export class Recorder {
  private lines: string[] = [];
  private bytes = 0;
  /** Stop recording past this size (≈ 60 min of a normal session). */
  private readonly maxBytes = 64 * 1024 * 1024;
  truncated = false;

  constructor(header: Omit<RecordingHeader, 'k' | 'v' | 'app'>) {
    this.add({ k: 'hdr', v: RECORDING_VERSION, app: 'hold-the-floor', ...header });
  }

  add(line: RecLine): void {
    if (this.truncated) return;
    const s = JSON.stringify(line);
    this.bytes += s.length + 1;
    if (this.bytes > this.maxBytes) {
      this.truncated = true;
      return;
    }
    this.lines.push(s);
  }

  get size(): number {
    return this.bytes;
  }

  text(): string {
    return this.lines.join('\n') + '\n';
  }

  clear(): void {
    this.lines = [];
    this.bytes = 0;
  }
}
