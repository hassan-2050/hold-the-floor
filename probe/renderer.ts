// Stage 1 probe renderer. Developer tool. Logs numbers only.
import { SmartSpectraSDK } from '@smartspectra/node-sdk/renderer';
import { Metrics } from '@smartspectra/node-sdk/messages';
import { decodePacket } from '../src/sensing/decode';
import type { RawPacket } from '../src/sensing/types';
import { startMic, type MicSource } from '../src/audio/micSource';
import { REQUESTED_METRICS, ENABLE_TELEMETRY } from '../src/shared/sdkConfig';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const camSel = $<HTMLSelectElement>('cam');
const micSel = $<HTMLSelectElement>('mic');
const resSel = $<HTMLSelectElement>('res');
const metricsSel = $<HTMLSelectElement>('metrics');
const nsBox = $<HTMLInputElement>('ns');
const checkEl = $('check');
const meterFill = $('meterFill');
const meterPeak = $('meterPeak');
const micNums = $('micNums');
const btnRec = $<HTMLButtonElement>('rec');
const btnPlay = $<HTMLButtonElement>('play');
const recNote = $('recNote');
// Face-only = FACE_LANDMARKS (11) + TALKING (13): tests whether the chest
// requirement comes from requesting breathing.
const chosenMetrics = (): number[] => (metricsSel.value === 'face' ? [11, 13] : [...REQUESTED_METRICS]);
const btnConsent = $<HTMLButtonElement>('consent');
const btnReady = $<HTMLButtonElement>('ready');
const btnStart = $<HTMLButtonElement>('start');
const btnProto = $<HTMLButtonElement>('proto');
const btnStop = $<HTMLButtonElement>('stop');
const btnLabels = $<HTMLButtonElement>('labels');
const phaseEl = $('phase');
const barEl = $('bar');
const statsEl = $('stats');
const logEl = $('log');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const placeholder = $('placeholder');
const warnEl = $('warn');
const errText = (e: unknown): string => {
  const x = e as { name?: string; message?: string } | null;
  return x && (x.name || x.message) ? `${x.name ?? 'Error'}: ${x.message ?? ''}` : String(e);
};

// Landmarks logged on every packet: the indices the extractors plan to use,
// plus neighbours that help confirm or remap the MediaPipe ordering.
const KEY_IDX = [0, 1, 4, 6, 10, 13, 14, 17, 33, 61, 78, 82, 87, 133, 145, 152, 159, 168, 263, 291, 308, 312, 317, 362, 374, 386];
const FULL_EVERY = 15; // full 478-point set every Nth landmark frame (~2 Hz)

let sdk: SmartSpectraSDK | null = null;
let camStream: MediaStream | null = null;
let mic: MicSource | null = null;
let pending: string[] = [];
let lmFrames = 0;
let labelMode: 'key' | 'all' | 'off' = 'key';
let lastLm: number[] | null = null;
let firstShapeLogged = false;
let protoAbort = false;

const now = (): number => performance.timeOrigin + performance.now();
const say = (s: string): void => {
  logEl.textContent = `${new Date().toLocaleTimeString()} ${s}\n` + (logEl.textContent ?? '');
};
const out = (o: unknown): void => {
  pending.push(JSON.stringify(o));
};
const warn = (msg: string): void => {
  warnEl.textContent = msg;
  if (msg) out({ k: 'warn', rx: now(), msg });
};
window.addEventListener('error', (e) => out({ k: 'diag', rx: now(), what: 'window-error', msg: String(e.message) }));
window.addEventListener('unhandledrejection', (e) => out({ k: 'diag', rx: now(), what: 'unhandled', msg: errText(e.reason) }));
window.setInterval(() => {
  if (pending.length) {
    window.probe.lines(pending);
    pending = [];
  }
}, 500);

