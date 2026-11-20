// Demo prompter: shows the current part of the script and the recording
// status. Lives in its own window above the app, so it is not recorded.
import { demoStep, type DemoState } from '../demo/script';

interface RecStatus {
  on: boolean;
  path: string;
  bytes: number;
  startedAt: number;
  error: string | null;
  /** False in script-only mode (npm run demo:script). */
  planned: boolean;
}

declare global {
  interface Window {
    prompter: {
      onState(cb: (s: DemoState) => void): void;
      onRec(cb: (r: RecStatus) => void): void;
      stop(): void;
    };
  }
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const show = (id: string, text: string | undefined): void => {
  const el = $(id);
  el.textContent = text ?? '';
  el.hidden = !text;
};

window.prompter.onState((s) => {
  const step = demoStep(s);
  $('part').textContent = step.part;
  show('say', step.say);
  show('act', step.act);
  show('then', step.then);
});

let rec: RecStatus | null = null;
const mmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const paint = (): void => {
  const st = $('status');
  if (rec?.on) {
    st.className = 'dot';
    st.textContent = `● REC ${mmss(Date.now() - rec.startedAt)}`;
    $('stop').hidden = false;
    $('path').textContent = '';
  } else if (rec && !rec.planned) {
    st.className = 'idle';
    st.textContent = 'Script only (not recording)';
    $('stop').hidden = true;
  } else if (rec?.path) {
    st.className = 'idle';
    st.textContent = `Saved (${(rec.bytes / 1e6).toFixed(1)} MB)`;
    $('stop').hidden = true;
    $('path').textContent = rec.path;
  }
  $('err').textContent = rec?.error ? `Recording problem: ${rec.error}` : '';
};
window.prompter.onRec((r) => {
  rec = r;
  paint();
});
window.setInterval(paint, 500);
$('stop').addEventListener('click', () => window.prompter.stop());
