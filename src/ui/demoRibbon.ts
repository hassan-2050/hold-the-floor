// A scripted 14 s loop for the Welcome screen: you speak, pause 3 s with
// lips pressed (held; a 2 s timer would cut in), finish, and the reply
// comes quickly. Illustration only; no camera data.
import { Ribbon } from '../turn/ribbon';
import type { CueStatus } from '../turn/events';

const LOOP_MS = 14000;

export function startDemoRibbon(): { ribbon: Ribbon; stop: () => void } {
  const ribbon = new Ribbon();
  let t = 0;
  let loopStart = 0;
  const step = (): void => {
    const p = (t - loopStart) % LOOP_MS;
    if (p < 34 && t - loopStart >= LOOP_MS) loopStart = t - p;
    const speaking = (p > 500 && p < 3500) || (p > 6500 && p < 8500);
    const pressed = p >= 3600 && p < 6400;
    const agent = p > 9400 && p < 12500;
    const lips: CueStatus = pressed ? 'on' : 'off';
    ribbon.push({
      t,
      voice: agent ? NaN : speaking ? 0.45 + 0.35 * Math.abs(Math.sin(p / 90)) : 0.04,
      speaking,
      cues: { lips, head: 'off', breath: p > 6000 && p < 6500 ? 'on' : 'off', talking: speaking ? 'on' : 'off' },
      hold: p >= 3950 && p < 6700 ? 'lips' : null,
      agent,
    });
    if (Math.abs(p - 5500) < 17) ribbon.mark({ kind: 'ghost', t, policy: 'fixed-2000', cutoff: true });
    if (Math.abs(p - 9200) < 17) ribbon.mark({ kind: 'end', t, policy: 'hold-the-floor', reason: 'cues-relaxed' });
    t += 33.3;
  };
  // Pre-fill so the loop is visible immediately.
  for (let i = 0; i < 600; i++) step();
  const timer = window.setInterval(step, 33);
  return { ribbon, stop: () => window.clearInterval(timer) };
}
