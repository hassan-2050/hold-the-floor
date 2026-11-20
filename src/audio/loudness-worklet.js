// AudioWorklet: turns microphone audio into one loudness number (dBFS RMS)
// every 20 ms. Samples are summed into a running mean square and dropped
// immediately; no audio is buffered, stored or posted. Only
// { t: audio-clock seconds at window end, db } leaves this file.
class LoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.windowFrames = Math.round(sampleRate * 0.02);
    this.sumSq = 0;
    this.count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = ch[i];
        this.sumSq += s * s;
        this.count++;
        if (this.count >= this.windowFrames) {
          const ms = this.sumSq / this.count;
          const db = 10 * Math.log10(ms + 1e-12);
          // currentTime is the start of this render quantum; add the offset
          // of the sample that closed the window.
          this.port.postMessage({ t: currentTime + (i + 1) / sampleRate, db });
          this.sumSq = 0;
          this.count = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('htf-loudness', LoudnessProcessor);