// ---- live stats --------------------------------------------------------
const win = { packets: [] as number[], lm: [] as number[], tk: [] as number[], chest: [] as number[], lat: [] as number[], cam: [] as number[], sent: [] as number[], unsent: [] as number[] };
const onVideoFrame = (): void => {
  pushWin(win.cam, now());
  video.requestVideoFrameCallback(onVideoFrame);
};
video.requestVideoFrameCallback(onVideoFrame);
let lastCode = -1;
window.setInterval(() => {
  if (!camStream) return;
  const t = now();
  const inLast = (a: number[]): number => a.filter((x) => x > t - 1000).length;
  out({ k: 'fps', rx: t, cam: inLast(win.cam), sent: inLast(win.sent), unsent: inLast(win.unsent), lm: inLast(win.lm), code: lastCode });
}, 1000);
let lastVal = '—';
let lastRate = '—';
let lastTalking = '—';
function pushWin(arr: number[], t: number): void {
  arr.push(t);
  while (arr.length && arr[0]! < t - 5000) arr.shift();
}
window.setInterval(() => {
  const med = (a: number[]): number => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)]!;
  };
  statsEl.textContent = [
    `camera fps     ${(win.cam.length / 5).toFixed(1)}   (needs ≥ 25)`,
    `frames to SDK/s ${(win.sent.length / 5).toFixed(1)}  not accepted/s ${(win.unsent.length / 5).toFixed(1)}`,
    `packets/s      ${(win.packets.length / 5).toFixed(1)}`,
    `landmark sets/s ${(win.lm.length / 5).toFixed(1)}`,
    `talking/s      ${(win.tk.length / 5).toFixed(1)}`,
    `chest samp/s   ${(win.chest.length / 5).toFixed(1)}`,
    `rx latency med ${med(win.lat).toFixed(0)} ms (rx − newest sample ts)`,
    `validation     ${lastVal}`,
    `breathing rate ${lastRate}`,
    `talking        ${lastTalking}`,
    `mic            ${mic ? 'on' : 'off'}`,
  ].join('\n');
}, 500);

