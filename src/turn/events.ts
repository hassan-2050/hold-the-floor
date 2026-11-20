// Typed interfaces shared by the core (features, arbiter, shadow timers,
// results) and the UI. Pure types: no Electron, React or SDK.

/** The four camera cues that can hold the floor. */
export type CueName = 'lips' | 'head' | 'breath' | 'talking';
export const CUE_NAMES: readonly CueName[] = ['lips', 'head', 'breath', 'talking'];

/**
 * One cue's state.
 * - `on` / `off`: measured.
 * - `warming`: not ready yet (breath needs its ~30 s window to be stable).
 * - `unavailable`: cannot be measured right now (no face, quality bad,
 *   turned off in settings). Never filled in with a guess.
 */
export type CueStatus = 'on' | 'off' | 'warming' | 'unavailable';

export interface CueState {
  status: CueStatus;
  /** Short word for the cue light, e.g. "pressed", "set", "turned", "breathing in". */
  detail: string;
}

export type CueStates = Record<CueName, CueState>;

/** Lip sub-states reported by the lips extractor. */
export type LipShape = 'rest' | 'pressed' | 'set' | 'moving';

/**
 * Per-frame camera features, computed from one landmark set plus the
 * breathing/talking samples that arrived with it. Values are `null` when
 * they could not be measured; nothing is interpolated.
 */
export interface SignalFrame {
  /** Frame time (SDK timestamp), epoch ms. */
  tMs: number;
  /** When the app received it, epoch ms. Decisions use this time. */
  rxMs: number;
  /** Inner-lip aperture 13↔14 in IOD units. */
  aperture: number | null;
  /** Outer-lip height 0↔17 in IOD units. */
  lipHeight: number | null;
  /** Head yaw/pitch proxies: nose offset from eye midpoint, IOD units. */
  noseDx: number | null;
  noseDy: number | null;
  /** IOD in pixels (diagnostic). */
  iodPx: number | null;
  /** Landmark set flagged stable and not reset. */
  landmarksValid: boolean;
}

/** Why the camera cues are paused. */
export type QualityReason =
  | 'validation'
  | 'no-face'
  | 'multiple-faces'
  | 'face-lost'
  | 'landmarks-reset'
  | 'low-frame-rate'
  | 'sdk-error'
  | 'not-started';

export interface Quality {
  /** True when camera cues may drive the arbiter. */
  ok: boolean;
  reason: QualityReason | null;
  /** Plain-language hint for the banner (SDK hint text when there is one). */
  hint: string;
  /** Latest validation code from the SDK, or null before the first one. */
  validationCode: number | null;
  /** Measured landmark sets per second over the last second. */
  landmarkHz: number;
  /** Breathing traces are stable (confidence ≥ 45, from the SDK). */
  breathingStable: boolean;
}

export type ArbiterState = 'WAITING' | 'LISTENING' | 'CANDIDATE_END' | 'HOLDING' | 'END_OF_TURN' | 'AGENT';

/** Policy names: the live arbiter, the fallback timer, and shadow timers. */
export type PolicyName = 'hold-the-floor' | 'fallback-timer' | 'oracle' | `fixed-${number}`;

export type EndReason = 'cues-relaxed' | 'no-cue' | 'hard-cap' | 'send' | 'fallback-timer' | 'oracle';

export type TurnEvent =
  | { type: 'turn.hold'; t: number; cue: CueName; detail: string }
  | { type: 'turn.end'; t: number; reason: EndReason; policy: PolicyName; silenceMs: number; turn: number }
  | { type: 'turn.resume'; t: number }
  | { type: 'quality.fallback'; t: number; reason: QualityReason; hint: string }
  | { type: 'quality.restored'; t: number }
  | { type: 'shadow.end'; t: number; policy: PolicyName; turn: number }
  | { type: 'shadow.cutoff'; t: number; policy: PolicyName; turn: number }
  | { type: 'user.not-done'; t: number; turn: number };

/** Microphone voice-activity edge from the loudness detector. */
export interface MicEdge {
  kind: 'speech-start' | 'speech-end';
  /** Edge time (start of the qualifying run), epoch ms. */
  t: number;
}
