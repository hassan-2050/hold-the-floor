// Demo mode: a prompter window docked above the app follows the screens,
// and recording starts at launch and writes a playable video file.
import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('demo mode: prompter follows the app and the recording is saved', async () => {
  test.setTimeout(90_000);
  const userData = mkdtempSync(join(tmpdir(), 'htf-e2e-'));
  const videos = mkdtempSync(join(tmpdir(), 'htf-demo-'));
  const app = await electron.launch({ args: ['out/main/index.js', 'demo'], env: { ...process.env, HTF_E2E_USERDATA: userData, HTF_DEMO_DIR: videos } });

  await expect.poll(() => app.windows().length, { timeout: 15_000 }).toBe(2);
  const byUrl = (part: string): Page => app.windows().find((w) => w.url().includes(part))!;
  await expect.poll(() => app.windows().some((w) => w.url().includes('prompter'))).toBe(true);
  const prompter = byUrl('prompter');
  const main = app.windows().find((w) => !w.url().includes('prompter'))!;

  await expect(prompter.getByText(/Part 1 of 7 · Welcome/)).toBeVisible({ timeout: 15_000 });
  await expect(prompter.getByText(/● REC/)).toBeVisible({ timeout: 15_000 });
  // The prompter is not part of the recorded page.
  await expect(main.getByText('Part 1 of 7')).toHaveCount(0);

  await main.getByRole('button', { name: /^Start/ }).click();
  await expect(prompter.getByText(/Part 2 of 7 · Consent/)).toBeVisible();
  await main.waitForTimeout(3000);

  await prompter.getByRole('button', { name: 'Stop recording' }).click();
  await expect(prompter.getByText(/^Saved/)).toBeVisible({ timeout: 15_000 });
  const files = readdirSync(videos);
  expect(files).toHaveLength(1);
  const file = join(videos, files[0]!);
  expect(statSync(file).size).toBeGreaterThan(20_000);
  const head = readFileSync(file).subarray(0, 12);
  const isMp4 = head.subarray(4, 8).toString('latin1') === 'ftyp';
  const isWebm = head.readUInt32BE(0) === 0x1a45dfa3;
  expect(isMp4 || isWebm).toBe(true);
  await expect(prompter.getByText(/Recording problem/)).toHaveCount(0);
  await app.close();
});
