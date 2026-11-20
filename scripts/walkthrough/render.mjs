// Walkthrough video: render HTML title cards and caption strips to PNG.
// One offscreen window (nothing is shown on screen), at device scale 1.
//   npx electron scripts/walkthrough/render.mjs <jobs.json>
// jobs.json: [{ "html": "<file>.html", "out": "<file>.png", "width": 1920, "height": 1080 }]
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

app.commandLine.appendSwitch('force-device-scale-factor', '1');

async function load(win, url) {
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadURL(url);
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

app.whenReady().then(async () => {
  try {
    const jobs = JSON.parse(readFileSync(process.argv.at(-1), 'utf8'));
    const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: { offscreen: true, webSecurity: false } });
    for (const job of jobs) {
      win.setContentSize(job.width, job.height);
      await load(win, pathToFileURL(job.html).href);
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
      const image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width !== job.width || size.height !== job.height) throw new Error(`${job.out}: got ${size.width}x${size.height}`);
      writeFileSync(job.out, image.toPNG());
    }
    win.destroy();
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
