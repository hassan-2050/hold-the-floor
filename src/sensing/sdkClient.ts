// SmartSpectra integration (renderer side). This is the one file where the
// app talks to the SDK during a session; see docs/SDK-NOTES.md for the
// facts behind each choice.
//
// What it does
// - Builds the renderer SmartSpectraSDK with the user's key (fetched from
//   the main process just before construction, never stored),
//   `requestedMetrics` = breathing bundle + FACE_LANDMARKS + TALKING, and
//   telemetry OFF. `requestInsight` is never called.
// - Hands the app's own camera MediaStream to `useMediaStream`, so the app
//   owns the tracks and can stop them on every exit path.
// - Decodes each `metrics` buffer into plain numbers (decode.ts) and
//   forwards validation status, processing status and errors.
// - On a retryable error: `reset()` then `start()` once (plan). Low frame
//   rate (14) waits for the user to restart.
// Device readiness runs in the main process before this starts: only the
// main-process SDK has checkDeviceReadiness().
import { SmartSpectraSDK, MetricType, breathingMetrics } from '@smartspectra/node-sdk/renderer';
import { decodePacket } from './decode';
import { errorInfo } from './errors';
import type { RawPacket } from './types';
import { ENABLE_TELEMETRY } from '../shared/sdkConfig';

/** breathingMetrics (CHEST, ABDOMEN, RATE) + FACE_LANDMARKS + TALKING. No cardio, blinking or expressions. */
export const REQUESTED = [...breathingMetrics, MetricType.FACE_LANDMARKS, MetricType.TALKING];

export interface SdkClientEvents {
  packet(p: RawPacket): void;
  validation(code: number, hint: string, rxMs: number): void;
  status(status: number): void;
  error(code: number | string, message: string, retryable: boolean, rxMs: number): void;
  started(rxMs: number): void;
  stopped(rxMs: number): void;
}

const nowMs = (): number => performance.timeOrigin + performance.now();

export class SdkClient {
  private sdk: SmartSpectraSDK | null = null;
  private retried = false;
  private stopping = false;
  private stream: MediaStream | null = null;

  constructor(private readonly ev: SdkClientEvents) {}

  get running(): boolean {
    return this.sdk !== null;
  }

  /** Start measuring from a camera stream the app owns. */
  async start(stream: MediaStream, getKey: () => Promise<string | null>): Promise<void> {
    await this.stop();
    this.stream = stream;
    this.stopping = false;
    this.retried = false;
    const apiKey = await getKey();
    if (!apiKey) throw Object.assign(new Error('No API key saved.'), { code: 2 });
    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...REQUESTED],
      enableTelemetry: ENABLE_TELEMETRY,
    });
    this.sdk = sdk;
    sdk.on('metrics', (buf, ts) => {
      if (this.sdk !== sdk) return;
      this.ev.packet(decodePacket(buf, ts, nowMs()));
    });
    sdk.on('validationStatus', (code, _ts, hint) => {
      if (this.sdk === sdk) this.ev.validation(code, hint, nowMs());
    });
    sdk.on('processingStatus', (s) => {
      if (this.sdk === sdk) this.ev.status(s);
    });
    sdk.on('error', (code, message, retryable) => {
      if (this.sdk !== sdk) return;
      this.ev.error(code, message, retryable, nowMs());
      if (retryable && !this.retried && !this.stopping && errorInfo(code).autoRetry) {
        this.retried = true;
        void this.retry(sdk);
      }
    });
    sdk.useMediaStream(stream);
    try {
      await sdk.start();
    } catch (e) {
      const err = e as { code?: number | string; message?: string; retryable?: boolean };
      this.ev.error(err.code ?? 0, err.message ?? String(e), !!err.retryable, nowMs());
      throw e;
    }
    if (this.sdk === sdk) this.ev.started(nowMs());
  }

  private async retry(sdk: SmartSpectraSDK): Promise<void> {
    try {
      await sdk.reset();
      if (this.sdk !== sdk || this.stopping || !this.stream) return;
      sdk.useMediaStream(this.stream);
      await sdk.start();
      this.ev.started(nowMs());
    } catch {
      /* stays in fixed-timer mode; the error was already reported */
    }
  }

  /**
   * Stop and destroy the SDK. Camera tracks belong to the caller and are
   * stopped there first, so the camera light goes off without waiting for
   * the pipeline to drain.
   */
  async stop(): Promise<void> {
    const sdk = this.sdk;
    if (!sdk) return;
    this.stopping = true;
    this.sdk = null;
    this.stream = null;
    try {
      await Promise.race([sdk.stop(), new Promise((r) => setTimeout(r, 1500))]);
    } catch {
      /* already stopped or errored */
    }
    sdk.destroy();
    this.ev.stopped(nowMs());
  }
}
