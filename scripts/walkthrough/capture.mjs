// Walkthrough video, step 1: capture the bundled replay.
//
// Launches the built app with a throwaway data folder, shows the Welcome
// screen, plays the bundled replay (fixtures/sessions/demo-session.jsonl) and
// scrolls the Results screen. Only the app page itself is recorded, through
// the DevTools screencast: no screen recording, no prompter or recorder
// window, no mouse pointer. The window goes full screen and the page is
// zoomed so it lays out at 1280x720 CSS px: on a 1920x1080 screen the frames
// are 1920x1080, rendered at 1.5x detail.
//
//   npm run build
//   node scripts/walkthrough/capture.mjs <out-dir>
//
// Writes <out-dir>/frames/*.jpg, frames.json (frame swap times), marks.json
// and events.jsonl (the app's own debug log for the run: event names and
// timings, no landmarks).
import { _electron as electron } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const out = resolve(process.argv[2] ?? 'walkthrough-capture');
rmSync(join(out, 'frames'), { recursive: true, force: true });
mkdirSync(join(out, 'frames'), { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'htf-walk-'));

const app = await electron.launch({ args: ['out/main/index.js', '--htf-debug'], env: { ...process.env, HTF_E2E_USERDATA: userData } });
const win = await app.firstWindow();
await win.waitForSelector('h1', { timeout: 20_000 });
// Full screen, on top and unthrottled while recording.
const display = await app.evaluate(({ BrowserWindow, screen }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setAlwaysOnTop(true);
  w.setFullScreen(true);
  w.webContents.setBackgroundThrottling(false);
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width, height: d.size.height, scale: d.scaleFactor };
});
await sleep(1500);
await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), display.width / 1280);
await sleep(500);
const viewport = await win.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
console.log(`display ${JSON.stringify(display)}; page viewport ${viewport.join(' x ')} (css px, dpr)`);

// Capture only: a 1 px, near-transparent dot that changes every frame. The
// screencast sends a frame only after the previous one is acknowledged, so a
// single repaint (a static screen appearing) can be dropped; a steady stream
// of frames keeps the latest screen in the recording.
await win.evaluate(() => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647';
  document.body.appendChild(dot);
  let on = false;
  const step = () => {
    on = !on;
    dot.style.background = on ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.03)';
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

const cdp = await win.context().newCDPSession(win);

const frames = [];
const marks = {};
const mark = (name) => {
  marks[name] = Date.now();
  console.log(`${name} at ${new Date(marks[name]).toISOString()} (${frames.length} frames)`);
};
cdp.on('Page.screencastFrame', (f) => {
  const i = frames.length;
  frames.push({ i, ts: f.metadata.timestamp ?? Date.now() / 1000 });
  writeFileSync(join(out, 'frames', `${String(i).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64'));
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });

mark('welcome');
await sleep(12_000);
const replayButton = win.getByRole('button', { name: /Watch replay/ });
await replayButton.focus();
await sleep(1200);
mark('replay-click');
await replayButton.click();
await win.getByRole('heading', { name: 'Results' }).waitFor({ timeout: 180_000 });
mark('results');
await sleep(7000);

// Scroll the Results screen smoothly (2 s, eased) to the table and chart.
mark('results-scroll');
await win.evaluate(async () => {
  const scrollers = [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
  const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? document.scrollingElement;
  const table = document.querySelector('table');
  if (!table) return;
  const from = scroller.scrollTop;
  const to = Math.max(0, from + table.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24);
  const t0 = performance.now();
  await new Promise((done) => {
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 2000);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      scroller.scrollTop = from + (to - from) * e;
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
});
mark('results-table');
await sleep(12_000);
mark('end');

await cdp.send('Page.stopScreencast');
await sleep(300);
writeFileSync(join(out, 'frames.json'), JSON.stringify(frames));
writeFileSync(join(out, 'marks.json'), JSON.stringify(marks, null, 2));
try {
  copyFileSync(join(userData, 'debug.log'), join(out, 'events.jsonl'));
} catch {
  console.log('no debug log found');
}
await app.close();
rmSync(userData, { recursive: true, force: true });
console.log(`captured ${frames.length} frames to ${out}`);
