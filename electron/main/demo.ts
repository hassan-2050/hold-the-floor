// Demo mode (`npm run demo`): a script window docked above the app, and a
// recording of the app's own page plus system audio (the agent's voice) and
// the microphone, saved to the Videos folder. Developer tool for making the
// demo video: never active in a normal start, never uploads anything.
import { app, BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

const PROMPTER_HEIGHT = 220;

export interface DemoLayout {
  main: Rectangle;
  prompter: Rectangle;
}

export function demoLayout(): DemoLayout {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1440, wa.width);
  const x = wa.x + Math.round((wa.width - width) / 2);
  return {
    prompter: { x, y: wa.y, width, height: PROMPTER_HEIGHT },
    main: { x, y: wa.y + PROMPTER_HEIGHT, width, height: wa.height - PROMPTER_HEIGHT },
  };
}

export interface RecStatus {
  on: boolean;
  path: string;
  bytes: number;
  startedAt: number;
  error: string | null;
  /** False in script-only mode (npm run demo:script). */
  planned: boolean;
}

export function setupDemo(main: BrowserWindow, layout: DemoLayout, load: (w: BrowserWindow, page: 'prompter') => void, record: boolean): void {
  const prompter = new BrowserWindow({
    ...layout.prompter,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    // Never takes keyboard focus, so Enter / Space / Esc keep going to the app.
    focusable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#142024',
    webPreferences: {
      preload: join(__dirname, '../preload/prompter.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  load(prompter, 'prompter');
  prompter.once('ready-to-show', () => prompter.showInactive());
  main.on('closed', () => {
    if (!prompter.isDestroyed()) prompter.destroy();
  });

  // Recording source: the app's own page (not the desktop) and, on Windows,
  // system audio so the agent's voice is included.
  main.webContents.session.setDisplayMediaRequestHandler((req, cb) => {
    cb({ video: main.webContents.mainFrame, ...(req.audioRequested && process.platform === 'win32' ? { audio: 'loopback' as const } : {}) });
  });

  let file: WriteStream | null = null;
  const st: RecStatus = { on: false, path: '', bytes: 0, startedAt: 0, error: null, planned: record };
  const send = (): void => {
    if (!prompter.isDestroyed()) prompter.webContents.send('demo:rec', st);
  };
  const ticker = setInterval(send, 1000);
  main.on('closed', () => clearInterval(ticker));

  ipcMain.handle('demo:rec-begin', (_e, mime: unknown) => {
    const dir = process.env.HTF_DEMO_DIR || app.getPath('videos');
    mkdirSync(dir, { recursive: true });
    const ext = String(mime).startsWith('video/mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    st.path = join(dir, `Hold the Floor demo ${stamp}.${ext}`);
    file = createWriteStream(st.path);
    Object.assign(st, { on: true, bytes: 0, startedAt: Date.now(), error: null });
    send();
    return st.path;
  });
  ipcMain.on('demo:rec-chunk', (_e, chunk: unknown) => {
    if (!file || !(chunk instanceof Uint8Array)) return;
    file.write(Buffer.from(chunk));
    st.bytes += chunk.byteLength;
  });
  ipcMain.handle('demo:rec-end', async () => {
    const f = file;
    file = null;
    st.on = false;
    if (f) await new Promise<void>((resolve) => f.end(() => resolve()));
    send();
    return st.path;
  });
  ipcMain.on('demo:rec-error', (_e, msg: unknown) => {
    st.error = String(msg).slice(0, 300);
    send();
  });
  ipcMain.on('demo:state', (_e, s: unknown) => {
    if (!prompter.isDestroyed()) prompter.webContents.send('demo:state', s);
  });
  // Stop button in the prompter: ask the app window to stop and save.
  ipcMain.on('demo:stop-request', () => main.webContents.send('demo:stop'));
}
