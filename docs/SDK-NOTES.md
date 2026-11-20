# SmartSpectra SDK notes

Checked against the installed package `@smartspectra/node-sdk@3.5.0` (its
TypeScript typings in `js/*.d.ts` and the JS sources), on 20 Nov 2026,
Windows 11 x64, Electron 45.4.1 (Chrome/Node bundled), Node 24.12.
Where the typings and the plan differ, the app follows the typings. Each
difference is listed here.

## Entry points (as installed)

| Import | Gives | Used in |
| --- | --- | --- |
| `@smartspectra/node-sdk` | main-process `SmartSpectraSDK`, `CameraSelection`, constants, `decodeMetrics` (pulls in koffi; never import in the renderer) | `electron/main/readiness.ts` |
| `@smartspectra/node-sdk/main` | `bindSmartSpectraIpc(window, { logger? })` | `electron/main/index.ts` |
| `@smartspectra/node-sdk/preload` | side-effect module exposing `window.__smartspectraBridge` | `electron/preload/index.ts` (bundled inline) |
| `@smartspectra/node-sdk/renderer` | renderer `SmartSpectraSDK`, `MetricType`, `ValidationCode`, `SmartSpectraErrorCode`, `breathingMetrics`, … | `src/sensing/sdkClient.ts` |
| `@smartspectra/node-sdk/messages` | `decodeMetrics(buf)`, `Metrics`, `presage` namespace | `src/sensing/decode.ts` |

## Differences from the plan

1. **`bindSmartSpectraIpc` comes from `@smartspectra/node-sdk/main`.** The plan said "main process: bindSmartSpectraIpc(window)" without a path. It is not exported from the package root.
2. **The renderer SDK has no `checkDeviceReadiness()`.** It exists only on the main-process `SmartSpectraSDK`. It also needs a *native* camera input (`useCamera(...)`): with `useFile` or `useCustomInput` it returns `inconclusive` ("File and custom-frame inputs are not yet supported"). So readiness runs in the main process (`electron/main/readiness.ts`). It runs with the same `requestedMetrics` and `enableTelemetry: false`, on the native camera whose name matches the browser camera label, and is awaited and destroyed before the renderer session starts. Native SDK state is process-global, and the two captures would compete for the device.
3. **The renderer SDK has no `stopAsync()`.** Renderer `stop()` already returns a Promise. It resolves when the main-process SDK reports idle; internally the IPC bridge calls `stopAsync()` in main. `destroy()` is synchronous in the renderer and `Promise<void>` in main.
4. **Readiness verdict** is `result.verdict` (`'ready' | 'limited' | 'blocked' | 'inconclusive'`), with `result.reason` as text. The plan's rule holds: compare `=== 'ready'`.
5. **Decoded field names are camelCase and every field is a list.** `breathing.upperTrace[]` (chest), `breathing.lowerTrace[]` (abdomen), `breathing.rate[]` (`{value, stable, confidence, timestamp}`), `face.talking[]` (`{detected, stable, timestamp}`), `face.landmarks[]` (`{value: {x,y}[], stable, reset, timestamp}`). The docs' `upper_trace` / `lower_trace` are the proto names. A packet may hold 0..n samples of each field.
6. **Timestamps are int64 µs since the Unix epoch, decoded as `Long` objects.** `Number(long)` converts them exactly for present-day values. In the Electron renderer path the frame timestamp is `VideoFrame.timestamp` anchored to `Date.now()` at the first frame and ratcheted to be monotonic (`js/renderer/timestamp.js`). So SDK times can be compared with `performance.timeOrigin + performance.now()` to within about one frame.
7. **Renderer `metrics` buffers are `Uint8Array`**, not `Buffer`. `decodeMetrics` accepts both.
8. **Options the IPC bridge forwards:** `apiKey`, `requestedMetrics`, `enableAccumulatedOutput`, `enableTelemetry`. `logLevel` set in the renderer is dropped by the bridge's sanitiser. `enableTelemetry` defaults to `true` unless explicitly `false`; this app always passes `false`.
9. **The API key passes through the renderer.** The renderer SDK posts its constructor options to main over the bridge, so the key exists in renderer memory while a session is configured. The app keeps it in a local variable passed straight to the constructor. It never goes into React state, Zustand, `localStorage`, logs or recordings, and is fetched from main (safeStorage) just before construction.
10. **Error codes include more than the plan listed:** `kInvalidState 1`, `kAuthenticationFailed 2`, `kConfigurationFailed 3`, `kCreditExhausted 4`, `kNetworkError 5`, `kServerError 6`, `kInputUnavailable 7`, `kProcessingFailed 8`, `kFrameConversionFailed 9`, `kNonMonotonicTimestamp 10`, `kTimestampGap 11`, `kMetricNotAuthorized 13`, `kSustainedLowFrameRate 14`. All are mapped in `src/sensing/errors.ts`. Renderer IPC calls can also reject with `code: 'SMARTSPECTRA_IPC_TIMEOUT'` (default 30 s). If the graph stays in `kStarting` for 30 s with no validation packet, the renderer emits a synthetic `kProcessingFailed`.
11. **Validation codes:** `kOk 0, kNoFaceFound 1, kMultipleFacesFound 2, kFaceNotCentered 3, kFaceSizeOutOfRange 4 (deprecated), kTooDark 5, kTooBright 6, kChestNotVisible 7, kCameraTuning 10, kFrameRateTooLow 11, kExcessiveMotion 12, kFaceTooClose 13, kFaceTooFar 14, kFaceTooHigh 15, kFaceTooLow 16, kFaceNotForward 17`.
12. **Camera locking:** when the SDK acquires its own stream it locks AE/AWB/focus once running. With a host stream (`useMediaStream`) the host owns the tracks, and the SDK never stops them. The app stops its tracks itself on every exit path.
13. **Packaging:** sandboxed preloads cannot `require` node_modules or sibling chunks, so the SDK preload is bundled into each preload as one file (`isolatedEntries`). The CSP allows `blob:` in `worker-src` as the SDK README requires. The AudioWorklet module is a real file (no `data:` inlining) so `script-src 'self'` covers it.
14. **Unavailable metrics:** requesting `BREATHING_AMPLITUDE`, `APNEA`, `RESPIRATORY_LINE_LENGTH`, `BASELINE` or `INHALE_EXHALE_RATIO` makes `start()` throw `kConfigurationFailed`. The app requests only `[0, 1, 2, 11, 13]`.
15. **`requestInsight`** exists on both SDKs. It is never called in this app.

