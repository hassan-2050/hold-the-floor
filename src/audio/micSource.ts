// Web Audio plumbing for the microphone loudness meter. Renderer only.
// Produces { tMs (epoch ms), db } every 20 ms from the AudioWorklet.
// Audio samples never leave the worklet.
import workletUrl from './loudness-worklet.js?url';

export interface LoudnessSample {
  /** Wall-clock epoch milliseconds at the end of the 20 ms window. */
  tMs: number;
  /** RMS level in dBFS. */
  db: number;
}

export interface MicSource {
  stream: MediaStream;
  label: string;
  /** Reported by the AudioContext, seconds (for diagnostics). */
  baseLatency: number;
  outputLatency: number;
  stop(): Promise<void>;
}

export interface MicOptions {
  deviceId?: string | null;
  /** Browser noise suppression; lowers a steady noise floor (fans, hum). */
  noiseSuppression?: boolean;
}

export async function startMic(onSample: (s: LoudnessSample) => void, opts: MicOptions = {}): Promise<MicSource> {
  const { deviceId, noiseSuppression = false } = opts;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // Echo cancellation keeps the agent's voice out of the meter.
      echoCancellation: true,
      // Automatic gain would move the noise floor while you talk, which
      // breaks the floor + dB thresholds.
      autoGainControl: false,
      noiseSuppression,
      channelCount: 1,
    },
    video: false,
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(workletUrl);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'htf-loudness', { numberOfInputs: 1, numberOfOutputs: 0 });
  src.connect(node);

  // Map the audio clock to epoch ms from message arrival: each window
  // arrives no earlier than it was processed, so the smallest
  // (arrival − audio time) over the last ~5 s is the best clock offset.
  // (getOutputTimestamp would add the output latency, which is wrong for
  // input.) Input capture latency before the worklet is not visible to the
  // page and is typically 10–30 ms.
  const offsets: number[] = [];
  node.port.onmessage = (ev: MessageEvent<{ t: number; db: number }>): void => {
    const { t, db } = ev.data;
    offsets.push(performance.now() - t * 1000);
    if (offsets.length > 250) offsets.shift();
    let off = Infinity;
    for (const o of offsets) if (o < off) off = o;
    onSample({ tMs: performance.timeOrigin + t * 1000 + off, db });
  };
  if (ctx.state === 'suspended') await ctx.resume();

  const track = stream.getAudioTracks()[0];
  return {
    stream,
    label: track?.label ?? '',
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency,
    async stop(): Promise<void> {
      node.port.onmessage = null;
      try {
        src.disconnect();
        node.disconnect();
      } catch {
        /* already disconnected */
      }
      for (const t of stream.getTracks()) t.stop();
      await ctx.close().catch(() => undefined);
    },
  };
}
