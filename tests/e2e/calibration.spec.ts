// The real Calibration screen, driven by recorded numbers instead of a
// camera: the bundled Stage 1 recording is fed in as if the SDK delivered it
// live (30 packets/s), then Begin is pressed. Lip and head cues must become
// ready after step 2, exactly as with a real camera.
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('calibration with live-shaped landmark packets makes lip and head cues ready', async () => {
  test.setTimeout(90_000);
  const userData = mkdtempSync(join(tmpdir(), 'htf-e2e-'));
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, HTF_E2E_USERDATA: userData } });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('h1');

  // Camera + mic consent, then straight to Calibration (Setup needs a real key).
  await win.evaluate(() => {
    const t = (window as unknown as { __htfTest: { store: { getState(): { set(p: unknown): void; go(s: string): void } } } }).__htfTest;
    t.store.getState().set({ consent: { camera: true, mic: true, given: true } });
    t.store.getState().go('calibration');
  });
  await expect(win.getByRole('button', { name: 'Begin' })).toBeVisible({ timeout: 20_000 });

  // Feed the recording as live packets (full 478-point arrays, subset filled).
  await win.evaluate(async () => {
    type Line = { k: string; lm?: { s: number; r: number; k: Record<string, [number, number]> }[]; c?: [number, number, number][]; tk?: [number, number, number][] };
    const t = (window as unknown as { __htfTest: { session: { testFeed(p: unknown): void; testSdkStarted(): void } } }).__htfTest;
    const text = (await window.htf.readFixture('probe-protocol'))!;
    const lines = text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Line)
      .filter((l) => l.k === 'm' && l.lm && l.lm.length);
    t.session.testSdkStarted();
    let i = 0;
    (window as unknown as { __feed: number }).__feed = window.setInterval(() => {
      const l = lines[i++ % lines.length]!;
      const now = performance.timeOrigin + performance.now();
      const xy = new Array<number>(478 * 2).fill(NaN);
      for (const [k, v] of Object.entries(l.lm![0]!.k)) {
        xy[2 * Number(k)] = v[0];
        xy[2 * Number(k) + 1] = v[1];
      }
      t.session.testFeed({
        rxMs: now,
        packetTsUs: now * 1000,
        chest: (l.c ?? []).map((c) => ({ v: c[0], stable: c[1] === 1, tUs: now * 1000 })),
        abdomen: [],
        rate: [],
        talking: (l.tk ?? []).map((x) => ({ detected: x[0] === 1, stable: true, tUs: now * 1000 })),
        landmarks: [{ xy, stable: l.lm![0]!.s === 1, reset: false, tUs: now * 1000 }],
      });
    }, 33);
  });

  await expect(win.getByText(/Face:\s*tracked/)).toBeVisible({ timeout: 10_000 });
  // Before Begin the lights already show the face is seen.
  await expect(win.getByRole('status', { name: /^Lips: seen/ })).toBeVisible({ timeout: 10_000 });
  await expect(win.getByRole('status', { name: /^Head: seen/ })).toBeVisible({ timeout: 10_000 });
  await win.getByRole('button', { name: 'Begin' }).click();
  await expect(win.getByRole('status', { name: /^Lips: learning/ })).toBeVisible({ timeout: 5_000 });
  // Rest 10 s + press 5 s, then the warm-up question.
  await expect(win.getByText('To warm up: tell me what you did this morning.')).toBeVisible({ timeout: 25_000 });
  await expect(win.getByRole('status', { name: /^Lips: (relaxed|moving|pressed|set|rest)/ })).toBeVisible({ timeout: 5_000 });
  await expect(win.getByRole('status', { name: /^Head: (forward|turned)/ })).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});
