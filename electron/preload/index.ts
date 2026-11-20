// Preload: the SmartSpectra bridge (window.__smartspectraBridge) plus the
// app's narrow bridge (window.htf). Bundled into one file because
// sandboxed preloads cannot require modules.
import '@smartspectra/node-sdk/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type { AppBridge } from '../../src/shared/bridge';

const inv = ipcRenderer.invoke.bind(ipcRenderer);

const bridge: AppBridge = {
  info: () => inv('app:info'),
  hasKey: () => inv('key:has'),
  setKey: (key) => inv('key:set', key),
  clearKey: () => inv('key:clear'),
  keyForSdk: () => inv('key:forSdk'),
  hasDevKey: () => inv('key:hasDev'),
  importDevKey: () => inv('key:importDev'),
  readiness: (label) => inv('sdk:readiness', label),
  getSettings: () => inv('settings:get'),
  setSettings: (s) => inv('settings:set', s),
  saveSession: (name, jsonl) => inv('sessions:save', name, jsonl),
  listSessions: () => inv('sessions:list'),
  readSession: (id) => inv('sessions:read', id),
  deleteSession: (id) => inv('sessions:delete', id),
  deleteAllSessions: () => inv('sessions:deleteAll'),
  listFixtures: () => inv('fixtures:list'),
  readFixture: (id) => inv('fixtures:read', id),
  exportFile: (name, content) => inv('export:file', name, content),
  ttsSpeak: (text, rate) => inv('tts:speak', text, rate),
  ttsCancel: () => inv('tts:cancel'),
  wsStart: () => inv('ws:start'),
  wsStop: () => inv('ws:stop'),
  wsStatus: () => inv('ws:status'),
  wsSend: (event) => ipcRenderer.send('ws:send', event),
  debug: (event, data) => ipcRenderer.send('debug:log', event, data ?? {}),
  demoState: (s) => ipcRenderer.send('demo:state', s),
  recBegin: (mimeType) => inv('demo:rec-begin', mimeType),
  recChunk: (chunk) => ipcRenderer.send('demo:rec-chunk', chunk),
  recEnd: () => inv('demo:rec-end'),
  recError: (message) => ipcRenderer.send('demo:rec-error', message),
  onDemoStop: (cb) => {
    ipcRenderer.removeAllListeners('demo:stop');
    ipcRenderer.on('demo:stop', () => cb());
  },
  onShutdownRequest: (cb) => {
    ipcRenderer.removeAllListeners('app:shutdown');
    ipcRenderer.on('app:shutdown', () => cb());
  },
  shutdownDone: () => ipcRenderer.send('app:shutdown-done'),
};

contextBridge.exposeInMainWorld('htf', bridge);
