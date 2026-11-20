// Device readiness runs in the main process because only the main-process
// SmartSpectraSDK has checkDeviceReadiness(), and it only accepts a native
// camera input (useCamera). The renderer SDK and custom-frame input return
// 'inconclusive' / are unsupported. See docs/SDK-NOTES.md.
//
// SDK state is process-global, so this instance is destroyed (awaited)
// before the renderer's measurement session is started. Callers must not
// have the renderer camera open while this runs: the native capture would
// compete for the same device.
import { SmartSpectraSDK, CameraSelection } from '@smartspectra/node-sdk';
import { REQUESTED_METRICS, ENABLE_TELEMETRY, type ReadinessResult } from '../../src/shared/sdkConfig';

export interface NativeCamera {
  id: string;
  name: string | null;
}

export function listNativeCameras(): NativeCamera[] {
  try {
    return SmartSpectraSDK.availableCameras().map((c) => ({ id: c.id, name: c.name }));
  } catch {
    return [];
  }
}

/** Pick the native camera whose name best matches the browser device label. */
export function matchNativeCamera(label: string | null | undefined): NativeCamera | null {
  const cams = listNativeCameras();
  if (!label) return null;
  const norm = (s: string): string => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  const want = norm(label);
  return (
    cams.find((c) => c.name !== null && norm(c.name) === want) ??
    cams.find((c) => c.name !== null && (want.includes(norm(c.name)) || norm(c.name).includes(want))) ??
    null
  );
}

let inFlight: Promise<ReadinessResult> | null = null;

export function checkReadiness(apiKey: string, cameraLabel?: string | null): Promise<ReadinessResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<ReadinessResult> => {
    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...REQUESTED_METRICS],
      enableTelemetry: ENABLE_TELEMETRY,
    });
    try {
      const native = matchNativeCamera(cameraLabel);
      sdk.useCamera(native ? CameraSelection.byId(native.id) : CameraSelection.default);
      const result = await sdk.checkDeviceReadiness();
      // The verdict is a lowercase string; every value is truthy, so callers
      // must compare it explicitly (=== 'ready').
      return { verdict: result.verdict, reason: result.reason };
    } catch (err) {
      const e = err as { message?: string };
      return { verdict: 'inconclusive', reason: e.message ?? String(err) };
    } finally {
      await sdk.destroy();
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
