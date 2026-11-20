// Settings and saved sessions in the app data folder.
//   <userData>/settings.json
//   <userData>/sessions/<id>.jsonl   numbers-only recordings, saved on request
import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sanitizeSettings, type Settings } from '../../src/shared/settings';
import type { SessionInfo } from '../../src/shared/bridge';
import { projectRoot } from './devEnv';

export const sessionsDir = (): string => join(app.getPath('userData'), 'sessions');
const settingsFile = (): string => join(app.getPath('userData'), 'settings.json');

export function readSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(settingsFile(), 'utf8')));
  } catch {
    return sanitizeSettings({});
  }
}

export function writeSettings(s: Settings): Settings {
  const clean = sanitizeSettings(s);
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(clean, null, 2));
  return clean;
}

const ID_RE = /^[a-z0-9-]{8,64}$/;

/** Saved recordings must be numbers-only JSON lines of known kinds. */
function validateRecording(jsonl: string): boolean {
  const kinds = new Set(['hdr', 'm', 'v', 'e', 'sdk', 'a', 'agent', 'cal', 'act']);
  for (const line of jsonl.split('\n')) {
    if (!line) continue;
    let o: { k?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      return false;
    }
    if (typeof o.k !== 'string' || !kinds.has(o.k)) return false;
  }
  return true;
}

export function saveSession(name: string, jsonl: string): SessionInfo {
  if (!validateRecording(jsonl)) throw new Error('Recording rejected: unexpected content.');
  mkdirSync(sessionsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').toLowerCase();
  const id = `${stamp}-${randomBytes(3).toString('hex')}`;
  const safeName = name.replace(/[^\p{L}\p{N} .,'-]/gu, '').slice(0, 80) || 'Session';
  const header = JSON.stringify({ k: 'meta', name: safeName });
  writeFileSync(join(sessionsDir(), `${id}.jsonl`), `${header}\n${jsonl}`);
  return { id, name: safeName, created: new Date().toISOString(), bytes: jsonl.length };
}

export function listSessions(): SessionInfo[] {
  if (!existsSync(sessionsDir())) return [];
  return readdirSync(sessionsDir())
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const p = join(sessionsDir(), f);
      const st = statSync(p);
      let name = 'Session';
      try {
        const first = readFileSync(p, 'utf8').split('\n', 1)[0] ?? '';
        const meta = JSON.parse(first) as { k?: string; name?: string };
        if (meta.k === 'meta' && meta.name) name = meta.name;
      } catch {
        /* keep default name */
      }
      return { id: f.slice(0, -6), name, created: st.birthtime.toISOString(), bytes: st.size };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function readSession(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  const p = join(sessionsDir(), `${id}.jsonl`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

export function deleteSession(id: string): void {
  if (!ID_RE.test(id)) return;
  rmSync(join(sessionsDir(), `${id}.jsonl`), { force: true });
}

/** Deletes every saved session and returns how many were removed. */
export function deleteAllSessions(): number {
  if (!existsSync(sessionsDir())) return 0;
  const files = readdirSync(sessionsDir());
  rmSync(sessionsDir(), { recursive: true, force: true });
  mkdirSync(sessionsDir(), { recursive: true });
  return files.filter((f) => f.endsWith('.jsonl')).length;
}

// ---- bundled fixtures (judges can replay without a key) ------------------
const fixturesDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'fixtures', 'sessions') : join(projectRoot(), 'fixtures', 'sessions');

export function listFixtures(): { id: string; label: string }[] {
  if (!existsSync(fixturesDir())) return [];
  return readdirSync(fixturesDir())
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => {
      let label = f;
      try {
        const hdr = JSON.parse(readFileSync(join(fixturesDir(), f), 'utf8').split('\n', 1)[0] ?? '{}') as { settings?: { label?: string } };
        label = hdr.settings?.label ?? f;
      } catch {
        /* keep file name */
      }
      return { id: f.slice(0, -6), label };
    });
}

export function readFixture(id: string): string | null {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return null;
  const p = join(fixturesDir(), `${id}.jsonl`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
