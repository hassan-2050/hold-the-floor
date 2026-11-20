// User settings, persisted by the main process as JSON in the app data
// folder. Shared by main and renderer; no imports.

export type QuestionSetId = 'places' | 'everyday' | 'work';
export type CaptureSize = '1280x720' | '960x540';

export interface Settings {
  /** Silence before a turn end is considered (300-600 ms). */
  candidateSilenceMs: number;
  /** Longest hold (4-15 s). */
  hardCapMs: number;
  /** Fixed timer used while camera cues are paused (0.7-5 s). */
  fallbackTimerMs: number;
  cues: { lips: boolean; head: boolean; breath: boolean; talking: boolean };
  /** OS voice name (speechSynthesis), or null for the default. */
  voiceName: string | null;
  /** Speech rate 0.7-1.3. */
  voiceRate: number;
  questionSet: QuestionSetId;
  /** Show the side-by-side comparison with the 2.0 s timer. */
  comparison: boolean;
  /** Oracle test mode: the agent waits for Space. */
  oracle: boolean;
  /** Local end_of_turn WebSocket API. */
  websocket: boolean;
  cameraId: string | null;
  micId: string | null;
  captureSize: CaptureSize;
  noiseSuppression: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  candidateSilenceMs: 400,
  hardCapMs: 8000,
  fallbackTimerMs: 2000,
  cues: { lips: true, head: true, breath: true, talking: true },
  voiceName: null,
  voiceRate: 1,
  questionSet: 'places',
  comparison: false,
  oracle: false,
  websocket: false,
  cameraId: null,
  micId: null,
  captureSize: '1280x720',
  noiseSuppression: false,
};

const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Accepts anything (e.g. an old or edited settings file) and returns valid settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings> & Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const cues = (r.cues && typeof r.cues === 'object' ? r.cues : {}) as Partial<Settings['cues']>;
  const bool = (v: unknown, dv: boolean): boolean => (typeof v === 'boolean' ? v : dv);
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length < 512 ? v : null);
  return {
    candidateSilenceMs: clamp(r.candidateSilenceMs, 300, 600, d.candidateSilenceMs),
    hardCapMs: clamp(r.hardCapMs, 4000, 15000, d.hardCapMs),
    fallbackTimerMs: clamp(r.fallbackTimerMs, 700, 5000, d.fallbackTimerMs),
    cues: {
      lips: bool(cues.lips, true),
      head: bool(cues.head, true),
      breath: bool(cues.breath, true),
      talking: bool(cues.talking, true),
    },
    voiceName: str(r.voiceName),
    voiceRate: clamp(r.voiceRate, 0.7, 1.3, d.voiceRate),
    questionSet: r.questionSet === 'everyday' || r.questionSet === 'work' ? r.questionSet : 'places',
    comparison: bool(r.comparison, d.comparison),
    oracle: bool(r.oracle, d.oracle),
    websocket: bool(r.websocket, d.websocket),
    cameraId: str(r.cameraId),
    micId: str(r.micId),
    captureSize: r.captureSize === '960x540' ? '960x540' : '1280x720',
    noiseSuppression: bool(r.noiseSuppression, d.noiseSuppression),
  };
}