// ---- overlay -----------------------------------------------------------
function draw(): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = (canvas.width = canvas.clientWidth);
  const ch = (canvas.height = canvas.clientHeight);
  ctx.clearRect(0, 0, cw, ch);
  if (!lastLm || labelMode === 'off' || !video.videoWidth) return;
  // object-fit: contain mapping from frame pixels to canvas, mirrored.
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const s = Math.min(cw / vw, ch / vh);
  const ox = (cw - vw * s) / 2;
  const oy = (ch - vh * s) / 2;
  const n = lastLm.length / 2;
  ctx.font = '10px monospace';
  for (let i = 0; i < n; i++) {
    const x = cw - (ox + lastLm[2 * i]! * s);
    const y = oy + lastLm[2 * i + 1]! * s;
    const key = KEY_IDX.includes(i);
    ctx.fillStyle = key ? '#E0A100' : 'rgba(255,255,255,.55)';
    ctx.fillRect(x - 1, y - 1, key ? 3 : 2, key ? 3 : 2);
    if (labelMode === 'all' || (labelMode === 'key' && key)) {
      ctx.fillStyle = key ? '#FFD34D' : '#9fd';
      ctx.fillText(String(i), x + 3, y - 2);
    }
  }
}
function raf(): void {
  draw();
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
btnLabels.onclick = (): void => {
  labelMode = labelMode === 'key' ? 'all' : labelMode === 'all' ? 'off' : 'key';
  btnLabels.textContent = `Labels: ${labelMode}`;
};

// ---- packet logging ----------------------------------------------------
function logPacket(p: RawPacket): void {
  const rec: Record<string, unknown> = { k: 'm', rx: Math.round(p.rxMs * 10) / 10, pt: p.packetTsUs };
  if (p.chest.length) rec.c = p.chest.map((s) => [s.v, s.stable ? 1 : 0, s.tUs]);
  if (p.abdomen.length) rec.a = p.abdomen.map((s) => [s.v, s.stable ? 1 : 0, s.tUs]);
  if (p.rate.length) rec.r = p.rate.map((s) => [s.v, s.stable ? 1 : 0, s.conf, s.tUs]);
  if (p.talking.length) rec.tk = p.talking.map((s) => [s.detected ? 1 : 0, s.stable ? 1 : 0, s.tUs]);
  if (p.landmarks.length) {
    rec.lm = p.landmarks.map((l) => {
      lmFrames++;
      const sub: Record<number, [number, number]> = {};
      for (const i of KEY_IDX) {
        const x = l.xy[2 * i];
        const y = l.xy[2 * i + 1];
        if (x !== undefined && y !== undefined) sub[i] = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
      }
      const o: Record<string, unknown> = { t: l.tUs, s: l.stable ? 1 : 0, r: l.reset ? 1 : 0, n: l.xy.length / 2, k: sub };
      if (lmFrames % FULL_EVERY === 1) o.full = l.xy.map((v) => Math.round(v * 10) / 10);
      return o;
    });
  }
  out(rec);
}

function onMetrics(buf: Uint8Array, ts: number): void {
  const rx = now();
  if (!firstShapeLogged) {
    // One structural sample for the field-shape report (landmarks trimmed).
    const obj = Metrics.toObject(Metrics.decode(buf), { longs: Number, defaults: true }) as Record<string, unknown>;
    const face = obj.face as { landmarks?: { value?: unknown[] }[] } | undefined;
    for (const l of face?.landmarks ?? []) if (l.value) l.value = l.value.slice(0, 3);
    out({ k: 'shape', rx, obj });
    firstShapeLogged = true;
  }
  const p = decodePacket(buf, ts, rx);
  logPacket(p);
  pushWin(win.packets, rx);
  for (const l of p.landmarks) {
    pushWin(win.lm, rx);
    lastLm = l.xy;
  }
  for (const _ of p.talking) pushWin(win.tk, rx);
  for (const _ of p.chest) pushWin(win.chest, rx);
  const newest = Math.max(
    ...p.landmarks.map((l) => l.tUs),
    ...p.talking.map((t) => t.tUs),
    ...p.chest.map((c) => c.tUs),
    -Infinity,
  );
  if (Number.isFinite(newest)) {
    win.lat.push(rx - newest / 1000);
    if (win.lat.length > 150) win.lat.shift();
  }
  const r = p.rate.at(-1);
  if (r) lastRate = `${r.v.toFixed(1)} /min conf ${r.conf.toFixed(0)} stable ${r.stable}`;
  const t = p.talking.at(-1);
  if (t) lastTalking = `${t.detected ? 'TALKING' : 'quiet'} (stable ${t.stable})`;
}

// ---- devices -----------------------------------------------------------
async function fillDevices(): Promise<void> {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel: HTMLSelectElement, kind: MediaDeviceKind): void => {
    const keep = sel.value;
    sel.innerHTML = '';
    for (const d of devs.filter((x) => x.kind === kind)) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `${kind} ${sel.length + 1}`;
      sel.append(o);
    }
    if (keep) sel.value = keep;
  };
  fill(camSel, 'videoinput');
  fill(micSel, 'audioinput');
  if (!camSel.dataset.chosen) {
    // Prefer a physical camera over virtual ones, which send black frames
    // when their own app is not running.
    const virtualRe = /virtual|transcreen|obs|snap camera|manycam|xsplit|droidcam|ndi|broadcast/i;
    const real = [...camSel.options].find((o) => !virtualRe.test(o.textContent ?? ''));
    if (real) camSel.value = real.value;
  }
  out({
    k: 'devices',
    rx: now(),
    cams: [...camSel.options].map((o) => o.textContent),
    mics: [...micSel.options].map((o) => o.textContent),
    chosen: camSel.selectedOptions[0]?.textContent,
  });
}

