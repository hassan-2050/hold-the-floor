// Microphone check: a live level meter plus "Record 3 s → Play back" so
// you can hear that the right mic is selected. The clip stays in memory,
// is played once, then discarded. It is never saved or sent.
import { useEffect, useRef, useState } from 'react';
import { Play, Record } from '@phosphor-icons/react';
import { startMic, type MicSource } from '../audio/micSource';

const pct = (db: number): number => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));

export function MicCheck({ deviceId, noiseSuppression }: { deviceId: string | null; noiseSuppression: boolean }) {
  const mic = useRef<MicSource | null>(null);
  const levels = useRef<number[]>([]);
  const [now, setNow] = useState(-100);
  const [room, setRoom] = useState(-100);
  const [clip, setClip] = useState<Blob | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [note, setNote] = useState('Say “testing, one, two, three” at your normal volume.');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void startMic(
      (s) => {
        levels.current.push(s.db);
        if (levels.current.length > 150) levels.current.shift();
      },
      { deviceId, noiseSuppression },
    )
      .then((m) => {
        if (alive) mic.current = m;
        else void m.stop();
      })
      .catch((e: Error) => setErr(`The microphone could not start (${e.name}).`));
    const t = window.setInterval(() => {
      const l = levels.current;
      if (!l.length) return;
      setNow(l[l.length - 1]!);
      const s = [...l].sort((a, b) => a - b);
      setRoom(s[Math.floor(s.length * 0.2)]!);
    }, 100);
    return () => {
      alive = false;
      window.clearInterval(t);
      void mic.current?.stop();
      mic.current = null;
      levels.current = [];
    };
  }, [deviceId, noiseSuppression]);

  const record = async (): Promise<void> => {
    const m = mic.current;
    if (!m) return;
    setClip(null);
    setState('recording');
    setNote('Recording… speak now.');
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(m.stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const roomBefore = room;
    let peak = -100;
    const pk = window.setInterval(() => (peak = Math.max(peak, levels.current.at(-1) ?? -100)), 20);
    rec.start();
    await new Promise((r) => setTimeout(r, 3000));
    await new Promise<void>((r) => {
      rec.onstop = () => r();
      rec.stop();
    });
    window.clearInterval(pk);
    setClip(new Blob(chunks, { type: rec.mimeType }));
    setState('idle');
    const margin = peak - roomBefore;
    setNote(
      margin >= 15
        ? `Good: your voice was ${margin.toFixed(0)} dB above the room. Press Play back to hear it.`
        : `Quiet: your voice was only ${margin.toFixed(0)} dB above the room. Move closer, speak up, or try noise suppression or another microphone.`,
    );
  };

  const play = (): void => {
    if (!clip) return;
    const url = URL.createObjectURL(clip);
    const a = new Audio(url);
    setState('playing');
    const done = (): void => {
      URL.revokeObjectURL(url);
      setClip(null);
      setState('idle');
      setNote('Clip discarded. Record again to re-test.');
    };
    a.onended = done;
    a.onerror = done;
    void a.play();
  };

  if (err) return <p role="alert">{err}</p>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <div
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={-80}
          aria-valuemax={0}
          aria-valuenow={Math.round(now)}
          style={{ flex: 1, position: 'relative', height: 24, border: '2px solid var(--ink)', borderRadius: 999, overflow: 'hidden', background: 'var(--white)' }}
        >
          <div style={{ position: 'absolute', inset: 0, width: `${pct(now)}%`, background: 'var(--teal)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(room)}%`, width: 3, background: 'var(--amber)' }} title="Room noise" />
        </div>
        <span className="num small">{(now - room).toFixed(0)} dB above room</span>
      </div>
      <div className="row">
        <button className="pill secondary" onClick={() => void record()} disabled={state !== 'idle'}>
          <Record size={22} /> Record 3 s
        </button>
        <button className="pill secondary" onClick={play} disabled={!clip || state !== 'idle'}>
          <Play size={22} /> Play back
        </button>
      </div>
      <p className="small" aria-live="polite">
        {note}
      </p>
    </div>
  );
}
