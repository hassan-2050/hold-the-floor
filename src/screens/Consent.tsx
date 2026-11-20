// Consent: a plain-language letter. Camera and microphone are separate
// choices; nothing starts until the user agrees here, and then the OS asks.
import { useState } from 'react';
import { useApp } from '../state/store';

export function Consent() {
  const [camera, setCamera] = useState(true);
  const [mic, setMic] = useState(true);

  const agree = (): void => {
    useApp.getState().set({ consent: { camera, mic, given: true } });
    useApp.getState().go('setup');
  };
  const decline = (): void => {
    useApp.getState().set({ consent: { camera: false, mic: false, given: true } });
    useApp.getState().go('setup');
  };

  return (
    <div className="column">
      <h1>Before we start</h1>
      <article className="letter" aria-labelledby="consent-h">
        <h2 id="consent-h">How Hold the Floor uses your camera and microphone</h2>
        <section>
          <h3>What is measured</h3>
          <ul>
            <li>The shape of your lips (pressed, parted, moving), the direction of your head, your breathing movement, and whether you look like you are talking.</li>
            <li>From the microphone: only how loud it is, every 20 milliseconds.</li>
          </ul>
        </section>
        <section>
          <h3>What is not measured</h3>
          <ul>
            <li>Not who you are, not your emotions, not your health, and not your words. There is no speech recognition.</li>
            <li>Only you are watched. If a second face appears, camera cues pause.</li>
          </ul>
        </section>
        <section>
          <h3>Where it goes</h3>
          <ul>
            <li>Video is processed on this computer by the SmartSpectra SDK and is never saved or sent by this app. Audio is never recorded.</li>
            <li>SmartSpectra checks its licence with Presage online, even though telemetry is turned off.</li>
            <li>Nothing is saved unless you choose to save a session, and then only numbers.</li>
          </ul>
        </section>
        <section>
          <h3>How to stop</h3>
          <p>Press Esc or F8, or the Stop button, at any time. The camera turns off within a second.</p>
        </section>
        <div style={{ display: 'grid', gap: 16 }}>
          <label className="check">
            <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
            <span>
              <strong>Use my camera</strong> for lip shape, head direction, breathing movement and talking.
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
            <span>
              <strong>Use my microphone for loudness only</strong>. It is never recorded. Without it, you end each answer with Enter or the Send button.
            </span>
          </label>
        </div>
      </article>
      <div className="row">
        <button className="pill primary" onClick={agree} disabled={!camera && !mic}>
          Agree and continue
        </button>
        <button className="pill secondary" onClick={decline}>
          Decline both (answer with the Send button only)
        </button>
      </div>
    </div>
  );
}
