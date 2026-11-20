// Demo mode only (`npm run demo`): records this window's page, the system
// audio (the agent's voice) and the microphone into one video file, written
// to disk in 1 s chunks by the main process. Also keeps the prompter window
// in step with the app. Never used in a normal start.
import { useApp } from '../state/store';
import type { DemoState } from '../demo/script';
import { dbg } from './debug';

let recorder: MediaRecorder | null = null;
let finished: Promise<void> | null = null;
let ctx: AudioContext | null = null;
const held: MediaStream[] = [];

const MIME_PREFERENCE = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

async function captureWindow(): Promise<MediaStream> {
  // 20 fps at up to 1280 px wide is plenty for a screen demo and keeps the
  // encoder light, so the camera pipeline keeps its 25+ fps.
  const video = { frameRate: { ideal: 20, max: 20 }, width: { max: 1280 } };
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
  } catch (e) {
    dbg('demo-capture-audio-failed', { err: String(e) });
    return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  }
}

export async function startDemoRecording(): Promise<void> {
  if (recorder) return;
  try {
    const screen = await captureWindow();
    held.push(screen);
    ctx = new AudioContext();
    const mix = ctx.createMediaStreamDestination();
    if (screen.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(mix);
    try {
      // Same processing as the app's own loudness meter, so the two mic
      // tracks never ask the device for different settings.
      const micId = useApp.getState().settings.micId;
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { ...(micId ? { deviceId: { exact: micId } } : {}), echoCancellation: true, autoGainControl: false, noiseSuppression: false },
        video: false,
      });
      held.push(mic);
      const gain = ctx.createGain();
      gain.gain.value = 1.6;
      ctx.createMediaStreamSource(mic).connect(gain).connect(mix);
    } catch (e) {
      window.htf.recError(`microphone not recorded (${String(e)})`);
    }
    const out = new MediaStream([...screen.getVideoTracks(), ...mix.stream.getAudioTracks()]);
    const mimeType = MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    await window.htf.recBegin(mimeType);
    const rec = new MediaRecorder(out, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
    let chain = Promise.resolve();
    rec.ondataavailable = (e): void => {
      if (!e.data.size) return;
      // Keep chunks in order while converting them.
      chain = chain.then(async () => window.htf.recChunk(new Uint8Array(await e.data.arrayBuffer())));
    };
    finished = new Promise<void>((resolve) => {
      rec.onstop = (): void => {
        void chain.then(() => window.htf.recEnd()).then(() => resolve());
      };
    });
    rec.start(1000);
    recorder = rec;
    dbg('demo-recording', { mimeType, audioTracks: out.getAudioTracks().length });
  } catch (e) {
    window.htf.recError(String(e));
    dbg('demo-recording-failed', { err: String(e) });
  }
}

/** Stop and finish the file (also called on quit). */
export async function stopDemoRecording(): Promise<void> {
  const rec = recorder;
  if (!rec) return;
  recorder = null;
  if (rec.state !== 'inactive') rec.stop();
  await finished;
  for (const s of held.splice(0)) for (const t of s.getTracks()) t.stop();
  await ctx?.close().catch(() => undefined);
  ctx = null;
}

/** Send the prompter what it needs, whenever it changes. */
export function startDemoSync(): void {
  let last = '';
  const push = (): void => {
    const st = useApp.getState();
    const s = st.snapshot;
    const state: DemoState = {
      screen: st.screen,
      sheet: st.sheet,
      calStep: s?.calibrating ?? null,
      lipsReady: !!s?.lipsReady,
      pressEnabled: s?.pressEnabled ?? true,
      warmupDone: (s?.calibrationFrames.question ?? 0) > 0 && !s?.calibrating,
      questionIndex: st.questionIndex,
      agentSpeaking: st.agentSpeaking,
      cameraOn: st.cameraOn,
    };
    const json = JSON.stringify(state);
    if (json !== last) {
      last = json;
      window.htf.demoState(state);
    }
  };
  useApp.subscribe(push);
  push();
  window.htf.onDemoStop(() => void stopDemoRecording());
}
