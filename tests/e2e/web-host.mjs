// Test helper: open HTF_WEB_URL in a plain Electron window with no preload,
// the way a browser would load the web replay page.
import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800, webPreferences: { contextIsolation: true, sandbox: true } });
  void win.loadURL(process.env.HTF_WEB_URL ?? 'about:blank');
});
app.on('window-all-closed', () => app.quit());