// ---- mic check --------------------------------------------------------
let testMic: MicSource | null = null;
let testLevels: number[] = []; // last ~3 s of dB values, for the noise estimate
let peakDb = -100;
let clip: Blob | null = null;
const dbToPct = (db: number): number => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
async function startTestMic(): Promise<void> {
  await stopTestMic();
  try {
    testMic = await startMic(
      (s) => {
        testLevels.push(s.db);
        if (testLevels.length > 150) testLevels.shift();
        peakDb = Math.max(s.db, peakDb - 0.5);
      },
      { deviceId: micSel.value, noiseSuppression: nsBox.checked },
    );
    out({ k: 'micCheck', rx: now(), label: testMic.label, noiseSuppression: nsBox.checked });
  } catch (e) {
    warn(`Microphone could not start: ${errText(e)}`);
  }
}
async function stopTestMic(): Promise<void> {
  await testMic?.stop();
  testMic = null;
  testLevels = [];
}
window.setInterval(() => {
  if (!testMic) return;
  const cur = testLevels.at(-1) ?? -100;
  const sortedL = [...testLevels].sort((a, b) => a - b);
  const room = sortedL[Math.floor(sortedL.length * 0.2)] ?? cur; // quiet part of the last 3 s
  meterFill.style.width = `${dbToPct(cur)}%`;
  meterPeak.style.left = `${dbToPct(peakDb)}%`;
  micNums.textContent = `now ${cur.toFixed(0)} dB · room ≈ ${room.toFixed(0)} dB · peak ${(peakDb - room).toFixed(0)} dB above room`;
}, 100);
btnRec.onclick = async (): Promise<void> => {
  if (!testMic) await startTestMic();
  if (!testMic) return;
  out({ k: 'click', rx: now(), b: 'mic-record' });
  btnRec.disabled = true;
  btnPlay.disabled = true;
  clip = null;
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(testMic.stream);
  rec.ondataavailable = (e): void => {
    if (e.data.size) chunks.push(e.data);
  };
  const sortedLevels = [...testLevels].sort((a, b) => a - b);
  const roomBefore = sortedLevels[Math.floor(sortedLevels.length * 0.2)] ?? -60;
  let recPeak = -100;
  const peakTimer = window.setInterval(() => {
    recPeak = Math.max(recPeak, testLevels.at(-1) ?? -100);
  }, 20);
  rec.start();
  recNote.textContent = 'Recording… speak now.';
  await new Promise((r) => window.setTimeout(r, 3000));
  await new Promise<void>((r) => {
    rec.onstop = (): void => r();
    rec.stop();
  });
  window.clearInterval(peakTimer);
  clip = new Blob(chunks, { type: rec.mimeType });
  const margin = recPeak - roomBefore;
  // Numbers only in the log; the clip itself never leaves memory.
  out({ k: 'micTest', rx: now(), roomDb: roomBefore, peakDb: recPeak, marginDb: margin });
  recNote.textContent =
    margin >= 15
      ? `Good: your voice peaked ${margin.toFixed(0)} dB above the room. Press Play back to hear it.`
      : `Quiet: your voice peaked only ${margin.toFixed(0)} dB above the room. Move closer to the mic, speak up, or try noise suppression / another mic.`;
  btnRec.disabled = false;
  btnPlay.disabled = false;
};
btnPlay.onclick = (): void => {
  if (!clip) return;
  out({ k: 'click', rx: now(), b: 'mic-play' });
  const url = URL.createObjectURL(clip);
  const audio = new Audio(url);
  btnPlay.disabled = true;
  const done = (): void => {
    URL.revokeObjectURL(url);
    clip = null; // discarded after one playback
    recNote.textContent = 'Clip discarded. Record again to re-test.';
  };
  audio.onended = done;
  audio.onerror = done;
  void audio.play();
};
micSel.onchange = (): void => {
  out({ k: 'click', rx: now(), b: 'mic-change', to: micSel.selectedOptions[0]?.textContent });
  if (!sdk) void startTestMic();
};
nsBox.onchange = (): void => {
  if (!sdk) void startTestMic();
};

