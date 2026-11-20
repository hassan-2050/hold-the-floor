// Probe preload: the SmartSpectra bridge plus a tiny probe bridge.
import '@smartspectra/node-sdk/preload';
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('probe', {
  info: () => ipcRenderer.invoke('probe:info'),
  key: () => ipcRenderer.invoke('probe:key'),
  readiness: (cameraLabel: string | null) => ipcRenderer.invoke('probe:readiness', cameraLabel),
  openLog: () => ipcRenderer.invoke('probe:openLog'),
  closeLog: () => ipcRenderer.invoke('probe:closeLog'),
  lines: (lines: string[]) => ipcRenderer.send('probe:lines', lines),
});
