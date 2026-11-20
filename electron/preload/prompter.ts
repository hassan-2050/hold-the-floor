// Preload for the demo prompter window: receive state, stop recording.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('prompter', {
  onState: (cb: (s: unknown) => void) => ipcRenderer.on('demo:state', (_e, s) => cb(s)),
  onRec: (cb: (r: unknown) => void) => ipcRenderer.on('demo:rec', (_e, r) => cb(r)),
  stop: () => ipcRenderer.send('demo:stop-request'),
});
