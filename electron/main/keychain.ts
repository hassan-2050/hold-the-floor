// API key storage with Electron safeStorage (OS keychain / DPAPI /
// libsecret), using the async API (the sync one is deprecated in Electron
// 45). The key lives only here and in the SDK constructor call; it is never
// logged or written in plain text.
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = (): string => join(app.getPath('userData'), 'secrets');
const file = (): string => join(dir(), 'api-key.bin');

export function hasKey(): boolean {
  return existsSync(file());
}

async function write(k: string): Promise<void> {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(file(), await safeStorage.encryptStringAsync(k), { mode: 0o600 });
}

export async function setKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const k = key.trim();
  if (!k || k.length > 1024 || /\s/.test(k)) return { ok: false, error: 'That does not look like an API key.' };
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    return { ok: false, error: 'Secure storage is not available on this system, so the key cannot be saved.' };
  }
  await write(k);
  return { ok: true };
}

export async function getKey(): Promise<string | null> {
  if (!hasKey()) return null;
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(readFileSync(file()));
    if (shouldReEncrypt) await write(result);
    return result;
  } catch {
    return null;
  }
}

export function clearKey(): void {
  rmSync(file(), { force: true });
}
