// SmartSpectra error codes (SDK 3.5.0 typings) mapped to plain sentences
// with an action. Every code leaves the app usable: camera cues pause and
// the fixed timer takes over. Pure: no SDK import.

export type ErrorAction = 'retry' | 'restart' | 'setup' | 'continue';

export interface ErrorInfo {
  title: string;
  message: string;
  action: ErrorAction;
  actionLabel: string;
  /** May the app reset + start once on its own? (plan: retryable → once) */
  autoRetry: boolean;
}

const CONTINUE = 'Your answers still work with the fixed timer.';

export const ERROR_INFO: Readonly<Record<number, ErrorInfo>> = {
  1: { title: 'Camera cues stopped', message: `SmartSpectra was not ready for that step. ${CONTINUE}`, action: 'restart', actionLabel: 'Restart camera', autoRetry: true },
  2: { title: 'API key not accepted', message: `SmartSpectra did not accept the API key. Check it in Setup. ${CONTINUE}`, action: 'setup', actionLabel: 'Open Setup', autoRetry: false },
  3: { title: 'Camera cues could not start', message: `SmartSpectra could not start with these settings. ${CONTINUE}`, action: 'restart', actionLabel: 'Try again', autoRetry: false },
  4: { title: 'Measurement credits used up', message: `Your SmartSpectra trial has no credits left, so camera cues are off. ${CONTINUE} You can also watch the recorded replay.`, action: 'continue', actionLabel: 'Continue without camera', autoRetry: false },
  5: { title: 'No connection to SmartSpectra', message: `SmartSpectra checks its licence online and could not reach the service. ${CONTINUE}`, action: 'retry', actionLabel: 'Retry camera', autoRetry: true },
  6: { title: 'SmartSpectra service error', message: `The SmartSpectra service had a problem. ${CONTINUE}`, action: 'retry', actionLabel: 'Retry camera', autoRetry: true },
  7: { title: 'Camera not available', message: `The camera stopped or is used by another app. ${CONTINUE}`, action: 'retry', actionLabel: 'Retry camera', autoRetry: false },
  8: { title: 'Camera cues stopped', message: `SmartSpectra stopped processing. ${CONTINUE}`, action: 'retry', actionLabel: 'Retry camera', autoRetry: true },
  9: { title: 'Camera format not supported', message: `SmartSpectra could not read frames from this camera. Try another camera. ${CONTINUE}`, action: 'setup', actionLabel: 'Choose camera', autoRetry: false },
  10: { title: 'Camera timing problem', message: `Frames arrived out of order. ${CONTINUE}`, action: 'restart', actionLabel: 'Restart camera', autoRetry: true },
  11: { title: 'Camera paused', message: `Frames stopped for a moment. ${CONTINUE}`, action: 'restart', actionLabel: 'Restart camera', autoRetry: true },
  13: { title: 'Metric not allowed for this key', message: `This API key cannot request the lip, head or breathing data the app needs. ${CONTINUE}`, action: 'continue', actionLabel: 'Continue without camera', autoRetry: false },
  14: { title: 'Camera too slow', message: `SmartSpectra stopped because the frame rate stayed too low. More light in front of you helps, or choose the smaller camera size in Settings. ${CONTINUE}`, action: 'restart', actionLabel: 'Start camera again', autoRetry: false },
};

export function errorInfo(code: number | string, message?: string): ErrorInfo {
  if (code === 'SMARTSPECTRA_IPC_TIMEOUT') {
    return { title: 'SmartSpectra is not responding', message: `The measurement process stopped answering. ${CONTINUE}`, action: 'restart', actionLabel: 'Restart camera', autoRetry: false };
  }
  const known = typeof code === 'number' ? ERROR_INFO[code] : undefined;
  return known ?? { title: 'Camera cues stopped', message: `${message ? `${message}. ` : ''}${CONTINUE}`, action: 'retry', actionLabel: 'Retry camera', autoRetry: false };
}

/** Readiness verdicts in words (verdict is a string; compare explicitly). */
export function readinessWords(verdict: string): { title: string; ok: boolean } {
  if (verdict === 'ready') return { title: 'Ready', ok: true };
  if (verdict === 'limited') return { title: 'Limited: it may work, with lower quality', ok: true };
  if (verdict === 'blocked') return { title: 'Not able to measure on this device', ok: false };
  return { title: 'Could not decide', ok: false };
}