// ---- preview + black-frame check ---------------------------------------
async function openCamera(): Promise<MediaStream> {
  const [w, hgt] = resSel.value.split('x').map(Number);
  const base = { deviceId: { exact: camSel.value }, width: { ideal: w }, height: { ideal: hgt } };
  try {
    // Ask the driver for a mode that keeps >= 25 fps.
    return await navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: { ideal: 30, min: 25 } }, audio: false });
  } catch (e) {
    out({ k: 'diag', rx: now(), what: 'fps-floor-rejected', msg: errText(e) });
    return navigator.mediaDevices.getUserMedia({ video: { ...base, frameRate: { ideal: 30 } }, audio: false });
  }
}
resSel.onchange = (): void => {
  out({ k: 'click', rx: now(), b: 'res-change', to: resSel.value });
  if (!sdk) void startPreview();
};
function stopPreview(): void {
  for (const t of camStream?.getTracks() ?? []) t.stop();
  camStream = null;
  video.srcObject = null;
  placeholder.style.display = 'grid';
  placeholder.textContent = 'Camera off.';
}
async function startPreview(): Promise<void> {
  stopPreview();
  try {
    camStream = await openCamera();
    video.srcObject = camStream;
    placeholder.style.display = 'none';
    const vt = camStream.getVideoTracks()[0];
    out({ k: 'preview', rx: now(), label: vt?.label, settings: vt?.getSettings(), readyState: vt?.readyState, muted: vt?.muted });
    warn('');
  } catch (e) {
    placeholder.style.display = 'grid';
    placeholder.textContent = 'Camera could not start.';
    warn(`Camera could not start: ${errText(e)}. Close other apps using the camera, or pick another camera.`);
  }
}
camSel.onchange = (): void => {
  camSel.dataset.chosen = '1';
  out({ k: 'click', rx: now(), b: 'camera-change', to: camSel.selectedOptions[0]?.textContent });
  if (!sdk) void startPreview();
};
// Mean brightness of the preview once a second; warns on sustained black.
let darkSecs = 0;
const lum = document.createElement('canvas');
lum.width = 32;
lum.height = 18;
window.setInterval(() => {
  if (!camStream || !video.videoWidth) {
    darkSecs = 0;
    return;
  }
  const c = lum.getContext('2d', { willReadFrequently: true });
  if (!c) return;
  c.drawImage(video, 0, 0, 32, 18);
  const d = c.getImageData(0, 0, 32, 18).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  const mean = sum / (d.length / 4);
  if (mean < 6) {
    darkSecs++;
    if (darkSecs === 3) {
      warn('The camera is sending black frames. Check the HP camera privacy shutter or camera key (often a key with a camera icon, or a slider above the screen), or pick another camera.');
      out({ k: 'diag', rx: now(), what: 'black-frames', mean });
    }
  } else {
    if (darkSecs >= 3) warn('');
    darkSecs = 0;
  }
}, 1000);

// ---- buttons -----------------------------------------------------------
btnConsent.onclick = async (): Promise<void> => {
  out({ k: 'click', rx: now(), b: 'consent' });
  // Ask once so device labels become visible, then release immediately.
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    for (const t of s.getTracks()) t.stop();
  } catch (e) {
    say(`permission failed: ${errText(e)}`);
    warn(`Camera/mic permission failed: ${errText(e)}`);
    return;
  }
  await fillDevices();
  btnConsent.disabled = true;
  btnReady.disabled = false;
  btnStart.disabled = false;
  await startPreview();
  checkEl.style.display = 'block';
  await startTestMic();
  phaseEl.textContent = 'Check the camera and mic above, then click “1 · Readiness check”.';
};

btnReady.onclick = async (): Promise<void> => {
  out({ k: 'click', rx: now(), b: 'readiness' });
  btnReady.disabled = true;
  btnStart.disabled = true;
  phaseEl.textContent = 'Checking device readiness (telemetry off)… this can take up to a minute.';
  const label = camSel.selectedOptions[0]?.textContent ?? null;
  // The native check opens the camera itself, so release the preview first.
  stopPreview();
  placeholder.textContent = 'Readiness check is using the camera…';
  const r = await window.probe.readiness(label);
  await startPreview();
  btnStart.disabled = false;
  out({ k: 'readiness', rx: now(), ...r, cameraLabel: label });
  say(`readiness: ${r.verdict} — ${r.reason} (${r.tookMs ?? '?'} ms)`);
  phaseEl.textContent = `Readiness: ${r.verdict}. ${r.reason}`;
  btnReady.disabled = false;
};

