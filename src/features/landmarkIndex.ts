// Landmark indices into the SDK's 478-point face set.
// Verified in Stage 1: the SDK uses MediaPipe Face Mesh order (all 9
// geometry checks passed on two runs). See docs/SDK-NOTES.md.
export const LM = {
  innerUpperLip: 13,
  innerLowerLip: 14,
  outerUpperLip: 0,
  outerLowerLip: 17,
  mouthCornerRight: 61, // subject's right; image left
  mouthCornerLeft: 291,
  eyeOuterRight: 33,
  eyeOuterLeft: 263,
  noseTip: 1,
} as const;

/**
 * The only landmarks the app keeps in recordings: the extractors' inputs
 * plus a few neighbours used to sanity-check the ordering. The full set is
 * never saved. Same list as the Stage 1 probe, so probe logs replay.
 */
export const RECORDED_LANDMARKS: readonly number[] = [
  0, 1, 4, 6, 10, 13, 14, 17, 33, 61, 78, 82, 87, 133, 145, 152, 159, 168, 263, 291, 308, 312, 317, 362, 374, 386,
];

export const LANDMARK_COUNT = 478;
