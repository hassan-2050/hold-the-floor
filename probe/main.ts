// Stage 1 technical probe (developer tool, not part of the product).
//
// Runs device readiness with telemetry off, then hosts a renderer that
// measures with useMediaStream, logs decoded metrics + mic loudness numbers
// to probe/logs/*.jsonl, and draws landmark indices over the mirror.
// No video frames or audio samples are written; loudness is one dB number
// per 20 ms.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';
import { SmartSpectraSDK } from '@smartspectra/node-sdk';
import { checkReadiness, listNativeCameras } from '../electron/main/readiness';
import { readDevApiKey, projectRoot } from '../electron/main/devEnv';

let log: WriteStream | null = null;
let logPath = '';

function openLog(): string {
  if (log) return logPath;
  const dir = join(projectRoot(), 'probe', 'logs');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  logPath = join(dir, `probe-${stamp}.jsonl`);
  log = createWriteStream(logPath, { flags: 'a' });
  return logPath;
}

function closeLog(): void {
  log?.end();
  log = null;
}

function diag(o: Record<string, unknown>): void {
  log?.write(JSON.stringify({ k: 'diag', rx: Date.now(), ...o }) + '\n');
}

app.whenReady().then(() => {
  // One log per run, opened at launch so failures before "Start" are kept.
  openLog();
  // Grant camera/mic only to our own bundled page.
  const isLocal = (url: string): boolean => url.startsWith('file://') || url.startsWith('http://localhost');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = details.requestingUrl || wc.getURL();
    const ok = permission === 'media' && isLocal(url);
    diag({ what: 'permissionRequest', permission, ok, mediaTypes: (details as { mediaTypes?: string[] }).mediaTypes });
    cb(ok);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && isLocal(origin));

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Hold the Floor - Stage 1 probe',
    webPreferences: {
      preload: join(__dirname, '../preload/probe.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  bindSmartSpectraIpc(win, {
    logger: (level, msg) => diag({ what: 'sdk-ipc', level, msg }),
  });
  win.webContents.on('console-message', (e) => {
    const ev = e as unknown as { level?: string; message?: string };
    if (ev.level === 'error' || ev.level === 'warning') diag({ what: 'console', level: ev.level, msg: String(ev.message).slice(0, 500) });
  });
  win.webContents.on('render-process-gone', (_e, d) => diag({ what: 'render-process-gone', reason: d.reason }));

  ipcMain.handle('probe:info', () => ({
    sdkVersion: SmartSpectraSDK.version,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    hasKey: readDevApiKey() !== null,
    nativeCameras: listNativeCameras(),
  }));
  // Probe only: hands the dev key to the renderer for SDK construction.
  ipcMain.handle('probe:key', () => readDevApiKey());
  ipcMain.handle('probe:readiness', async (_e, cameraLabel: string | null) => {
    const key = readDevApiKey();
    if (!key) return { verdict: 'inconclusive', reason: 'No SMARTSPECTRA_API_KEY in .env' };
    const t0 = Date.now();
    const r = await checkReadiness(key, cameraLabel);
    return { ...r, tookMs: Date.now() - t0 };
  });
  ipcMain.handle('probe:openLog', () => openLog());
  // The log stays open until quit so post-stop events are kept.
  ipcMain.handle('probe:closeLog', () => logPath);
  ipcMain.on('probe:lines', (_e, lines: string[]) => {
    if (!log) return;
    for (const l of lines) log.write(l + '\n');
  });

  const url = process.env.ELECTRON_RENDERER_URL;
  if (url) void win.loadURL(`${url}/probe/index.html`);
  else void win.loadFile(join(__dirname, '../renderer/probe/index.html'));
});

app.on('window-all-closed', () => {
  closeLog();
  app.quit();
});
