// Settings sheet. Changes apply from the next turn.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { session } from '../app/session';
import { Sheet } from '../ui/parts';
import { voicesReady } from '../agent/voice';
import { QUESTION_SETS } from '../agent/interviewer';
import type { Settings } from '../shared/settings';
import type { CueName } from '../turn/events';

const CUE_LABEL: Record<CueName, string> = {
  lips: 'Lips (pressed or set to speak)',
  talking: 'Still talking (mouth moving)',
  breath: 'Breathing in',
  head: 'Head turned away',
};

export function SettingsSheet() {
  const s = useApp((st) => st.settings);
  const ws = useApp((st) => st.ws);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    void voicesReady().then(setVoices);
    void window.htf.wsStatus().then((w) => useApp.getState().set({ ws: w }));
  }, []);

  const update = async (p: Partial<Settings>): Promise<void> => {
    await useApp.getState().updateSettings(p);
    session.applySettings();
  };

  const toggleWs = async (on: boolean): Promise<void> => {
    await update({ websocket: on });
    useApp.getState().set({ ws: on ? await window.htf.wsStart() : await window.htf.wsStop() });
  };

  return (
    <Sheet title="Settings" onClose={() => useApp.getState().openSheet(null)}>
      <section>
        <h3>Timing</h3>
        <div className="field">
          <label htmlFor="cand">
            Silence before a turn can end: <span className="num">{s.candidateSilenceMs} ms</span>
          </label>
          <input id="cand" className="range" type="range" min={300} max={600} step={50} value={s.candidateSilenceMs} onChange={(e) => void update({ candidateSilenceMs: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="cap">
            Longest wait while holding: <span className="num">{(s.hardCapMs / 1000).toFixed(0)} s</span>
          </label>
          <input id="cap" className="range" type="range" min={4000} max={15000} step={1000} value={s.hardCapMs} onChange={(e) => void update({ hardCapMs: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="fb">
            Fixed timer when camera cues pause: <span className="num">{(s.fallbackTimerMs / 1000).toFixed(1)} s</span>
          </label>
          <input id="fb" className="range" type="range" min={700} max={5000} step={100} value={s.fallbackTimerMs} onChange={(e) => void update({ fallbackTimerMs: Number(e.target.value) })} />
        </div>
      </section>
      <section>
        <h3>Cues that can hold the floor</h3>
        {(Object.keys(CUE_LABEL) as CueName[]).map((c) => (
          <label key={c} className="check">
            <input type="checkbox" checked={s.cues[c]} onChange={(e) => void update({ cues: { ...s.cues, [c]: e.target.checked } })} />
            <span>{CUE_LABEL[c]}</span>
          </label>
        ))}
      </section>
      <section>
        <h3>Agent voice</h3>
        <div className="field">
          <label htmlFor="voice">Voice</label>
          <select id="voice" className="select" value={s.voiceName ?? ''} onChange={(e) => void update({ voiceName: e.target.value || null })}>
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          {voices.length === 0 ? <span className="help">No browser voices found; the system speech engine is used instead.</span> : null}
        </div>
        <div className="field">
          <label htmlFor="rate">
            Speaking rate: <span className="num">{s.voiceRate.toFixed(1)}×</span>
          </label>
          <input id="rate" className="range" type="range" min={0.7} max={1.3} step={0.1} value={s.voiceRate} onChange={(e) => void update({ voiceRate: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="qset">Question set</label>
          <select id="qset" className="select" value={s.questionSet} onChange={(e) => void update({ questionSet: e.target.value as Settings['questionSet'] })}>
            {Object.values(QUESTION_SETS).map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section>
        <h3>Views and modes</h3>
        <label className="check">
          <input type="checkbox" checked={s.comparison} onChange={(e) => void update({ comparison: e.target.checked })} />
          <span>Side-by-side comparison with a 2.0 s timer</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.oracle} onChange={(e) => void update({ oracle: e.target.checked })} />
          <span>
            Oracle test mode: the agent waits until you press Space ("I am truly done"), and every policy is measured against it. Applies to the next session.
          </span>
        </label>
      </section>
      <section>
        <h3>Camera and microphone</h3>
        <div className="field">
          <label htmlFor="size">Camera size</label>
          <select id="size" className="select" value={s.captureSize} onChange={(e) => void update({ captureSize: e.target.value as Settings['captureSize'] })}>
            <option value="1280x720">1280 × 720 (default)</option>
            <option value="960x540">960 × 540 (for slower cameras)</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.noiseSuppression} onChange={(e) => void update({ noiseSuppression: e.target.checked })} />
          <span>Microphone noise suppression (helps with fans and hum)</span>
        </label>
      </section>
      <section>
        <h3>end_of_turn API</h3>
        <label className="check">
          <input type="checkbox" checked={s.websocket} onChange={(e) => void toggleWs(e.target.checked)} />
          <span>Send turn events to local voice agents over a WebSocket on 127.0.0.1. Only decisions are sent, never camera or microphone data.</span>
        </label>
        {s.websocket && ws ? (
          ws.running ? (
            <p className="small">
              <span className="num" style={{ userSelect: 'all', wordBreak: 'break-all' }}>
                ws://127.0.0.1:{ws.port}/?token={ws.token}
              </span>
              <br />
              {ws.clients} client{ws.clients === 1 ? '' : 's'} connected. See docs/WS-API.md.
            </p>
          ) : (
            <p role="alert">The API could not start: {ws.error}</p>
          )
        ) : null}
      </section>
    </Sheet>
  );
}
