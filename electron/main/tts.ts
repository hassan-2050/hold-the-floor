// Text-to-speech fallback when the renderer has no speechSynthesis voices:
// Windows System.Speech via PowerShell, macOS `say`, Linux `spd-say`.
// The text is passed through an environment variable, never interpolated
// into a command line.
import { spawn, type ChildProcess } from 'node:child_process';

let current: ChildProcess | null = null;

export function ttsCancel(): void {
  if (current && !current.killed) current.kill();
  current = null;
}

export function ttsSpeak(text: string, rate: number): Promise<{ ok: boolean; error?: string }> {
  ttsCancel();
  // Control characters become spaces.
  const clean = [...text].map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').slice(0, 600);
  let cmd: string;
  let args: string[];
  if (process.platform === 'win32') {
    // System.Speech rate is -10..10; 1.0 → 0.
    const r = Math.round((rate - 1) * 10);
    cmd = 'powershell.exe';
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${r}; $s.Speak($env:HTF_TTS_TEXT)`,
    ];
  } else if (process.platform === 'darwin') {
    cmd = 'say';
    args = ['-r', String(Math.round(180 * rate)), clean];
  } else {
    cmd = 'spd-say';
    args = ['-w', '-r', String(Math.round((rate - 1) * 100)), clean];
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, HTF_TTS_TEXT: clean }, windowsHide: true, stdio: 'ignore' });
    current = child;
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('exit', (code) => {
      if (current === child) current = null;
      resolve(code === 0 || code === null ? { ok: true } : { ok: false, error: `TTS exited with ${code}` });
    });
  });
}
