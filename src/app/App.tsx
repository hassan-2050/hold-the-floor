// App frame: top bar (logo, camera/mic status, Privacy, gear), banner,
// the current screen, the Settings/Privacy sheet, and global keys:
// Enter = Send, Esc / F8 = stop sensing, Space = "I am truly done" (oracle),
// Backspace = "I wasn't finished".
import { useEffect } from 'react';
import { GearSix, ShieldCheck } from '@phosphor-icons/react';
import { useApp } from '../state/store';
import { session } from './session';
import { dbg, setDebug } from './debug';
import { startDemoRecording, startDemoSync, stopDemoRecording } from './demoRecorder';
import { BannerView, DeviceChips, Logo } from '../ui/parts';
import { Welcome } from '../screens/Welcome';
import { Consent } from '../screens/Consent';
import { Setup } from '../screens/Setup';
import { Calibration } from '../screens/Calibration';
import { Conversation } from '../screens/Conversation';
import { Results } from '../screens/Results';
import { SettingsSheet } from '../screens/SettingsSheet';
import { PrivacySheet } from '../screens/PrivacySheet';

const isTyping = (el: Element | null): boolean =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

export function App() {
  const screen = useApp((s) => s.screen);
  const sheet = useApp((s) => s.sheet);
  const banner = useApp((s) => s.banner);
  const cameraOn = useApp((s) => s.cameraOn);
  const micOn = useApp((s) => s.micOn);
  const announcement = useApp((s) => s.announcement);
  const mode = useApp((s) => s.mode);

  useEffect(() => {
    void (async () => {
      const [info, settings] = await Promise.all([window.htf.info(), window.htf.getSettings()]);
      useApp.getState().set({ info, settings });
      setDebug(info.debug);
      // End-to-end tests drive the real screens with recorded numbers.
      if (info.e2e) Object.assign(window, { __htfTest: { session, store: useApp } });
      dbg('renderer-start', { e2e: info.e2e, replay: info.replayFlag });
      window.addEventListener('error', (e) => dbg('renderer-error', { msg: String(e.message), file: String(e.filename).split('/').pop(), line: e.lineno }));
      window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason as { message?: string; code?: unknown } | undefined;
        dbg('renderer-rejection', { msg: String(r?.message ?? r), code: String(r?.code ?? '') });
      });
      if (info.demo) {
        // Demo defaults for this run only (not saved): comparison on, oracle off,
        // Places, and the lighter 960x540 camera so the recording leaves
        // SmartSpectra enough time per frame (it stops below 25 fps).
        useApp.getState().set({ settings: { ...settings, comparison: true, oracle: false, questionSet: 'places', captureSize: '960x540' } });
        startDemoSync();
        if (info.demoRecord) void startDemoRecording();
      }
      if (info.replayFlag) await startBundledReplay();
    })();
    // Quit / window close: stop sensing first, then confirm to main.
    window.htf.onShutdownRequest(() => {
      void stopDemoRecording()
        .catch(() => undefined)
        .then(() => session.stopSensing())
        .finally(() => window.htf.shutdownDone());
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useApp.getState();
      if (e.key === 'F8' || (e.key === 'Escape' && !st.sheet)) {
        e.preventDefault();
        void session.stopSensing();
        return;
      }
      if (e.key === 'Escape' && st.sheet) {
        st.openSheet(null);
        return;
      }
      if (st.screen !== 'conversation' || st.mode !== 'live' || st.sheet) return;
      const target = document.activeElement;
      if (isTyping(target)) return;
      if (e.key === 'Enter' && !(target instanceof HTMLButtonElement)) {
        e.preventDefault();
        session.send();
      } else if (e.key === ' ' && st.settings.oracle && !(target instanceof HTMLButtonElement)) {
        e.preventDefault();
        session.oracleDone();
      } else if (e.key === 'Backspace' && st.agentSpeaking) {
        e.preventDefault();
        session.notDone();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showChips = screen === 'calibration' || screen === 'conversation' || cameraOn || micOn;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>Hold the Floor</span>
        </div>
        <div className="spacer" />
        {showChips && mode === 'live' ? <DeviceChips cameraOn={cameraOn} micOn={micOn} /> : null}
        <button className="pill secondary" onClick={() => useApp.getState().openSheet('privacy')}>
          <ShieldCheck size={24} /> Privacy
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={() => useApp.getState().openSheet('settings')}>
          <GearSix size={30} />
        </button>
      </header>
      <div className="middle">
        {banner ? <BannerView banner={banner} onClose={() => useApp.getState().set({ banner: null })} /> : null}
        <main className={`screen${screen === 'conversation' ? ' full' : ''}`}>
          {screen === 'welcome' && <Welcome />}
          {screen === 'consent' && <Consent />}
          {screen === 'setup' && <Setup />}
          {screen === 'calibration' && <Calibration />}
          {screen === 'conversation' && <Conversation />}
          {screen === 'results' && <Results />}
        </main>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {sheet === 'settings' && <SettingsSheet />}
      {sheet === 'privacy' && <PrivacySheet />}
    </div>
  );
}

/** Judges without a key: replay the bundled recording. */
export async function startBundledReplay(): Promise<void> {
  const fixtures = await window.htf.listFixtures();
  // The live demo session is the default; any other bundled file is a fallback.
  const f = fixtures.find((x) => x.id === 'demo-session') ?? fixtures[0];
  if (!f) {
    useApp.getState().set({ banner: { kind: 'error', title: 'No recorded session found', message: 'The bundled replay file is missing from fixtures/sessions.' } });
    return;
  }
  const text = await window.htf.readFixture(f.id);
  if (!text) return;
  useApp.getState().go('conversation');
  // Replays show the side-by-side comparison (this run only, not saved).
  useApp.getState().set({ settings: { ...useApp.getState().settings, comparison: true } });
  await session.startReplay(text, f.label);
}
