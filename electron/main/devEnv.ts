// Reads SMARTSPECTRA_API_KEY from a git-ignored .env next to package.json.
// Development convenience only; the product stores keys with safeStorage.
// The key is never logged.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

/**
 * The folder holding package.json. app.getAppPath() is the script's folder
 * (out/main) when launched as `electron out/main/x.js`, so walk up.
 */
export function projectRoot(): string {
  let dir = app.getAppPath();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return app.getAppPath();
}

export function readDevApiKey(): string | null {
  const fromEnv = process.env.SMARTSPECTRA_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (app.isPackaged) return null;
  try {
    const text = readFileSync(join(projectRoot(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*SMARTSPECTRA_API_KEY\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1]) {
        const v = m[1].replace(/^["']|["']$/g, '').trim();
        if (v) return v;
      }
    }
  } catch {
    // no .env: fine
  }
  return null;
}