## Verified on this machine without a key

- Native runtime loads on Windows x64 (`SmartSpectraSDK.version` = `3.5.0`).
- `SmartSpectraSDK.availableCameras()` lists `HP Wide Vision HD Camera`, `TranScreen Camera`.
- The preload bridge and renderer module load under `sandbox: true`, `contextIsolation: true` with the app CSP; no console errors.

## Measured with the camera (Stage 1)

Run 1, 20 Nov 2026, HP Wide Vision HD Camera at 1280×720, Windows 11, i5-13420H
(log `probe/logs/probe-2026-11-20T10-32-25-669Z.jsonl`, full protocol):

- Readiness `ready`: "Qualified. Proceed with the tested configuration under the current conditions." It took 24 s, which is long enough to need a progress message in the UI.
- `start()` resolved in 1.0 s; first metrics and landmarks 1.2 s after `start()`; breathing first `stable` at 35 s (confidence 78). Stop (tracks + `stop()` + `destroy()`) took 131 ms, with one packet after stop.
- The first packet already carries landmarks with `stable: true`. Landmark sets are always 478 points in pixel coordinates of the frame sent to the SDK.
- **Landmark order is MediaPipe Face Mesh.** All 9 geometry checks pass (13/14 inner lips, 0/17 outer lips, 61/291 corners, 33/263 outer eye corners, 133/362 inner, 1 nose tip, 10 forehead, 152 chin). No remap is needed.
- Rates: chest trace, talking and landmarks are one sample per processed frame (~30 Hz timestamps); breathing rate about every 2 s. The abdomen trace was empty (waist not in view). Packets carry 1–2 samples per field.
- Delivery delay (receive time − frame timestamp): landmarks median 76 ms (p90 103), talking 105 ms (p90 140), chest 83 ms (p90 124).
- The camera delivered ~25 fps (p10 23), borderline. Frames reaching the SDK matched the camera rate, so the PC was not the bottleneck. `kFrameRateTooLow` (11) showed often; in an earlier run with dimmer light the session ended with `kSustainedLowFrameRate` (14) after about 65 s.
- **While validation is `kChestNotVisible` (7) the SDK sends no landmarks** (1 of 3,018 frames). Talking samples still arrive but are nearly always `detected: false`. Under codes 0 and 11, 100% of frames carry landmarks. Code 7 dominated the speaking cycles, so lips and talking were blind exactly when they mattered. Being tested next: whether requesting face metrics only (`[11, 13]`) removes the chest requirement.
- Microphone (laptop mic, AGC and noise suppression off): noise floor −49.6 dBFS; counting aloud p90 was only 10.4 dB above the floor. A fixed +12 dB speech threshold is too strict for this setup, so thresholds need calibrating from both silence and speech.
- Lips at rest: inner aperture 13↔14 is 0 (closed lips; MAD 0), so `rest + 3·MAD` needs an absolute floor. Pressed lips lowered outer height 0↔17 from 0.197 to p10 0.135 (IOD units).
- Breath after speech: 9 of 20 cycles had a detectable mic offset (low speech level). The "falling = inhale" reading of this run was wrong; run 2 corrects it.

