// Agent voice: OS text-to-speech through speechSynthesis, falling back to
// the main process (Windows System.Speech, macOS say) when the renderer has
// no voices. Reports speaking start/end so the mic can be half-duplex.

export interface VoiceOptions {
  voiceName: string | null;
  rate: number;
}

export function listVoices(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices();
}

/** Voices load asynchronously in Chromium; wait briefly for them. */
export function voicesReady(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const now = listVoices();
  if (now.length || typeof speechSynthesis === 'undefined') return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (): void => resolve(listVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

export class AgentVoice {
  private speakingNow = false;
  private cancelled = false;
  /** Set when speech is muted (e.g. e2e tests or no audio output wanted). */
  silent = false;

  constructor(
    private opts: VoiceOptions,
    private readonly onSpeaking: (speaking: boolean) => void,
  ) {}

  setOptions(o: VoiceOptions): void {
    this.opts = o;
  }

  get speaking(): boolean {
    return this.speakingNow;
  }

  private set(s: boolean): void {
    if (s === this.speakingNow) return;
    this.speakingNow = s;
    this.onSpeaking(s);
  }

  /** Speak and resolve when done (or cancelled). Text is always shown on screen too. */
  async say(text: string): Promise<void> {
    this.cancel();
    this.cancelled = false;
    if (this.silent) {
      // Keep the half-duplex timing realistic without sound (~25 ms per character).
      this.set(true);
      await new Promise((r) => setTimeout(r, Math.min(4000, 400 + text.length * 25)));
      if (!this.cancelled) this.set(false);
      return;
    }
    const voices = await voicesReady();
    if (voices.length) {
      await this.sayBrowser(text, voices);
      return;
    }
    this.set(true);
    try {
      await window.htf.ttsSpeak(text, this.opts.rate);
    } finally {
      if (!this.cancelled) this.set(false);
    }
  }

  private sayBrowser(text: string, voices: SpeechSynthesisVoice[]): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = voices.find((x) => x.name === this.opts.voiceName) ?? voices.find((x) => x.default) ?? voices[0];
      if (v) u.voice = v;
      u.rate = this.opts.rate;
      // Mark speaking immediately: onstart can lag, and the mic must be muted
      // before the first syllable.
      this.set(true);
      const finish = (): void => {
        clearTimeout(guard);
        if (!this.cancelled) this.set(false);
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // Safety net if the engine never fires onend.
      const guard = setTimeout(finish, 2000 + text.length * 120);
      speechSynthesis.speak(u);
    });
  }

  cancel(): void {
    this.cancelled = true;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    void window.htf?.ttsCancel();
    this.set(false);
  }
}