btnStart.onclick = async (): Promise<void> => {
  out({ k: 'click', rx: now(), b: 'start' });
  btnStart.disabled = true;
  await stopTestMic();
  checkEl.style.display = 'none';
  const key = await window.probe.key();
  if (!key) {
    phaseEl.innerHTML = '<span class="warn">No SMARTSPECTRA_API_KEY in .env</span>';
    btnStart.disabled = false;
    return;
  }
  const path = await window.probe.openLog();
  say(`logging to ${path}`);
  const info = await window.probe.info();
  out({ k: 'info', rx: now(), ...info, requestedMetrics: chosenMetrics(), noiseSuppression: nsBox.checked, size: resSel.value, telemetry: ENABLE_TELEMETRY, keyIdx: KEY_IDX });

  if (!camStream) await startPreview();
  if (!camStream) {
    btnStart.disabled = false;
    return;
  }
  const vt = camStream.getVideoTracks()[0];
  out({ k: 'camera', rx: now(), label: vt?.label, settings: vt?.getSettings() });

  try {
    mic = await startMic((s) => out({ k: 'a', t: Math.round(s.tMs * 10) / 10, db: Math.round(s.db * 100) / 100 }), {
      deviceId: micSel.value,
      noiseSuppression: nsBox.checked,
    });
    out({ k: 'mic', rx: now(), label: mic.label, baseLatency: mic.baseLatency, outputLatency: mic.outputLatency, clock: 'arrival-min' });
  } catch (e) {
    say(`mic failed: ${errText(e)}`);
    warn(`Microphone failed: ${errText(e)}. Continuing without mic.`);
  }

  sdk = new SmartSpectraSDK({ apiKey: key, requestedMetrics: chosenMetrics(), enableTelemetry: ENABLE_TELEMETRY });
  sdk.on('metrics', onMetrics);
  sdk.on('frameSentThrough', (sent) => pushWin(sent ? win.sent : win.unsent, now()));
  sdk.on('validationStatus', (code, ts, hint) => {
    lastCode = code;
    lastVal = `${code} ${hint}`;
    out({ k: 'v', rx: now(), ts, code, hint });
  });
  sdk.on('processingStatus', (status) => {
    out({ k: 's', rx: now(), status });
    say(`processingStatus ${status}`);
  });
  sdk.on('error', (code, message, retryable) => {
    out({ k: 'e', rx: now(), code, message, retryable });
    say(`ERROR ${code} ${message} retryable=${retryable}`);
    warn(
      code === 14
        ? 'SDK stopped: frame rate too low. Add light in front of you, or set Size to 960×540, then press Stop and Start again.'
        : `SDK error ${code}: ${message}`,
    );
  });
  sdk.useMediaStream(camStream);
  const t0 = now();
  out({ k: 'startCall', rx: t0 });
  try {
    await sdk.start();
    out({ k: 'started', rx: now(), tookMs: now() - t0 });
    say(`sdk.start resolved in ${(now() - t0).toFixed(0)} ms`);
  } catch (e) {
    const err = e as { code?: unknown; message?: string };
    out({ k: 'startFailed', rx: now(), code: err.code, message: err.message });
    say(`start failed: ${err.message}`);
    warn(`SDK start failed: ${String(err.code ?? '')} ${err.message ?? ''}`);
  }
  btnProto.disabled = false;
  btnStop.disabled = false;
  btnReady.disabled = true;
  metricsSel.disabled = true;
  nsBox.disabled = true;
  phaseEl.textContent = 'Measuring. Start the protocol when ready.';
};

btnStop.onclick = async (): Promise<void> => {
  out({ k: 'click', rx: now(), b: 'stop' });
  protoAbort = true;
  const t0 = now();
  out({ k: 'stopCall', rx: t0 });
  stopPreview();
  await mic?.stop();
  mic = null;
  try {
    await sdk?.stop();
  } catch (e) {
    say(`stop: ${String(e)}`);
  }
  sdk?.destroy();
  sdk = null;
  out({ k: 'stopped', rx: now(), tookMs: now() - t0 });
  window.probe.lines(pending);
  pending = [];
  const path = await window.probe.closeLog();
  say(`stopped in ${(now() - t0).toFixed(0)} ms; log: ${path}`);
  phaseEl.textContent = 'Stopped. Close this window, then run: npm run probe:analyze';
  btnStop.disabled = true;
  btnProto.disabled = true;
  btnStart.disabled = false;
  btnReady.disabled = false;
  metricsSel.disabled = false;
  nsBox.disabled = false;
  lastLm = null;
};

