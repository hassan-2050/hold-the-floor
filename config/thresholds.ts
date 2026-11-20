// Every tunable number in Hold the Floor, with the reason for its value.
// "Plan" = PLAN.md / AGENT_PROMPT.md section 6. "Stage 1" = probe runs on
// 20 Nov 2026 (docs/SDK-NOTES.md). Times are milliseconds unless noted.
// Lip and head distances are in inter-ocular distance (IOD) units: the
// pixel distance between landmarks 33 and 263, so they don't change with
// how far you sit from the camera.

export const THRESHOLDS = {
  // ---- Microphone loudness detector -----------------------------------
  mic: {
    /** Loudness window produced by the AudioWorklet. Plan. */
    windowMs: 20,
    /** Silence used to measure the noise floor during calibration. Plan: 3 s. */
    floorCalibrationMs: 3000,
    /** Speech = above floor + this. Plan: +12 dB. */
    speechAboveFloorDb: 12,
    /**
     * If the measured speech margin (speech p90 − floor) is small, use this
     * fraction of it instead of the fixed 12 dB. Stage 1 run 1 measured a
     * margin of only 10 dB on a laptop mic, which would have missed most
     * speech at +12 dB.
     */
    adaptiveFraction: 0.5,
    /** Never treat anything closer than this to the floor as speech. */
    minSpeechAboveFloorDb: 6,
    /** Silence = below floor + this. Plan: +6 dB (hysteresis below speech). */
    silenceAboveFloorDb: 6,
    /** Loud this long before it counts as speech. Plan. */
    speechMinMs: 60,
    /** Quiet this long before it counts as silence. Plan. */
    silenceMinMs: 150,
    /** Ignore the mic while the agent speaks and this long after. Plan. */
    halfDuplexTailMs: 200,
    /** Fallback floor if calibration was skipped (typical laptop room, Stage 1). */
    defaultFloorDb: -60,
  },

  // ---- Turn arbiter ------------------------------------------------------
  arbiter: {
    /** Silence before a turn end is considered. Plan: 400 ms, range 300-600. */
    candidateSilenceMs: 400,
    candidateSilenceRange: [300, 600] as const,
    /** A cue must be continuously true this long to start a hold. Plan. */
    cueEngageMs: 120,
    /** No cue for this long ends the turn. Plan. */
    releaseMs: 300,
    /** Longest silence a hold may last. Plan: 8 s, range 4-15 s. */
    hardCapMs: 8000,
    hardCapRange: [4000, 15000] as const,
    /** Head turned away may hold on its own for at most this long. Plan. */
    headOnlyMaxMs: 2500,
    /**
     * Breathing in may hold on its own for at most this long per silence.
     * Not in the plan: Stage 1 showed ordinary resting inhales also pass the
     * 0.35 amplitude/s slope, so an inhale after a finished answer would
     * otherwise delay every reply. Breath stays a supporting cue (plan
     * decision point 1): it can bridge a short "pause to breathe" and extend
     * a hold that lips, talking or head started, without limit.
     */
    breathOnlyMaxMs: 1500,
    /** Fixed silence timer used while camera cues are paused. Plan: 2.0 s. */
    fallbackTimerMs: 2000,
    fallbackTimerRange: [700, 5000] as const,
  },

  // ---- Shadow timers and cut-offs -----------------------------------------
  shadow: {
    /** Fixed timers that run on the same input and never drive the agent. Plan. */
    policiesMs: [700, 2000, 3000, 4000] as const,
    /** A policy "cut off" the user if speech resumed within this time of its end. Plan. */
    cutOffResumeMs: 2500,
  },

  // ---- Lips (landmarks 13/14 inner, 0/17 outer) -----------------------------
  lips: {
    /** Baseline = median; spread = MAD. Plan: thresholds at 3 MAD. */
    madK: 3,
    /**
     * Minimum margin for "set" (lips parted, silent) above the rest aperture.
     * Stage 1: closed lips at rest measure exactly 0 with MAD 0, so 3 MAD is
     * no margin at all. Run 2 "set" median was 0.097; 0.03 sits well between.
     */
    setMinMargin: 0.03,
    /** |d(aperture)/dt| below this (IOD/s) counts as "held still". */
    setStillRate: 0.25,
    /** The aperture must stay still and open this long. Plan: 250 ms. */
    setStillMs: 250,
    /**
     * Minimum margin for "pressed" below the rest outer height, so a near-zero
     * MAD cannot make the line touch the rest value. Kept small so the plan's
     * 3 MAD rule decides. The first value (0.03) was 15 MAD on a very steady
     * face (live demo run: rest 0.209, MAD 0.002) and missed a natural press
     * at 0.200; Stage 1 run 2 (MAD 0.0145) was unaffected either way.
     */
    pressMinMargin: 0.006,
    /**
     * With a calibrated "pressed" height, the press line sits this fraction
     * of the way from the pressed height up to rest (null = rest − 3 MAD
     * only). Anchoring on the user's own deliberate press separates it from
     * ordinary closed lips, which on the live demo runs sat between rest and
     * pressed. Chosen by replaying a saved live session (docs/RESULTS.md).
     */
    pressAnchor: 0.35 as number | null,
    /**
     * A calibrated press must sit at least this far below rest (IOD units) for
     * the pressed cue to be used. Live runs: firm presses were 0.054-0.084
     * below rest; a soft one (0.048) was indistinguishable from ordinary
     * closed lips after an answer and caused slow replies. Below this, the
     * pressed cue is off for the session and Calibration asks for a firmer
     * press.
     */
    pressMinDepth: 0.05,
    /**
     * Weight of the quiet-listening lip baseline against the calibration rest
     * step (1 = listening only). Live runs: lips while listening sat well
     * below the calibration rest (0.194 vs 0.223), so the conversation's own
     * rest is the better reference.
     */
    listenWeight: 0.5,
    /**
     * Visible talking: the inner aperture moved by at least this much (max −
     * min) within the window. Replaces the SDK talking flag as the fast cue;
     * Stage 1 found that flag true in 0% of frames while counting aloud.
     */
    movingRange: 0.04,
    movingWindowMs: 300,
  },

  // ---- Head pose (nose tip 1 vs eye corners 33/263) ----------------------
  head: {
    /** Turned beyond this from calibrated forward. Plan: 15°. */
    turnDeg: 15,
    /** For at least this long. Plan: 300 ms. */
    turnMinMs: 300,
    /**
     * Nose-tip depth in front of the eye-corner line, in IOD units, used to
     * convert the 2D nose offset to degrees: angle = atan(offset / depth).
     * Stage 1 run 2: an instructed right turn moved the offset by 0.107 IOD,
     * consistent with ~15° at depth 0.4 (anthropometric outer canthal width
     * ~9 cm, nose protrusion ~3.5 cm).
     */
    noseDepth: 0.4,
  },

  // ---- Breathing (chest trace = breathing.upperTrace) ----------------------
  breath: {
    /** Slope window. Plan: 400 ms. */
    slopeWindowMs: 400,
    /** Inhale = slope above this many resting-breath amplitudes per second. Plan. */
    inhaleAmpPerSec: 0.35,
    /**
     * Resting amplitude = p95 − p5 of the detrended trace over this window.
     * The same window's linear trend is the posture drift removed from the
     * short slope. A long window keeps the out-breath of the last sentence
     * from being mistaken for drift.
     */
    restWindowMs: 15000,
    /** Stage 1 run 2: the trace falls while speaking (out-breath); inhale = rising. */
    inhalePolarity: 1 as 1 | -1,
    /** Need this many samples in a slope window to compute a slope. */
    minSamples: 6,
  },

  // ---- SDK talking flag -------------------------------------------------
  talking: {
    /** talking.detected within this time counts as recent. Plan: 300 ms. */
    recentMs: 300,
    /**
     * Mouth movement counts as recent for this long. Shorter than the SDK
     * flag's 300 ms because "moving" already spans a 300 ms window; stacking
     * both added ~0.25 s to every reply in the synthetic tests.
     */
    mouthRecentMs: 100,
  },

  // ---- Quality gate --------------------------------------------------------
  quality: {
    /** Non-OK validation (or face lost) for longer than this → fixed timer. Plan: 1 s. */
    badForMs: 1000,
    /** OK for this long → cues restored. Plan: 1 s. */
    restoreAfterMs: 1000,
    /** No landmarks for this long = face lost. Plan: staleness 500 ms. */
    staleMs: 500,
    /**
     * Landmark rate below this (sets/s over the last second) counts as bad.
     * Plan said fps < 25. Stage 1: this webcam runs at ~25 fps and the SDK
     * reports kFrameRateTooLow often while landmarks stay complete and
     * timely, so the gate uses the measured rate with margin and treats
     * code 11 as a hint only.
     */
    minLandmarkHz: 15,
    /** Need at least this share of valid (stable, non-reset) sets in 500 ms. Plan: 80%. */
    minValidShare: 0.8,
    validShareWindowMs: 500,
  },

  // ---- Calibration ---------------------------------------------------------
  calibration: {
    /** Plan: 10 s relaxed and silent (lip rest, head forward, noise floor). */
    restMs: 10000,
    /** Plan: 5 s lips gently pressed. */
    pressMs: 5000,
    /** Plan: then one easy question until breathing is stable (~30 s window). */
    questionMaxMs: 45000,
    /**
     * Face frames needed in the rest step. Below minRestFrames there is no
     * baseline and the step must be repeated; below goodRestFrames (about
     * 15 per second) calibration continues with a "tracking was slow" note.
     * The first version required 60 frames in every step, which a camera
     * delivering ~10 landmark sets/s (Stage 1, dim light) can never reach in
     * the 5 s press step, so calibration looped forever.
     */
    minRestFrames: 20,
    goodRestFrames: 150,
    /** The press step is optional: below this, the per-user pressed height is skipped. */
    minPressFrames: 15,
    goodPressFrames: 75,
  },

  // ---- Camera ---------------------------------------------------------------
  camera: {
    width: 1280,
    height: 720,
    fps: 30,
    /** Plan: drop to this size when the frame rate is low. */
    fallbackWidth: 960,
    fallbackHeight: 540,
  },

  // ---- UI ---------------------------------------------------------------------
  ui: {
    /** Floor ribbon width in seconds. Plan. */
    ribbonSeconds: 20,
    /** Engine sample rate for the ribbon. */
    ribbonHz: 30,
    /** UI store refresh from the engine. Plan: 15 Hz. */
    storeHz: 15,
    /** At most one aria-live announcement per this interval. Plan: 2 s. */
    announceMinMs: 2000,
  },

  // ---- Replay -----------------------------------------------------------------
  replay: {
    /**
     * Recordings before format v2 stamped "agent speaking" when a question was
     * queued, not when the voice began. In the bundled demo the voice began
     * 331-481 ms after the stamp on all 7 questions (median 392 ms, measured
     * from the mic level). Replays of v1 files start the agent this long after
     * the stamp, just under the shortest measured delay. v2 files record the
     * real start and need no correction.
     */
    v1AgentStartDelayMs: 300,
  },

  // ---- Shutdown ---------------------------------------------------------------
  stop: {
    /** Camera off within this time of Stop/Esc/F8. Plan: 1 s. */
    budgetMs: 1000,
  },
} as const;

export type Thresholds = typeof THRESHOLDS;
