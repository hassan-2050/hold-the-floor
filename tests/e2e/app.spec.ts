// End-to-end tests on the built app (npm run test:e2e). No camera, no key:
// replay mode and the send-only path. Each test uses a throwaway data folder.
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function launch(args: string[] = []): Promise<{ app: ElectronApplication; win: Page; userData: string; errors: string[] }> {
  const userData = mkdtempSync(join(tmpdir(), 'htf-e2e-'));
  const app = await electron.launch({ args: ['out/main/index.js', ...args], env: { ...process.env, HTF_E2E_USERDATA: userData } });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await win.waitForSelector('h1, .stage', { timeout: 20_000 });
  return { app, win, userData, errors };
}

test('judges without a key: --replay plays the bundled recording through the engine', async () => {
  const { app, win, errors } = await launch(['--replay']);
  await expect(win.getByText('REPLAY - recorded numbers, not live')).toBeVisible();
  // Playback starts just before the first counting cycle.
  await expect(win.locator('.question')).toContainText(/Tell me about a place you like|Counting aloud|Pause|Calibration/, { timeout: 10_000 });
  // Replays open with the side-by-side comparison.
  await expect(win.getByText(/Fixed 2.0 s timer/)).toBeVisible();
  await expect(win.locator('.ribbon canvas')).toBeVisible();
  // Cue lights are measured (not "calibrating") after the replayed calibration.
  await expect(win.getByRole('status', { name: /^Lips: (relaxed|moving|pressed|set|rest)/ })).toBeVisible({ timeout: 10_000 });
  await win.waitForTimeout(8000);
  await win.getByRole('button', { name: /Stop replay and see results/ }).click();
  await expect(win.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(win.locator('table')).toContainText('2.0 s timer');
  expect(errors).toEqual([]);
  await app.close();
});

test('keyboard-only: consent → setup → conversation with Enter to send → results', async () => {
  const { app, win } = await launch();
  // Welcome: Start has focus.
  await win.keyboard.press('Enter');
  await expect(win.getByRole('heading', { name: 'Before we start' })).toBeVisible();
  // Decline both: send-only conversation (no camera, no mic in CI).
  const decline = win.getByRole('button', { name: /Decline both/ });
  await decline.focus();
  await win.keyboard.press('Enter');
  await expect(win.getByRole('heading', { name: 'Setup' })).toBeVisible();
  await win.getByRole('button', { name: /^Continue/ }).focus();
  await win.keyboard.press('Enter');
  await expect(win.locator('.question')).toContainText('Tell me about a place you like.');
  // Wait for the (silent) agent to finish, then Enter sends.
  await expect(win.getByRole('button', { name: /^Send/ })).toBeEnabled({ timeout: 10_000 });
  await win.locator('body').focus();
  await win.keyboard.press('Enter');
  await expect(win.locator('.question')).toContainText('What do you usually see on the way', { timeout: 10_000 });
  await expect(win.getByRole('button', { name: /^Send/ })).toBeEnabled({ timeout: 10_000 });
  await win.keyboard.press('Enter');
  await expect(win.locator('.question')).toContainText('Describe a room', { timeout: 10_000 });
  await win.getByRole('button', { name: /End and see results/ }).focus();
  await win.keyboard.press('Enter');
  await expect(win.getByRole('heading', { name: 'Results' })).toBeVisible();
  await expect(win.locator('table tr.us')).toContainText('Hold the Floor');
  await app.close();
});

test('settings sheet opens from the gear and closes with Esc', async () => {
  const { app, win } = await launch();
  await win.getByRole('button', { name: 'Settings' }).click();
  await expect(win.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await win.getByLabel(/Side-by-side comparison/).check();
  await win.keyboard.press('Escape');
  await expect(win.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  const saved = await win.evaluate(() => window.htf.getSettings());
  expect(saved.comparison).toBe(true);
  await app.close();
});

test('Delete all empties the sessions folder', async () => {
  const { app, win, userData } = await launch();
  await win.evaluate(async () => {
    const line = JSON.stringify({ k: 'hdr', v: 1, app: 'hold-the-floor', created: 'x', oracle: false, micEnabled: true, cameraEnabled: true });
    await window.htf.saveSession('one', line + '\n' + JSON.stringify({ k: 'a', t: 1, db: -50 }) + '\n');
    await window.htf.saveSession('two', line + '\n');
  });
  expect(readdirSync(join(userData, 'sessions')).length).toBe(2);
  // Saving anything that is not numbers-only recording lines is refused.
  const refused = await win.evaluate(() => window.htf.saveSession('bad', 'not json\n').then(() => false).catch(() => true));
  expect(refused).toBe(true);
  await win.getByRole('button', { name: /Privacy/ }).click();
  await win.getByRole('button', { name: /Delete all sessions/ }).click();
  await win.getByRole('button', { name: /Yes, delete all/ }).click();
  await expect(win.getByText(/Deleted 2 saved sessions/)).toBeVisible();
  expect(readdirSync(join(userData, 'sessions'))).toEqual([]);
  await app.close();
});

test('the API key is encrypted at rest and never in renderer storage', async () => {
  const { app, win, userData } = await launch();
  const KEY = 'test-key-1234567890abcdef';
  const r = await win.evaluate((k) => window.htf.setKey(k), KEY);
  if (!r.ok) test.skip(true, `safeStorage unavailable here: ${r.error}`);
  const file = join(userData, 'secrets', 'api-key.bin');
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file).includes(Buffer.from(KEY))).toBe(false);
  const leaked = await win.evaluate(async (k) => {
    const ls = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    const dbs = (await indexedDB.databases?.()) ?? [];
    return ls.includes(k) || dbs.length > 0;
  }, KEY);
  expect(leaked).toBe(false);
  await win.evaluate(() => window.htf.clearKey());
  expect(existsSync(file)).toBe(false);
  await app.close();
});

test('reduced motion: transitions are off', async () => {
  const { app, win } = await launch();
  await win.emulateMedia({ reducedMotion: 'reduce' });
  const t = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t').trim());
  expect(t).toBe('0ms');
  await app.close();
});

test('end_of_turn WebSocket: localhost only, token required, events delivered', async () => {
  const { default: WebSocket } = await import('ws');
  const { app, win } = await launch();
  const st = await win.evaluate(() => window.htf.wsStart());
  expect(st.running).toBe(true);
  // Wrong token is refused.
  const bad = await new Promise<string>((resolve) => {
    const s = new WebSocket(`ws://127.0.0.1:${st.port}/?token=nope`);
    s.on('error', () => resolve('refused'));
    s.on('open', () => resolve('opened'));
  });
  expect(bad).toBe('refused');
  // Right token: hello, then a forwarded turn event; unknown types are dropped.
  const got: { type: string }[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${st.port}/?token=${st.token}`);
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on('open', r));
  await win.evaluate(() => {
    window.htf.wsSend({ type: 'camera.frame', data: 'x' });
    window.htf.wsSend({ type: 'turn.end', t: 1, reason: 'cues-relaxed', policy: 'hold-the-floor', silenceMs: 700, turn: 1 });
  });
  await expect.poll(() => got.map((g) => g.type)).toEqual(['hello', 'turn.end']);
  ws.close();
  await win.evaluate(() => window.htf.wsStop());
  await app.close();
});
