// The web replay page (npm run build:web): the renderer in a plain browser
// window with no desktop bridge and no SmartSpectra code, replaying the
// bundled demo session from a static server.
import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist', 'web');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.jsonl': 'text/plain',
};

test('web replay page: plays the demo session with no desktop app', async () => {
  test.setTimeout(120_000);
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.web.config.mts', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
  // No SmartSpectra code may be shipped to the web.
  const js = await readFile(join(DIST, 'index.html'), 'utf8');
  expect(js).toContain('Content-Security-Policy');

  const server = createServer((req, res) => {
    const file = resolve(DIST, `.${decodeURIComponent((req.url ?? '/').split('?')[0]!)}`);
    const path = file.endsWith(sep) || file === DIST ? join(DIST, 'index.html') : file;
    if (!path.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    readFile(path)
      .then((body) => res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body))
      .catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const app = await electron.launch({ args: ['tests/e2e/web-host.mjs'], env: { ...process.env, HTF_WEB_URL: `http://127.0.0.1:${port}/` } });
  try {
    const win = await app.firstWindow();
    const errors: string[] = [];
    win.on('pageerror', (e) => errors.push(e.message));
    await expect(win.getByRole('heading', { name: /not finished yet/ })).toBeVisible({ timeout: 20_000 });
    // No live path on the web; the repo link is there instead.
    await expect(win.getByRole('button', { name: /^Start/ })).toHaveCount(0);
    await expect(win.getByRole('link', { name: /code and setup on GitHub/ })).toBeVisible();
    await win.getByRole('button', { name: /Watch replay/ }).click();
    await expect(win.getByText(/REPLAY - recorded numbers/)).toBeVisible();
    await expect(win.locator('.question')).toContainText(/Tell me about a place you like/, { timeout: 15_000 });
    await expect(win.getByText(/Fixed 2.0 s timer/)).toBeVisible();
    await win.getByRole('button', { name: /Stop replay and see results/ }).click();
    await expect(win.getByRole('heading', { name: 'Results' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    server.close();
  }
});
