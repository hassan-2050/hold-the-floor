// SmartSpectra ValidationCode values (SDK 3.5.0 typings) with plain hints
// used when the SDK sends no hint text. Pure: no SDK import.
export const VALIDATION = {
  kOk: 0,
  kNoFaceFound: 1,
  kMultipleFacesFound: 2,
  kFaceNotCentered: 3,
  kFaceSizeOutOfRange: 4,
  kTooDark: 5,
  kTooBright: 6,
  kChestNotVisible: 7,
  kCameraTuning: 10,
  kFrameRateTooLow: 11,
  kExcessiveMotion: 12,
  kFaceTooClose: 13,
  kFaceTooFar: 14,
  kFaceTooHigh: 15,
  kFaceTooLow: 16,
  kFaceNotForward: 17,
} as const;

export const VALIDATION_HINTS: Readonly<Record<number, string>> = {
  0: '',
  1: 'No face found. Sit in front of the camera.',
  2: 'More than one face is in view. Camera cues pause so only you are watched.',
  3: 'Move so your face is in the middle of the picture.',
  4: 'Move a little closer or further from the camera.',
  5: 'It is too dark. Add light in front of you.',
  6: 'It is too bright. Reduce light behind or in front of you.',
  7: 'Sit back so your shoulders and upper chest are in view.',
  10: 'The camera is adjusting. One moment.',
  11: 'The camera is slow. More light in front of you helps.',
  12: 'Hold still for a moment.',
  13: 'Move back a little.',
  14: 'Move a little closer.',
  15: 'Lower the camera or move up a little.',
  16: 'Raise the camera or move down a little.',
  17: 'Face the camera.',
};
