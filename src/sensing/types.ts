// Plain-number shapes of what the SDK delivers. No SDK imports here, so the
// pure modules (features, turn, replay) can share these types.

/** A trace sample (chest or abdomen breathing movement). */
export interface RawSample {
  v: number;
  /** Inherited from the breathing-rate verdict (confidence >= 45). */
  stable: boolean;
  /** Epoch microseconds. */
  tUs: number;
}

export interface RawRate extends RawSample {
  /** 0-100; stays 0 until the ~30 s breathing window fills. */
  conf: number;
}

export interface RawTalking {
  detected: boolean;
  stable: boolean;
  tUs: number;
}

export interface RawLandmarks {
  /** Interleaved x,y pixel coordinates, landmark i at [2i, 2i+1]. */
  xy: number[];
  stable: boolean;
  /** True when this set cannot be associated with the previous one. */
  reset: boolean;
  tUs: number;
}

export interface RawPacket {
  /** Epoch ms when the renderer received the packet. */
  rxMs: number;
  /** Timestamp passed with the 'metrics' event (epoch µs). */
  packetTsUs: number;
  chest: RawSample[];
  abdomen: RawSample[];
  rate: RawRate[];
  talking: RawTalking[];
  landmarks: RawLandmarks[];
}
