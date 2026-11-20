// Main process: one window, the SmartSpectra IPC binding, the API-key
// store, settings and saved sessions, the local WebSocket API, TTS
// fallback, and a shutdown handshake so the camera is off before quitting.
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { createWriteStream, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';
import { SmartSpectraSDK } from '@smartspectra/node-sdk';
import { checkReadiness } from './readiness';
import { readDevApiKey } from './devEnv';
import * as keychain from './keychain';
import * as storage from './storage';
import { wsBroadcast, wsStart, wsStatus, wsStop } from './ws';
import { ttsCancel, ttsSpeak } from './tts';
import { demoLayout, setupDemo } from './demo';
import type { AppInfo } from '../../src/shared/bridge';

// End-to-end tests run against a throwaway data folder.
if (process.env.HTF_E2E_USERDATA) {
  app.setPath('userData', process.env.HTF_E2E_USERDATA);
  // Synthetic camera and microphone so tests can open devices without hardware.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

const REPLAY_FLAG = process.argv.includes('--replay');
// Opt-in debug log: event names, codes, counts, timings. Never landmarks,
// audio or the API key. Overwritten at each start.
// Demo mode (`npm run demo`): prompter window + screen recording; implies the debug log.
const DEMO = process.argv.includes('demo');
// `npm run demo:script`: the script window without the in-app recording.
const DEMO_RECORD = DEMO && !process.argv.includes('norec');
// Accepts `npm run start:debug` (--htf-debug) and `npm start debug` (debug).
const DEBUG = DEMO || process.argv.includes('--htf-debug') || process.argv.includes('debug') || process.env.HTF_DEBUG === '1';
let debugStream: WriteStream | null = null;
const debugLogPath = (): string => join(app.getPath('userData'), 'debug.log');

function clean(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 300);
  if (depth < 2 && Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  if (depth < 2 && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) out[k.slice(0, 40)] = clean(x, depth + 1);
    return out;
  }
  return undefined;
}

function debugWrite(src: 'main' | 'renderer', ev: string, data: unknown = {}): void {
  if (!DEBUG) return;
  debugStream ??= createWriteStream(debugLogPath(), { flags: 'w' });
  const line = JSON.stringify({ at: new Date().toISOString(), src, ev: String(ev).slice(0, 60), ...(clean(data) as object) });
  debugStream.write(line + '\n');
  if (ev !== 'beat') process.stdout.write(`[htf] ${line}\n`);
}

let win: BrowserWindow | null = null;
let shutdownComplete = false;

const isOwnPage = (url: string): boolean => {
  if (url.startsWith('file://')) return true;
  const dev = process.env.ELECTRON_RENDERER_URL;
  return !!dev && url.startsWith(dev);
};

function loadPage(w: BrowserWindow, page: 'index' | 'prompter'): void {
  const dev = process.env.ELECTRON_RENDERER_URL;
  const rel = page === 'index' ? 'src/index.html' : 'src/prompter/index.html';
  if (dev) void w.loadURL(`${dev}/${rel}`);
  else void w.loadFile(join(__dirname, '../renderer', rel));
}

function createWindow(): void {
  const layout = DEMO ? demoLayout() : null;
  win = new BrowserWindow({
    ...(layout ? layout.main : { width: 1440, height: 900 }),
    autoHideMenuBar: DEMO,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#F3F6F4',
    title: 'Hold the Floor',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  // SDK IPC: logs carry no key or metric values, only bridge diagnostics.
  bindSmartSpectraIpc(win, {
    logger: (level, msg) => {
      debugWrite('main', 'sdk-ipc', { level, msg });
      if (level === 'error') console.error(`[smartspectra] ${msg}`);
      else if (level === 'warn') console.warn(`[smartspectra] ${msg}`);
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Never navigate away from the bundled page; open links in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isOwnPage(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (!shutdownComplete) {
      e.preventDefault();
      void shutdown().then(() => app.quit());
    }
  });
  loadPage(win, 'index');
  if (layout) setupDemo(win, layout, loadPage, DEMO_RECORD);
}

/** Ask the renderer to stop tracks + SDK, wait up to 1 s, then close the API. */
async function shutdown(): Promise<void> {
  if (shutdownComplete) return;
  const w = win;
  if (w && !w.isDestroyed()) {
    await new Promise<void>((resolve) => {
      // Demo mode needs a little longer to finish writing the video file.
      const timer = setTimeout(resolve, DEMO ? 6000 : 1000);
      ipcMain.once('app:shutdown-done', () => {
        clearTimeout(timer);
        resolve();
      });
      w.webContents.send('app:shutdown');
    });
  }
  ttsCancel();
  await wsStop();
  shutdownComplete = true;
}

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain);
  h('app:info', (): AppInfo => ({
    version: app.getVersion(),
    sdkVersion: SmartSpectraSDK.version,
    platform: `${process.platform}-${process.arch}`,
    replayFlag: REPLAY_FLAG,
    dataPath: app.getPath('userData'),
    sessionsPath: storage.sessionsDir(),
    e2e: !!process.env.HTF_E2E_USERDATA,
    debug: DEBUG,
    debugLogPath: DEBUG ? debugLogPath() : null,
    demo: DEMO,
    demoRecord: DEMO_RECORD,
  }));
  h('key:has', () => keychain.hasKey());
  h('key:set', (_e, key: unknown) => (typeof key === 'string' ? keychain.setKey(key) : { ok: false, error: 'Invalid key.' }));
  h('key:clear', () => keychain.clearKey());
  // The key leaves the main process only here, for the SDK constructor.
  h('key:forSdk', () => keychain.getKey());
  h('key:hasDev', () => !app.isPackaged && readDevApiKey() !== null);
  h('key:importDev', async () => {
    const k = app.isPackaged ? null : readDevApiKey();
    return k ? (await keychain.setKey(k)).ok : false;
  });
  h('sdk:readiness', async (_e, cameraLabel: unknown) => {
    const key = await keychain.getKey();
    const t0 = Date.now();
    if (!key) return { verdict: 'blocked', reason: 'Add your Presage API key first.', tookMs: 0 };
    const r = await checkReadiness(key, typeof cameraLabel === 'string' ? cameraLabel : null);
    debugWrite('main', 'readiness', { ...r, tookMs: Date.now() - t0, cameraLabel });
    return { ...r, tookMs: Date.now() - t0 };
  });
  h('settings:get', () => storage.readSettings());
  h('settings:set', (_e, s: unknown) => storage.writeSettings(s as never));
  h('sessions:save', (_e, name: unknown, jsonl: unknown) => storage.saveSession(String(name), String(jsonl)));
  h('sessions:list', () => storage.listSessions());
  h('sessions:read', (_e, id: unknown) => storage.readSession(String(id)));
  h('sessions:delete', (_e, id: unknown) => storage.deleteSession(String(id)));
  h('sessions:deleteAll', () => storage.deleteAllSessions());
  h('fixtures:list', () => storage.listFixtures());
  h('fixtures:read', (_e, id: unknown) => storage.readFixture(String(id)));
  h('export:file', async (_e, name: unknown, content: unknown) => {
    if (!win) return null;
    const r = await dialog.showSaveDialog(win, { defaultPath: String(name).replace(/[\\/:*?"<>|]/g, '-') });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, String(content));
    return r.filePath;
  });
  h('tts:speak', (_e, text: unknown, rate: unknown) => ttsSpeak(String(text), typeof rate === 'number' ? rate : 1));
  h('tts:cancel', () => ttsCancel());
  h('ws:start', () => wsStart());
  h('ws:stop', () => wsStop());
  h('ws:status', () => wsStatus());
  ipcMain.on('ws:send', (_e, ev: unknown) => wsBroadcast(ev));
  ipcMain.on('debug:log', (_e, ev: unknown, data: unknown) => debugWrite('renderer', String(ev), data));
}

app.whenReady().then(() => {
  if (DEBUG) {
    debugWrite('main', 'start', { version: app.getVersion(), sdk: SmartSpectraSDK.version, electron: process.versions.electron, platform: `${process.platform}-${process.arch}` });
    process.stdout.write(`[htf] debug log: ${debugLogPath()}\n`);
  }
  // Camera and microphone only for our own page; everything else denied.
  // Demo mode also allows capturing the app's own window for the recording.
  const allowed = (permission: string): boolean => permission === 'media' || (DEMO && permission === 'display-capture');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = details.requestingUrl || wc.getURL();
    cb(allowed(permission) && isOwnPage(url));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowed(permission) && isOwnPage(origin));
  registerIpc();
  createWindow();
});

app.on('before-quit', (e) => {
  if (!shutdownComplete) {
    e.preventDefault();
    void shutdown().then(() => app.quit());
  }
});

app.on('window-all-closed', () => app.quit());
