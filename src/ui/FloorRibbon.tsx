// The floor ribbon: 20 s of the conversation, scrolling right to left.
// Lanes: Voice, Lips, Head, Breath; an amber Hold band labelled with its
// cue; dashed ghost markers where a fixed timer would have cut in.
// Reads the engine's ring buffer directly in requestAnimationFrame.
// Reduced motion: redraws in 1 s steps.
import { useEffect, useRef, useState } from 'react';
import { CUE_NAMES } from '../turn/events';
import { LANE_ON, LANE_UNAVAILABLE, LANE_WARMING, type Ribbon } from '../turn/ribbon';
import { policyLabel } from '../results/metrics';

const LABEL_W = 96;
const HOLD_H = 34;
const LANES = ['Voice', 'Lips', 'Head', 'Breath'] as const;
const CUE_WORD: Record<string, string> = { lips: 'lips', talking: 'still talking', breath: 'breathing in', head: 'head turned' };

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function FloorRibbon({ ribbon, seconds = 20 }: { ribbon: () => Ribbon | null; seconds?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    const canvas = ref.current!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let lastStep = -1;
    let lastSummary = 0;
    const colors = {
      ink: css('--ink'),
      ink2: css('--ink-2'),
      teal: css('--teal'),
      amber: css('--amber'),
      amberSoft: css('--amber-soft'),
      line: css('--line'),
      ghost: css('--ghost'),
      unavailable: css('--unavailable'),
      white: css('--white'),
      success: css('--success'),
    };
    const font = css('--font');
    const mono = css('--mono');

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const r = ribbon();
      if (!r || r.count === 0) return;
      const latest = r.t[(r.count - 1) % r.size]!;
      if (reduce.matches) {
        const step = Math.floor(latest / 1000);
        if (step === lastStep) return;
        lastStep = step;
      }
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const plotW = w - LABEL_W - 16;
      const t0 = latest - seconds * 1000;
      const x = (t: number): number => LABEL_W + ((t - t0) / (seconds * 1000)) * plotW;
      const laneH = (h - HOLD_H - 8) / LANES.length;
      const laneY = (i: number): number => HOLD_H + 4 + i * laneH;

      // Labels and lane rules.
      ctx.font = `700 16px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colors.ink;
      ctx.fillText('Hold', 16, HOLD_H / 2 + 2);
      LANES.forEach((name, i) => {
        ctx.fillStyle = colors.ink;
        ctx.fillText(name, 16, laneY(i) + laneH / 2);
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, laneY(i) + laneH - 0.5);
        ctx.lineTo(w - 16, laneY(i) + laneH - 0.5);
        ctx.stroke();
      });

      // Everything below draws inside the plot area only.
      ctx.save();
      ctx.beginPath();
      ctx.rect(LABEL_W, 0, plotW, h);
      ctx.clip();
      const n = Math.min(r.count, r.size);
      const start = r.count - n;
      const at = (k: number): number => (start + k) % r.size;

      // Hold band: amber spans, labelled with the cue.
      let spanStart = -1;
      let spanCue = -1;
      const flush = (endK: number): void => {
        if (spanStart < 0) return;
        const xa = Math.max(LABEL_W, x(r.t[at(spanStart)]!));
        const xb = x(r.t[at(endK)]!);
        ctx.fillStyle = colors.amber;
        ctx.fillRect(xa, 4, Math.max(2, xb - xa), HOLD_H - 6);
        const word = CUE_WORD[CUE_NAMES[spanCue]!] ?? '';
        ctx.font = `700 15px ${font}`;
        const tw = ctx.measureText(word).width;
        if (xb - xa > tw + 12) {
          ctx.fillStyle = colors.ink;
          ctx.fillText(word, xa + 6, HOLD_H / 2 + 2);
        }
        spanStart = -1;
      };
      for (let k = 0; k < n; k++) {
        const hc = r.hold[at(k)]!;
        if (hc !== spanCue || hc < 0) {
          flush(k);
          if (hc >= 0) {
            spanStart = k;
          }
          spanCue = hc;
        }
      }
      flush(n - 1);

      // Agent speaking: light hatch across the voice lane.
      for (let k = 0; k < n; k++) {
        if (!r.agent[at(k)]) continue;
        const xa = x(r.t[at(k)]!);
        ctx.fillStyle = colors.line;
        ctx.fillRect(xa, laneY(0) + 4, Math.max(1.5, plotW / (seconds * 30)), laneH - 8);
      }
      // Voice lane: level as a filled area, teal while speaking.
      const vY = laneY(0);
      ctx.beginPath();
      let pen = false;
      for (let k = 0; k < n; k++) {
        const i = at(k);
        const v = r.voice[i]!;
        const xx = x(r.t[i]!);
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const yy = vY + laneH - 4 - v * (laneH - 8);
        if (!pen) {
          ctx.moveTo(xx, vY + laneH - 4);
          pen = true;
        }
        ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = colors.teal;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let k = 0; k < n; k++) {
        const i = at(k);
        if (!r.speaking[i]) continue;
        ctx.fillStyle = colors.teal;
        ctx.fillRect(x(r.t[i]!), vY + laneH - 6, Math.max(1.5, plotW / (seconds * 30)), 4);
      }

      // Cue lanes: step line high when on; dashed when unavailable; dotted warming.
      (['lips', 'head', 'breath'] as const).forEach((cue, li) => {
        const lane = r.lanes[cue];
        const y0 = laneY(li + 1);
        const hi = y0 + 6;
        const lo = y0 + laneH - 8;
        let prev = 99;
        ctx.lineWidth = 2.5;
        for (let k = 0; k < n; k++) {
          const i = at(k);
          const v = lane[i]!;
          const xx = x(r.t[i]!);
          const nx = k + 1 < n ? x(r.t[at(k + 1)]!) : xx + 2;
          if (v === LANE_UNAVAILABLE || v === LANE_WARMING) {
            ctx.strokeStyle = colors.unavailable;
            ctx.setLineDash(v === LANE_WARMING ? [2, 4] : [6, 5]);
            ctx.beginPath();
            ctx.moveTo(xx, (hi + lo) / 2);
            ctx.lineTo(nx, (hi + lo) / 2);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            const y = v === LANE_ON ? hi : lo;
            ctx.strokeStyle = v === LANE_ON ? colors.ink : colors.ink2;
            ctx.beginPath();
            if (prev !== 99 && prev !== v && (prev === LANE_ON || prev === 0)) {
              ctx.moveTo(xx, prev === LANE_ON ? hi : lo);
              ctx.lineTo(xx, y);
            } else ctx.moveTo(xx, y);
            ctx.lineTo(nx, y);
            ctx.stroke();
            if (v === LANE_ON) {
              ctx.fillStyle = colors.amberSoft;
              ctx.fillRect(xx, hi + 2, nx - xx, lo - hi - 2);
            }
          }
          prev = v;
        }
      });

      // Markers: ghost timers (dashed), turn ends (solid), fallbacks.
      ctx.font = `14px ${mono}`;
      for (const m of r.markers) {
        if (m.t < t0) continue;
        const mx = x(m.t);
        if (m.kind === 'ghost') {
          if (m.policy !== 'fixed-2000' && m.policy !== 'fixed-700') continue;
          ctx.strokeStyle = colors.ghost;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(mx, 4);
          ctx.lineTo(mx, h - 4);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = colors.ink2;
          ctx.fillText(`${m.policy === 'fixed-2000' ? '2 s' : '0.7 s'}${m.cutoff ? ' cut in' : ''}`, mx + 4, h - 14);
        } else if (m.kind === 'end') {
          ctx.strokeStyle = m.reason === 'shadow' ? colors.ink2 : colors.success;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(mx, 4);
          ctx.lineTo(mx, h - 4);
          ctx.stroke();
          ctx.fillStyle = colors.success;
          ctx.fillText(m.reason === 'shadow' ? 'would reply' : 'reply', mx + 4, laneY(0) + 12);
        } else if (m.kind === 'fallback' && m.on) {
          ctx.fillStyle = colors.ink2;
          ctx.fillText('timer only', mx + 4, laneY(1) + 12);
        }
      }

      ctx.restore();

      // Text summary for screen readers, every 2 s.
      if (latest - lastSummary > 2000) {
        lastSummary = latest;
        const holds = new Set<number>();
        let holdCount = 0;
        let prevHold = -1;
        for (let k = 0; k < n; k++) {
          const hc = r.hold[at(k)]!;
          if (hc >= 0 && hc !== prevHold) {
            holdCount++;
            holds.add(hc);
          }
          prevHold = hc;
        }
        const cutIns = r.markers.filter((m) => m.kind === 'ghost' && m.policy === 'fixed-2000' && m.t >= t0).length;
        const ends = r.markers.filter((m) => m.kind === 'end' && m.t >= t0).length;
        setSummary(
          `Last ${seconds} seconds: ${holdCount} hold${holdCount === 1 ? '' : 's'}` +
            (holds.size ? ` (${[...holds].map((c) => CUE_WORD[CUE_NAMES[c]!]).join(', ')})` : '') +
            `, ${ends} repl${ends === 1 ? 'y' : 'ies'}; a ${policyLabel('fixed-2000')} would have cut in ${cutIns} time${cutIns === 1 ? '' : 's'}.`,
        );
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ribbon, seconds]);

  return (
    <div className="ribbon" role="img" aria-label={summary || 'Floor ribbon'}>
      <canvas ref={ref} aria-hidden="true" />
      <p className="sr-only" aria-live="off">
        {summary}
      </p>
    </div>
  );
}
