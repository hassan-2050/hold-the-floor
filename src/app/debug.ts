// Opt-in debug log (start the app with --htf-debug, or `npm run start:debug`).
// Sends event names, codes, counts and timings to the main process, which
// writes them to <app data>/debug.log. Never landmarks, audio or the key.

let enabled = false;

export function setDebug(on: boolean): void {
  enabled = on;
}

export function dbgEnabled(): boolean {
  return enabled;
}

export function dbg(ev: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  try {
    window.htf.debug(ev, data);
  } catch {
    /* logging must never break the app */
  }
}

export const r1 = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
export const r3 = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
