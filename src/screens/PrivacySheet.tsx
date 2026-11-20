// Privacy sheet: what is on, what is sent, what is stored, and deletion.
import { useEffect, useState } from 'react';
import { Trash, VideoCameraSlash } from '@phosphor-icons/react';
import { useApp } from '../state/store';
import { session } from '../app/session';
import { DeviceChips, Sheet } from '../ui/parts';
import type { SessionInfo } from '../shared/bridge';

export function PrivacySheet() {
  const info = useApp((s) => s.info);
  const cameraOn = useApp((s) => s.cameraOn);
  const micOn = useApp((s) => s.micOn);
  const [list, setList] = useState<SessionInfo[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void window.htf.listSessions().then(setList);
  }, []);

  const deleteAll = async (): Promise<void> => {
    const n = await window.htf.deleteAllSessions();
    setConfirm(false);
    setList([]);
    setMsg(`Deleted ${n} saved session${n === 1 ? '' : 's'}. The sessions folder is empty.`);
  };

  return (
    <Sheet title="Privacy" onClose={() => useApp.getState().openSheet(null)}>
      <section>
        <h3>Right now</h3>
        <DeviceChips cameraOn={cameraOn} micOn={micOn} />
        {cameraOn || micOn ? (
          <button className="pill secondary" onClick={() => void session.stopSensing()}>
            <VideoCameraSlash size={22} /> Turn camera and microphone off <span className="key">Esc</span>
          </button>
        ) : null}
      </section>
      <section>
        <h3>What leaves this computer</h3>
        <p>
          SmartSpectra telemetry is <strong>off</strong> (<span className="num">enableTelemetry: false</span>). The SmartSpectra SDK still contacts Presage online to check its licence and
          usage when measuring; there is no offline mode. Video is processed on this computer. This app makes no other network calls. The optional end_of_turn API listens on
          127.0.0.1 only.
        </p>
      </section>
      <section>
        <h3>What is stored</h3>
        <ul>
          <li>Settings, as a small JSON file.</li>
          <li>Your API key, encrypted by the operating system.</li>
          <li>Saved sessions, only if you press Save: numbers only, no video, no audio.</li>
        </ul>
        {info ? (
          <p className="small">
            Folder: <span className="num" style={{ wordBreak: 'break-all' }}>{info.dataPath}</span>
          </p>
        ) : null}
      </section>
      <section>
        <h3>Saved sessions ({list.length})</h3>
        {list.map((x) => (
          <div key={x.id} className="rowline">
            <span>{x.name}</span>
            <button className="pill secondary" onClick={() => void window.htf.deleteSession(x.id).then(() => window.htf.listSessions().then(setList))}>
              <Trash size={20} /> Delete
            </button>
          </div>
        ))}
        {confirm ? (
          <div className="row" role="alertdialog" aria-label="Confirm delete all">
            <span>Delete every saved session? This cannot be undone.</span>
            <button className="pill danger" onClick={() => void deleteAll()} autoFocus>
              Yes, delete all
            </button>
            <button className="pill secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="pill danger" onClick={() => setConfirm(true)} disabled={list.length === 0}>
            <Trash size={22} /> Delete all sessions
          </button>
        )}
        {msg ? <p aria-live="polite">{msg}</p> : null}
      </section>
      <section>
        <h3>What this app does not do</h3>
        <p>It does not identify you, read emotions, judge your speech, or detect, rate or treat stuttering or any condition. It only decides when to reply.</p>
      </section>
    </Sheet>
  );
}
