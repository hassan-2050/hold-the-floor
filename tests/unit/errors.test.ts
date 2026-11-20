import { describe, expect, it } from 'vitest';
import { errorInfo, readinessWords } from '../../src/sensing/errors';

// Every SmartSpectraErrorCode in the SDK 3.5.0 typings except kOk (0).
const CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14];

describe('SDK error mapping', () => {
  it.each(CODES)('code %i has a plain message, an action, and keeps the app usable', (code) => {
    const e = errorInfo(code);
    expect(e.title.length).toBeGreaterThan(5);
    expect(e.message).toMatch(/fixed timer/);
    expect(e.actionLabel.length).toBeGreaterThan(1);
    // No raw codes or SDK identifiers in user-facing text.
    expect(e.title + e.message).not.toMatch(/\bk[A-Z]\w+|code \d/);
  });

  it('unknown codes and IPC timeouts still give a usable message', () => {
    expect(errorInfo(99, 'odd').message).toMatch(/fixed timer/);
    expect(errorInfo('SMARTSPECTRA_IPC_TIMEOUT').title).toMatch(/not responding/);
  });

  it('low frame rate (14) waits for the user rather than restarting by itself', () => {
    expect(errorInfo(14).autoRetry).toBe(false);
  });

  it('readiness verdicts are compared as strings, never as booleans', () => {
    expect(readinessWords('ready').ok).toBe(true);
    expect(readinessWords('limited').ok).toBe(true);
    expect(readinessWords('blocked').ok).toBe(false);
    expect(readinessWords('inconclusive').ok).toBe(false);
  });
});