// ---- protocol ----------------------------------------------------------
interface Step {
  phase: string;
  text: string;
  sec: number;
  i?: number;
}
function protocol(): Step[] {
  const s: Step[] = [
    { phase: 'rest', text: 'Sit still, face the camera, stay silent and breathe normally.', sec: 35 },
    { phase: 'press', text: 'Press your lips gently together and hold.', sec: 5 },
    { phase: 'relax', text: 'Relax.', sec: 3 },
  ];
  // Natural speech breathing: breathe out while talking, breathe in during
  // the pause, then talk again on the out-breath.
  for (let i = 0; i < 20; i++) {
    // Keep counting until the prompt changes, so the speech offset lines up
    // with the pause prompt and the inhale timing is not a reaction delay.
    s.push({ phase: 'speak', text: `(${i + 1}/20) Count steadily, breathing out as you speak — one, two, three, four… — until this changes`, sec: 3, i });
    s.push({ phase: 'pause', text: `(${i + 1}/20) Stop. Take a breath in, ready to speak again.`, sec: 2.5, i });
  }
  // Control: pauses with an out-breath, to check the inhale detector does
  // not fire when you are breathing out.
  for (let i = 0; i < 6; i++) {
    s.push({ phase: 'speak', text: `(control ${i + 1}/6) Count aloud: “one, two, three, four, five”`, sec: 3, i: 100 + i });
    s.push({ phase: 'exhale', text: `(control ${i + 1}/6) Stop. Slowly breathe out and relax. Don't breathe in yet.`, sec: 2.5, i: 100 + i });
  }
  const head: [string, string][] = [
    ['head-left', 'Turn your head to your left and hold.'],
    ['head-center', 'Face the camera.'],
    ['head-right', 'Turn your head to your right and hold.'],
    ['head-center', 'Face the camera.'],
    ['head-up', 'Look up and hold.'],
    ['head-center', 'Face the camera.'],
    ['head-down', 'Look down and hold.'],
    ['head-center', 'Face the camera.'],
  ];
  for (const [phase, text] of head) s.push({ phase, text, sec: 2 });
  s.push({ phase: 'set', text: 'Open your lips slightly as if about to speak, hold still, silent.', sec: 3 });
  s.push({ phase: 'relax', text: 'Relax.', sec: 3 });
  return s;
}

btnProto.onclick = async (): Promise<void> => {
  out({ k: 'click', rx: now(), b: 'protocol' });
  btnProto.disabled = true;
  protoAbort = false;
  for (const st of protocol()) {
    if (protoAbort) break;
    out({ k: 'p', t: now(), phase: st.phase, i: st.i ?? null, sec: st.sec });
    phaseEl.textContent = st.text;
    const start = now();
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        const f = Math.min(1, (now() - start) / (st.sec * 1000));
        barEl.style.width = `${f * 100}%`;
        if (f >= 1 || protoAbort) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }
  out({ k: 'p', t: now(), phase: 'done', i: null, sec: 0 });
  phaseEl.textContent = 'Protocol done. Keep going freely, or press Stop to close the log.';
  btnProto.disabled = false;
};

// ---- boot --------------------------------------------------------------
void (async (): Promise<void> => {
  const path = await window.probe.openLog();
  say(`log: ${path}`);
  const info = await window.probe.info();
  out({ k: 'boot', rx: now(), hasKey: info.hasKey, nativeCameras: info.nativeCameras });
  $('info').textContent = `SDK ${info.sdkVersion} · Electron ${info.electron} · ${info.platform} · key ${info.hasKey ? 'found' : 'MISSING (.env)'} · native cameras: ${info.nativeCameras.map((c) => c.name).join(', ') || 'none'}`;
})();
