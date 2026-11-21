// Web replay page: a browser stand-in for the desktop bridge (`window.htf`).
// Only the replay works here. Settings and saved sessions live in memory for
// this tab, and export downloads a file. Everything that needs the desktop
// app (API key, camera readiness, SmartSpectra, the end_of_turn API, demo
// recording) says so instead.
import type { AppBridge, AppInfo, SessionInfo, WsStatus } from '../shared/bridge';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../shared/settings';

declare const __HTF_VERSION__: string;

const REPO_URL = 'https://github.com/hassan-2050/hold-the-floor';
const DESKTOP_ONLY = 'This needs the desktop app (camera, microphone and SmartSpectra). The web page only replays a recorded session.';
const FIXTURE = 'demo-session';

let settings: Settings = { ...DEFAULT_SETTINGS };
const sessions = new Map<string, { info: SessionInfo; text: string }>();
let fixtureText: Promise<string | null> | null = null;
const loadFixture = (): Promise<string | null> =>
  (fixtureText ??= fetch(`./fixtures/${FIXTURE}.jsonl`)
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null));

const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);
const wsOff: WsStatus = { running: false, port: null, token: null, clients: 0, error: 'The end_of_turn API runs in the desktop app.' };

const info: AppInfo = {
  version: __HTF_VERSION__,
  sdkVersion: 'not used on the web page',
  platform: 'web',
  replayFlag: false,
  dataPath: 'none: this web page writes nothing to disk; saved sessions stay in memory until you close the tab',
  sessionsPath: '',
  e2e: false,
  debug: false,
  debugLogPath: null,
  demo: false,
  demoRecord: false,
  web: { repoUrl: REPO_URL },
};

const bridge: AppBridge = {
  info: () => resolved(info),
  hasKey: () => resolved(false),
  setKey: () => resolved({ ok: false, error: DESKTOP_ONLY }),
  clearKey: () => resolved(undefined),
  keyForSdk: () => resolved(null),
  hasDevKey: () => resolved(false),
  importDevKey: () => resolved(false),
  readiness: () => resolved({ verdict: 'blocked' as const, reason: DESKTOP_ONLY, tookMs: 0 }),
  getSettings: () => resolved({ ...settings }),
  setSettings: (s) => {
    settings = sanitizeSettings(s);
    return resolved({ ...settings });
  },
  saveSession: (name, jsonl) => {
    const entry: SessionInfo = { id: `web-${Date.now()}-${sessions.size + 1}`, name, created: new Date().toISOString(), bytes: new Blob([jsonl]).size };
    sessions.set(entry.id, { info: entry, text: jsonl });
    return resolved(entry);
  },
  listSessions: () => resolved([...sessions.values()].map((s) => s.info).sort((a, b) => b.created.localeCompare(a.created))),
  readSession: (id) => resolved(sessions.get(id)?.text ?? null),
  deleteSession: (id) => {
    sessions.delete(id);
    return resolved(undefined);
  },
  deleteAllSessions: () => {
    const n = sessions.size;
    sessions.clear();
    return resolved(n);
  },
  listFixtures: async () => {
    const text = await loadFixture();
    if (!text) return [];
    let label = 'Recorded live session';
    try {
      label = (JSON.parse(text.slice(0, text.indexOf('\n'))) as { settings?: { label?: string } }).settings?.label ?? label;
    } catch {
      /* keep the default label */
    }
    return [{ id: FIXTURE, label }];
  },
  readFixture: (id) => (id === FIXTURE ? loadFixture() : resolved(null)),
  exportFile: (defaultName, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return resolved(defaultName);
  },
  ttsSpeak: () => resolved({ ok: false, error: DESKTOP_ONLY }),
  ttsCancel: () => resolved(undefined),
  wsStart: () => resolved(wsOff),
  wsStop: () => resolved(wsOff),
  wsStatus: () => resolved(wsOff),
  wsSend: () => undefined,
  debug: () => undefined,
  demoState: () => undefined,
  recBegin: () => Promise.reject(new Error(DESKTOP_ONLY)),
  recChunk: () => undefined,
  recEnd: () => Promise.reject(new Error(DESKTOP_ONLY)),
  recError: () => undefined,
  onDemoStop: () => undefined,
  onShutdownRequest: () => undefined,
  shutdownDone: () => undefined,
};

window.htf = bridge;