Run 2, same day and setup. Seated further back with the chest in view and
light in front. Protocol v2 (breathe out while counting, breathe in during
the pause, 6 out-breath control pauses). Log
`probe/logs/probe-2026-11-20T16-52-37-604Z.jsonl`.

- With the chest in view, validation was OK (0) for 86% of events and landmarks arrived for **100%** of frames (code 7 appeared mainly before and after the protocol, when moving). Delivery delay fell to landmarks 32 ms median (p90 58), talking 61 ms, chest 57 ms.
- A readiness check in a separate run returned `inconclusive`, "Network unavailable. Restore network access to the SmartSpectra service and start a new check.", then `ready` on retry. Readiness takes 24–27 s.
- Mic (same laptop array, quieter room): floor −65.7 dBFS; counting aloud p90 23.8 dB above the floor; device-check peak 40 dB above the room.
- **`face.talking` is too slow for turn-taking:** `detected` was true in 0% of frames while counting aloud in 3 s bursts and 27% during free talk at the end. It is kept as a supporting signal only. Visible talking comes from mouth movement in the landmarks, which opened at 31 of 31 speech onsets.
- Lips (IOD units): rest inner aperture 0 (closed); "set" (parted, silent) median 0.097, 82% of frames above the rest threshold; pressed outer height 0.167 against 0.232 at rest, 67% of frames below rest − 3·MAD.
- **Chest trace polarity: rising = inhale.** While counting (out-breath) the median slope was −0.76/s, with 85% of speaking periods falling. In all 20 inhale pauses the trace rose over the pause; in 5 of the 6 out-breath controls it did not (the one exception looks like a real inhale). The averaged trace keeps falling for about 1 s after the "Stop" prompt and then rises. Within 1.5 s of the mic offset, 5 of 20 inhales passed the 0.35 resting-amplitude/s slope; detections were known 0.5–1.4 s after the offset. False detections in the controls: 1 of 6.
- Head pose proxy: a right turn moved nose-vs-eye-midpoint by 0.107 IOD, consistent with about 15° for a nose-tip depth of about 0.4 IOD. The other turns in this run were small.
- Lip vs mic timing: lips opened 280 ms before the mic onset and closed 390 ms before the mic offset. Part of this was a clock bias in the probe's mic timing (it used `getOutputTimestamp`, which adds output latency). That is now an arrival-based minimum offset (`src/audio/micSource.ts`). Anticipatory articulation and word-final consonants explain the rest.

## Stage 1 decisions

1. **Landmarks follow MediaPipe Face Mesh order.** The plan's indices are used unchanged: inner lip 13/14, outer lip 0/17, corners 61/291, eye outer corners 33/263, nose tip 1.
2. **The chest must be in view** for the face cues to work at all: under `kChestNotVisible` the SDK sends no landmarks. Setup and calibration coach the framing ("Sit back so your shoulders and upper chest are in view"). The quality gate treats code 7 like any other non-OK code: after 1 s, fall back to the fixed timer, with that hint shown.
3. **Breath is a supporting cue** (plan decision point 1). Its direction is reliable: 20 of 20 instructed inhales rose, and the out-breath controls did not trigger the cue in replay. Its timing in these runs is confounded by the protocol, though. When the user finished counting before the "breathe in" prompt, the inhale came 2.0–2.5 s after the speech offset, because they waited for the prompt. When speech ran into the prompt, it came 0.7–1.8 s after. The probe now asks you to count until the prompt changes. The deciding evidence will be the app's oracle self-test with natural mid-answer pauses (docs/RESULTS.md).
4. **Visible talking = mouth movement from landmarks** (aperture change over a short window). The SDK talking flag is a secondary input to that cue.
5. **Mic thresholds are calibrated from silence and speech.** The noise floor comes from the rest step. The speech threshold is floor + 12 dB when the measured speech level allows it, otherwise a fraction of the measured speech margin (never below floor + 6 dB). See `config/thresholds.ts`.
6. **Lip baselines get absolute floors**, because MAD is 0 for closed lips at rest.
7. **Frame rate is borderline (~25 fps) on this webcam.** Setup shows the measured fps and suggests more front light; 960×540 is available as a fallback size.
8. **Readiness takes about 25 s and can fail on network.** The UI shows progress, explains a network failure, and offers Retry.

## Seen in the live demo session

- **Covering the lens with a hand:** as the hand came up, the status callback reported `MULTIPLE_FACES_FOUND` (code 2, "Only one face is allowed.") for a single update (33 ms), then "Hold still" (0), then "Increase light on face." (5) for the 3.5 s the lens was covered, then 0. Validation statuses arrive about every 33 ms, the same as frames. The quality gate therefore latches every code 2 report until its next tick: a report shorter than one 30 Hz engine tick could otherwise be missed or caught depending on tick timing.
