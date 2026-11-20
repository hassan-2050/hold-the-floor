// Setup: API key (stored encrypted by the main process), camera and mic
// choice with a test, and the SDK's device-readiness verdict in words.
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Headphones, Key } from '@phosphor-icons/react';
import { useApp } from '../state/store';
import { session } from '../app/session';
import { readinessWords } from '../sensing/errors';
import { MicCheck } from '../ui/MicCheck';
import { Mirror } from '../ui/parts';

const VIRTUAL = /virtual|transcreen|obs|snap camera|manycam|xsplit|droidcam|ndi|broadcast/i;

export function Setup() {
  const consent = useApp((s) => s.consent);
  const settings = useApp((s) => s.settings);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [hasDev, setHasDev] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [ready, setReady] = useState<{ verdict: string; reason: string; tookMs: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [permErr, setPermErr] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const c = all.filter((d) => d.kind === 'videoinput');
    const m = all.filter((d) => d.kind === 'audioinput');
    setCams(c);
    setMics(m);
    const s = useApp.getState().settings;
    const patch: Partial<typeof s> = {};
    if (consent.camera && (!s.cameraId || !c.some((d) => d.deviceId === s.cameraId))) {
      patch.cameraId = (c.find((d) => !VIRTUAL.test(d.label)) ?? c[0])?.deviceId ?? null;
    }
    if (consent.mic && (!s.micId || !m.some((d) => d.deviceId === s.micId))) {
      patch.micId = (m.find((d) => !VIRTUAL.test(d.label)) ?? m[0])?.deviceId ?? null;
    }
    if (Object.keys(patch).length) await useApp.getState().updateSettings(patch);
  }, [consent.camera, consent.mic]);

  useEffect(() => {
    void window.htf.hasKey().then(setHasKey);
    void window.htf.hasDevKey().then(setHasDev);
    // One permission request so device names are visible; released at once.
    if (consent.camera || consent.mic) {
      navigator.mediaDevices
        .getUserMedia({ video: consent.camera, audio: consent.mic })
        .then((s) => {
          for (const t of s.getTracks()) t.stop();
          return refreshDevices();
        })
        .catch((e: Error) => setPermErr(`The system did not allow ${consent.camera ? 'the camera' : 'the microphone'} (${e.name}). Check your privacy settings, or continue without it.`));
    }
  }, [consent.camera, consent.mic, refreshDevices]);

  const stopPreview = useCallback(() => {
    setPreview((p) => {
      for (const t of p?.getTracks() ?? []) t.stop();
      return null;
    });
    setFps(null);
    useApp.getState().set({ cameraOn: false });
  }, []);
  useEffect(() => () => stopPreview(), [stopPreview]);

  const testCamera = async (): Promise<void> => {
    stopPreview();
    try {
      const s = await session.openCamera();
      setPreview(s);
      useApp.getState().set({ cameraOn: true });
      // Measure the real frame rate for 2 s.
      const v = document.createElement('video');
      v.muted = true;
      v.srcObject = s;
      await v.play();
      let n = 0;
      const t0 = performance.now();
      const cb = (): void => {
        n++;
        if (performance.now() - t0 < 2000) v.requestVideoFrameCallback(cb);
        else setFps(Math.round(n / ((performance.now() - t0) / 1000)));
      };
      v.requestVideoFrameCallback(cb);
    } catch (e) {
      setPermErr(`The camera could not start (${(e as Error).name}). Close other apps using it, or pick another camera.`);
    }
  };

  const saveKey = async (): Promise<void> => {
    const r = await window.htf.setKey(keyInput);
    setKeyInput('');
    if (r.ok) {
      setHasKey(true);
      setKeyMsg('Saved. The key is encrypted by your operating system.');
    } else setKeyMsg(r.error ?? 'Could not save the key.');
  };

  const checkReadiness = async (): Promise<void> => {
    // The native check opens the camera itself, so free it first.
    stopPreview();
    await session.stopSensing();
    setChecking(true);
    setReady(null);
    const label = cams.find((c) => c.deviceId === settings.cameraId)?.label ?? null;
    const r = await window.htf.readiness(label);
    setReady(r);
    setChecking(false);
  };

  const continueOn = async (withCamera: boolean): Promise<void> => {
    stopPreview();
    await session.stopSensing();
    if (!withCamera && consent.camera) useApp.getState().set({ consent: { ...consent, camera: false } });
    const c = useApp.getState().consent;
    if (!c.camera && !c.mic) {
      await session.startLive();
      useApp.getState().go('conversation');
      void session.beginConversation();
      return;
    }
    useApp.getState().go('calibration');
  };

  const verdictOk = ready ? readinessWords(ready.verdict).ok : false;
  const canContinueCamera = consent.camera && hasKey === true && verdictOk;

  return (
    <div className="column">
      <h1>Setup</h1>
      {permErr ? <p role="alert">{permErr}</p> : null}

      {consent.camera ? (
        <section className="field" aria-labelledby="key-h">
          <h2 id="key-h">
            <Key size={26} /> Presage API key
          </h2>
          {hasKey ? (
            <div className="row">
              <span>
                <Check size={22} color="var(--success)" /> A key is saved, encrypted by your operating system.
              </span>
              <button className="pill secondary" onClick={() => void window.htf.clearKey().then(() => setHasKey(false))}>
                Remove key
              </button>
            </div>
          ) : (
            <>
              <label htmlFor="api-key">Paste your key</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id="api-key" className="input" type="password" autoComplete="off" spellCheck={false} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
                <button className="pill primary" onClick={() => void saveKey()} disabled={!keyInput.trim()}>
                  Save
                </button>
              </div>
              <span className="help">
                Get one at physiology.presagetech.com. It is stored encrypted on this computer and used only to start SmartSpectra.
              </span>
              {hasDev ? (
                <button className="pill secondary" onClick={() => void window.htf.importDevKey().then((ok) => setHasKey(ok))}>
                  Use the development key from .env
                </button>
              ) : null}
            </>
          )}
          {keyMsg ? <p aria-live="polite">{keyMsg}</p> : null}
        </section>
      ) : null}

      {consent.camera ? (
        <section className="field">
          <h2>Camera</h2>
          <label htmlFor="cam">Camera</label>
          <select
            id="cam"
            className="select"
            value={settings.cameraId ?? ''}
            onChange={(e) => {
              stopPreview();
              void useApp.getState().updateSettings({ cameraId: e.target.value });
            }}
          >
            {cams.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || 'Camera'}
              </option>
            ))}
          </select>
          <span className="help">Sit back so your shoulders and upper chest are in view, with light in front of you.</span>
          <div className="row">
            {preview ? <Mirror stream={preview} large /> : null}
            <div style={{ display: 'grid', gap: 8 }}>
              {preview ? (
                <button className="pill secondary" onClick={stopPreview}>
                  Turn camera off
                </button>
              ) : (
                <button className="pill secondary" onClick={() => void testCamera()}>
                  Test camera
                </button>
              )}
              {fps !== null ? (
                <span className="num">
                  {fps} frames per second {fps >= 25 ? '(good)' : '(below 25 — add light in front of you, or choose 960×540 in Settings)'}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {consent.mic ? (
        <section className="field">
          <h2>Microphone</h2>
          <label htmlFor="mic">Microphone</label>
          <select id="mic" className="select" value={settings.micId ?? ''} onChange={(e) => void useApp.getState().updateSettings({ micId: e.target.value })}>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || 'Microphone'}
              </option>
            ))}
          </select>
          {settings.micId ? <MicCheck deviceId={settings.micId} noiseSuppression={settings.noiseSuppression} /> : null}
          <p className="help">
            <Headphones size={22} /> Headphones are best: then the agent's voice does not reach the microphone.
          </p>
        </section>
      ) : null}

      {consent.camera ? (
        <section className="field" aria-live="polite">
          <h2>Device check</h2>
          <p className="help">SmartSpectra checks that this computer and camera can measure. It takes about 25 seconds and needs the internet.</p>
          <div className="row">
            <button className="pill secondary" onClick={() => void checkReadiness()} disabled={checking || !hasKey}>
              {checking ? 'Checking… (about 25 s)' : ready ? 'Check again' : 'Check readiness'}
            </button>
            {ready ? (
              <span>
                <strong>{readinessWords(ready.verdict).title}.</strong> {ready.reason}
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="row">
        {consent.camera ? (
          <>
            <button className="pill primary" onClick={() => void continueOn(true)} disabled={!canContinueCamera}>
              Continue to calibration <ArrowRight size={22} />
            </button>
            <button className="pill secondary" onClick={() => void continueOn(false)}>
              Continue without camera
            </button>
          </>
        ) : (
          <button className="pill primary" onClick={() => void continueOn(false)}>
            Continue <ArrowRight size={22} />
          </button>
        )}
      </div>
    </div>
  );
}
