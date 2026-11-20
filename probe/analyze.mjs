#!/usr/bin/env node
// Stage 1 analysis: reads a probe log (JSON lines) and reports field shapes,
// landmark index checks, update rates, delivery delays, cue latency against
// the microphone, and the breath-after-speech decision.
//
// Usage: node probe/analyze.mjs [path/to/probe-*.jsonl]   (default: newest)
// Writes <log>.report.md next to the log and prints it.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let file = process.argv[2];
if (!file) {
  const dir = join(here, 'logs');
  const logs = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  logs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  file = logs[0];
  if (!file) {
    console.error('No probe logs found in probe/logs/');
    process.exit(1);
  }
}

const recs = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const out = [];
const p = (s = '') => out.push(s);

// ---------- helpers ----------
const sorted = (a) => [...a].sort((x, y) => x - y);
const q = (a, f) => {
  if (!a.length) return NaN;
  const s = sorted(a);
  return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))];
};
const med = (a) => q(a, 0.5);
const mad = (a) => {
  const m = med(a);
  return med(a.map((x) => Math.abs(x - m)));
};
const f1 = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : 'n/a');
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : NaN);
function stats(label, arr, unit = 'ms', d = 0) {
  if (!arr.length) return `${label}: no data`;
  return `${label}: median ${f1(med(arr), d)} ${unit}, p10 ${f1(q(arr, 0.1), d)}, p90 ${f1(q(arr, 0.9), d)}, n=${arr.length}`;
}

// ---------- collect ----------
const info = recs.find((r) => r.k === 'info');
const camera = recs.find((r) => r.k === 'camera');
const readiness = recs.filter((r) => r.k === 'readiness');
const shape = recs.find((r) => r.k === 'shape');
const startCall = recs.find((r) => r.k === 'startCall');
const started = recs.find((r) => r.k === 'started');
const stopCall = recs.find((r) => r.k === 'stopCall');
const stopped = recs.find((r) => r.k === 'stopped');
const metrics = recs.filter((r) => r.k === 'm');
const mic = recs.filter((r) => r.k === 'a');
const vals = recs.filter((r) => r.k === 'v');
const errs = recs.filter((r) => r.k === 'e');
const phases = recs.filter((r) => r.k === 'p');

// Phase intervals [t0, t1) in epoch ms.
const intervals = phases.map((ph, i) => ({ ...ph, t0: ph.t, t1: phases[i + 1]?.t ?? Infinity }));
const phaseAt = (tMs) => intervals.find((iv) => tMs >= iv.t0 && tMs < iv.t1);
const inPhase = (tMs, name) => phaseAt(tMs)?.phase === name;

// Flatten series. Sample timestamps are epoch µs -> ms.
const lm = []; // {t, rx, s, r, n, k}
const tk = []; // {t, rx, d, s}
const chest = []; // {t, rx, v, s}
const abd = [];
const rate = []; // {t, rx, v, s, c}
let lmPerPacket = [];
for (const m of metrics) {
  if (m.lm) {
    lmPerPacket.push(m.lm.length);
    for (const l of m.lm) lm.push({ t: l.t / 1000, rx: m.rx, s: l.s, r: l.r, n: l.n, k: l.k, full: l.full });
  }
  for (const x of m.tk ?? []) tk.push({ d: x[0], s: x[1], t: x[2] / 1000, rx: m.rx });
  for (const x of m.c ?? []) chest.push({ v: x[0], s: x[1], t: x[2] / 1000, rx: m.rx });
  for (const x of m.a ?? []) abd.push({ v: x[0], s: x[1], t: x[2] / 1000, rx: m.rx });
  for (const x of m.r ?? []) rate.push({ v: x[0], s: x[1], c: x[2], t: x[3] / 1000, rx: m.rx });
}
// Traces can be re-sent across packets; keep the first delivery of each timestamp.
const dedupe = (arr) => {
  const seen = new Map();
  for (const x of arr) if (!seen.has(x.t)) seen.set(x.t, x);
  return [...seen.values()].sort((a, b) => a.t - b.t);
};
const chestU = dedupe(chest);
const abdU = dedupe(abd);
const lmU = dedupe(lm);
const tkU = dedupe(tk);
const rateU = dedupe(rate);

// ---------- report ----------
p(`# Stage 1 probe report`);
p();
p(`Log: \`${file}\``);
p(`Records: ${recs.length} · metrics packets: ${metrics.length} · mic samples: ${mic.length}`);
p();
p(`## Environment`);
if (info) {
  p(`- SDK ${info.sdkVersion}, Electron ${info.electron} (Chrome ${info.chrome}, Node ${info.node}), ${info.platform}`);
  p(`- requestedMetrics ${JSON.stringify(info.requestedMetrics)}, telemetry ${info.telemetry}, capture size ${info.size ?? '1280x720'}, mic noise suppression ${info.noiseSuppression ?? false}`);
  p(`- native cameras: ${info.nativeCameras.map((c) => c.name).join(', ')}`);
}
if (camera) p(`- capture: ${camera.label} ${JSON.stringify(camera.settings && { w: camera.settings.width, h: camera.settings.height, fps: camera.settings.frameRate })}`);
for (const r of readiness) p(`- readiness: **${r.verdict}** — ${r.reason} (${r.tookMs ?? '?'} ms, camera "${r.cameraLabel}")`);
if (startCall && started) p(`- sdk.start() resolved after ${f1(started.rx - startCall.rx, 0)} ms`);
const firstM = metrics[0];
if (startCall && firstM) p(`- first metrics packet ${f1((firstM.rx - startCall.rx) / 1000, 2)} s after start() was called (target < 5 s)`);
const firstLm = lmU[0];
if (startCall && firstLm) p(`- first landmarks ${f1((firstLm.rx - startCall.rx) / 1000, 2)} s after start()`);
const firstStable = rateU.find((r) => r.s);
if (startCall && firstStable) p(`- breathing first stable ${f1((firstStable.rx - startCall.rx) / 1000, 1)} s after start() (conf ${firstStable.c})`);
else p(`- breathing never reached stable in this log`);
if (stopCall && stopped) p(`- stop (tracks + sdk.stop + destroy) took ${f1(stopped.tookMs, 0)} ms (target < 1000)`);
const lastM = metrics.at(-1);
if (stopCall && lastM) p(`- metrics after stop call: ${metrics.filter((m) => m.rx > stopCall.rx + 50).length} packets`);
p(`- errors: ${errs.length ? errs.map((e) => `${e.code} ${e.message}`).join('; ') : 'none'}`);
p();

p(`## Field shapes (first packet, SDK decode)`);
function describe(o, depth = 0) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(o)) {
    if (!o.length) return `${pad}[] (empty)`;
    return `${pad}[${o.length}] of:\n${describe(o[0], depth + 1)}`;
  }
  if (o && typeof o === 'object') {
    return Object.entries(o)
      .map(([k, v]) => (v && typeof v === 'object' ? `${pad}${k}:\n${describe(v, depth + 1)}` : `${pad}${k}: ${typeof v} (${JSON.stringify(v)})`))
      .join('\n');
  }
  return `${pad}${typeof o} (${JSON.stringify(o)})`;
}
if (shape) {
  p('```');
  p(describe(shape.obj));
  p('```');
}
const ns = [...new Set(lmU.map((l) => l.n))];
p(`Landmark set sizes seen: ${ns.join(', ')}`);
p();

p(`## Update rates (sample timestamps)`);
const rateOf = (arr) => {
  const dts = [];
  for (let i = 1; i < arr.length; i++) dts.push(arr[i].t - arr[i - 1].t);
  return dts;
};
for (const [name, arr] of [
  ['landmarks', lmU],
  ['talking', tkU],
  ['chest trace', chestU],
  ['abdomen trace', abdU],
  ['breathing rate', rateU],
]) {
  const dts = rateOf(arr).filter((d) => d > 0 && d < 5000);
  p(`- ${name}: ${arr.length} samples; ${stats('interval', dts, 'ms', 1)} → ~${f1(1000 / med(dts), 1)} Hz`);
}
const pk = [];
for (let i = 1; i < metrics.length; i++) pk.push(metrics[i].rx - metrics[i - 1].rx);
p(`- packets: ${stats('interval', pk, 'ms', 1)}`);
p(`- landmark sets per packet: ${[...new Set(lmPerPacket)].sort().join(', ')}`);
const chestPer = metrics.filter((m) => m.c).map((m) => m.c.length);
p(`- chest samples per packet: median ${med(chestPer)}, max ${Math.max(0, ...chestPer)}`);
p(`- landmark reset flags: ${lmU.filter((l) => l.r).length}; unstable sets: ${lmU.filter((l) => !l.s).length}`);
p();

p(`## Delivery delay (receive time − sample timestamp)`);
p(`Sample timestamps are the renderer's epoch-anchored frame times, so this includes SDK processing and IPC. Clock anchor error is about one frame.`);
for (const [name, arr] of [
  ['landmarks', lm],
  ['talking', tk],
  ['chest trace (first delivery)', chestU],
]) {
  p(`- ${name}: ${stats('delay', arr.map((x) => x.rx - x.t))}`);
}
p();

p(`## Validation status`);
const byCode = new Map();
for (const v of vals) byCode.set(`${v.code} ${v.hint}`, (byCode.get(`${v.code} ${v.hint}`) ?? 0) + 1);
for (const [k, c] of byCode) p(`- ${k}: ${c} events`);
const vi = [];
for (let i = 1; i < vals.length; i++) vi.push(vals[i].rx - vals[i - 1].rx);
p(`- ${stats('validation event interval', vi)}`);
{
  // Which validation code was active at each processed frame, and did that
  // frame come with landmarks / a talking=true flag?
  const V = vals.map((v) => ({ t: v.ts / 1000, code: v.code })).sort((a, b) => a.t - b.t);
  const codeAt = (t) => {
    let lo = 0, hi = V.length - 1, c = null;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (V[m].t <= t) { c = V[m].code; lo = m + 1; } else hi = m - 1;
    }
    return c;
  };
  const lmSet = new Set(lmU.map((l) => Math.round(l.t)));
  const frameTs = (chestU.length ? chestU : tkU).map((x) => Math.round(x.t));
  const by = {};
  for (const t of frameTs) {
    const c = codeAt(t);
    by[c] ??= { frames: 0, lm: 0 };
    by[c].frames++;
    if (lmSet.has(t)) by[c].lm++;
  }
  p(`- frames carrying landmarks, by validation code: ${Object.entries(by).map(([c, v]) => `code ${c}: ${v.lm}/${v.frames} (${pct(v.lm / v.frames)})`).join('; ')}`);
  const phaseMix = {};
  for (const v of vals) {
    const ph = phaseAt(v.rx)?.phase ?? 'pre';
    phaseMix[ph] ??= {};
    phaseMix[ph][v.code] = (phaseMix[ph][v.code] ?? 0) + 1;
  }
  p(`- codes by protocol phase: ${Object.entries(phaseMix).map(([ph, m]) => `${ph} ${JSON.stringify(m)}`).join(' · ')}`);
}
p();

// ---------- landmark ordering ----------
p(`## Landmark index check (MediaPipe Face Mesh order assumed)`);
const restLm = lmU.filter((l) => l.s && !l.r && inPhase(l.t, 'rest'));
const useLm = restLm.length > 20 ? restLm : lmU.filter((l) => l.s && !l.r);
const avgPt = (i) => {
  const xs = useLm.map((l) => l.k?.[i]).filter(Boolean);
  return xs.length ? [med(xs.map((a) => a[0])), med(xs.map((a) => a[1]))] : null;
};
const P = {};
for (const i of [0, 1, 4, 10, 13, 14, 17, 33, 61, 133, 152, 263, 291, 362]) P[i] = avgPt(i);
const checks = [];
const chk = (name, ok) => checks.push(`- [${ok ? 'x' : ' '}] ${name}`);
if (P[1] && P[33] && P[263]) {
  chk('33 (subject right eye outer) is left of 263 in the unmirrored frame', P[33][0] < P[263][0]);
  chk('nose tip 1 lies between the eye corners horizontally', P[1][0] > P[33][0] && P[1][0] < P[263][0]);
  chk('nose tip 1 is below the eye line', P[1][1] > (P[33][1] + P[263][1]) / 2);
}
if (P[13] && P[14]) chk('inner upper lip 13 is above inner lower lip 14', P[13][1] <= P[14][1]);
if (P[0] && P[13] && P[14] && P[17]) chk('outer lip 0 above 13, 17 below 14', P[0][1] < P[13][1] && P[17][1] > P[14][1]);
if (P[61] && P[291]) chk('mouth corner 61 left of 291', P[61][0] < P[291][0]);
if (P[1] && P[13]) chk('mouth (13) below nose tip (1)', P[13][1] > P[1][1]);
if (P[10] && P[152]) chk('forehead 10 above chin 152', P[10][1] < P[152][1]);
if (P[133] && P[362] && P[33] && P[263]) chk('inner eye corners 133/362 between outer 33/263', P[133][0] > P[33][0] && P[362][0] < P[263][0]);
p(checks.length ? checks.join('\n') : '- no stable landmarks to check');
p(`- IOD (33↔263) at rest: ${f1(dist(P[33], P[263]))} px`);
p();

// ---------- mic segmentation ----------
p(`## Microphone`);
const restMic = mic.filter((a) => inPhase(a.t, 'rest')).map((a) => a.db);
const floorSrc = restMic.length > 50 ? restMic : mic.slice(0, 150).map((a) => a.db);
const floor = med(floorSrc);
p(`- noise floor (median dBFS during rest): ${f1(floor)} dB; speech > ${f1(floor + 12)} dB for ≥ 60 ms; silence < ${f1(floor + 6)} dB for ≥ 150 ms`);
const onsets = [];
const offsets = [];
{
  let speaking = false;
  let runStart = null;
  let runType = null;
  for (const a of mic) {
    const loud = a.db > floor + 12;
    const quiet = a.db < floor + 6;
    const type = loud ? 'loud' : quiet ? 'quiet' : 'mid';
    if (type !== runType) {
      runType = type;
      runStart = a.t - 20; // window covers the previous 20 ms
    }
    if (!speaking && type === 'loud' && a.t - runStart >= 60) {
      speaking = true;
      onsets.push(runStart);
    } else if (speaking && type === 'quiet' && a.t - runStart >= 150) {
      speaking = false;
      offsets.push(runStart);
    }
  }
}
p(`- speech onsets ${onsets.length}, offsets ${offsets.length}`);
{
  const sp = mic.filter((a) => inPhase(a.t, 'speak')).map((a) => a.db);
  if (sp.length) p(`- level while counting aloud: p50 ${f1(q(sp, 0.5))} dB, p90 ${f1(q(sp, 0.9))} dB → p90 is ${f1(q(sp, 0.9) - floor)} dB above the floor (detector needs +12)`);
}
p();

// ---------- talking vs mic ----------
p(`## Talking flag vs microphone`);
const edges = { up: [], down: [] };
for (let i = 1; i < tkU.length; i++) {
  if (!tkU[i - 1].d && tkU[i].d) edges.up.push(tkU[i]);
  if (tkU[i - 1].d && !tkU[i].d) edges.down.push(tkU[i]);
}
function matchEdges(events, es, before = 500, after = 1500) {
  const dTs = [];
  const dRx = [];
  let hit = 0;
  for (const t of events) {
    const e = es.find((x) => x.t >= t - before && x.t <= t + after);
    if (e) {
      hit++;
      dTs.push(e.t - t);
      dRx.push(e.rx - t);
    }
  }
  return { dTs, dRx, hit, n: events.length };
}
const speakOn = onsets.filter((t) => inPhase(t, 'speak') || inPhase(t + 200, 'speak'));
const speakOff = offsets.filter((t) => inPhase(t, 'speak') || inPhase(t, 'pause'));
const tUp = matchEdges(speakOn.length ? speakOn : onsets, edges.up);
const tDn = matchEdges(speakOff.length ? speakOff : offsets, edges.down, 300, 2000);
p(`- onset: talking rose for ${tUp.hit}/${tUp.n} mic onsets`);
p(`  - ${stats('flag timestamp − mic onset', tUp.dTs)}`);
p(`  - ${stats('flag received − mic onset (what the arbiter sees)', tUp.dRx)}`);
p(`- offset: talking fell for ${tDn.hit}/${tDn.n} mic offsets`);
p(`  - ${stats('flag timestamp − mic offset', tDn.dTs)}`);
p(`  - ${stats('flag received − mic offset', tDn.dRx)}`);
p();

// ---------- lips ----------
p(`## Lip features (normalised by IOD 33↔263)`);
const feat = (l) => {
  const k = l.k ?? {};
  const iod = dist(k[33], k[263]);
  return { t: l.t, rx: l.rx, ap: dist(k[13], k[14]) / iod, h: dist(k[0], k[17]) / iod, ok: l.s && !l.r && iod > 0 };
};
const lf = lmU.map(feat).filter((f) => f.ok && Number.isFinite(f.ap));
const restF = lf.filter((f) => inPhase(f.t, 'rest'));
const apRest = med(restF.map((f) => f.ap));
const apMad = mad(restF.map((f) => f.ap));
const hRest = med(restF.map((f) => f.h));
const hMad = mad(restF.map((f) => f.h));
p(`- rest aperture ${f1(apRest, 4)} (MAD ${f1(apMad, 4)}), rest outer height ${f1(hRest, 4)} (MAD ${f1(hMad, 4)}), n=${restF.length}`);
const pressF = lf.filter((f) => inPhase(f.t, 'press'));
if (pressF.length) {
  const frac = pressF.filter((f) => f.h < hRest - 3 * hMad).length / pressF.length;
  p(`- pressed: outer height median ${f1(med(pressF.map((f) => f.h)), 4)}; frames meeting "height < rest − 3·MAD": ${pct(frac)}`);
}
const setF = lf.filter((f) => inPhase(f.t, 'set'));
if (setF.length) {
  const frac = setF.filter((f) => f.ap > apRest + 3 * apMad).length / setF.length;
  p(`- set (lips parted, silent): aperture median ${f1(med(setF.map((f) => f.ap)), 4)}; frames meeting "aperture > rest + 3·MAD": ${pct(frac)}`);
}
{
  const dTs = [];
  const dRx = [];
  let hit = 0;
  const evs = speakOn.length ? speakOn : onsets;
  for (const t of evs) {
    const e = lf.find((f) => f.t >= t - 300 && f.t <= t + 1000 && f.ap > apRest + 3 * apMad);
    if (e) {
      hit++;
      dTs.push(e.t - t);
      dRx.push(e.rx - t);
    }
  }
  {
    const offs = speakOff.length ? speakOff : offsets;
    const close = [];
    for (const t of offs) {
      // Last frame with open lips within 1 s around the offset.
      const open = lf.filter((f) => f.t >= t - 1000 && f.t <= t + 1000 && f.ap > apRest + Math.max(3 * apMad, 0.02));
      const last = open.at(-1);
      if (last) close.push(last.t - t);
    }
    p(`- last open-lip frame relative to mic speech offset: ${stats('delta', close)} (positive = lips still open after the sound stops)`);
  }
  p(`- lip opening at speech onset: ${hit}/${evs.length}`);
  p(`  - ${stats('landmark timestamp − mic onset', dTs)}`);
  p(`  - ${stats('landmark received − mic onset', dRx)}`);
}
p();

// ---------- head ----------
p(`## Head pose proxy (nose tip vs eye-corner midpoint, in IOD units)`);
const hp = lmU
  .filter((l) => l.s && !l.r)
  .map((l) => {
    const k = l.k ?? {};
    const a = k[33];
    const b = k[263];
    const n = k[1];
    if (!a || !b || !n) return null;
    const iod = dist(a, b);
    return { t: l.t, dx: (n[0] - (a[0] + b[0]) / 2) / iod, dy: (n[1] - (a[1] + b[1]) / 2) / iod, iod };
  })
  .filter(Boolean);
const iodRest = med(hp.filter((h) => inPhase(h.t, 'rest')).map((h) => h.iod));
for (const ph of ['rest', 'head-center', 'head-left', 'head-right', 'head-up', 'head-down']) {
  const xs = hp.filter((h) => inPhase(h.t, ph));
  if (!xs.length) continue;
  p(`- ${ph}: dx ${f1(med(xs.map((h) => h.dx)), 3)}, dy ${f1(med(xs.map((h) => h.dy)), 3)}, IOD/rest ${f1(med(xs.map((h) => h.iod)) / iodRest, 3)} (n=${xs.length})`);
}
p();

// ---------- breath after speech ----------
p(`## Breath after speech (go/no-go)`);
const restC = chestU.filter((c) => inPhase(c.t, 'rest'));
const tail = restC.filter((c) => c.t > (restC.at(-1)?.t ?? 0) - 15000);
function slopePerSec(arr) {
  if (arr.length < 3) return NaN;
  const t0 = arr[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const c of arr) {
    const x = (c.t - t0) / 1000;
    sx += x; sy += c.v; sxx += x * x; sxy += x * c.v;
  }
  const n = arr.length;
  const den = n * sxx - sx * sx;
  return den === 0 ? NaN : (n * sxy - sx * sy) / den;
}
const detr = (arr) => {
  const s = slopePerSec(arr);
  const t0 = arr[0]?.t ?? 0;
  return arr.map((c) => c.v - s * ((c.t - t0) / 1000));
};
const restAmp = tail.length > 20 ? q(detr(tail), 0.95) - q(detr(tail), 0.05) : NaN;
p(`- resting breath amplitude (p95−p5 of detrended chest trace, last 15 s of rest): ${f1(restAmp, 4)}; stable samples in that window ${pct(tail.filter((c) => c.s).length / (tail.length || 1))}`);
const BREATH_WINDOW_MS = 1500;
function buildCycles(phaseName) {
const cycles = [];
for (const iv of intervals.filter((x) => x.phase === phaseName)) {
  const speakIv = intervals.find((x) => x.phase === 'speak' && x.i === iv.i);
  // Last mic offset between the start of speaking and 1 s into the pause.
  const off = offsets.filter((t) => t >= (speakIv?.t0 ?? iv.t0 - 3000) && t <= iv.t0 + 1000).at(-1);
  if (off === undefined) {
    cycles.push({ i: iv.i, off: null });
    continue;
  }
  // Trend from the 6 s before the offset; 400 ms slopes in [off, off+1 s].
  const pre = chestU.filter((c) => c.t >= off - 6000 && c.t < off);
  const trend = pre.length > 10 ? slopePerSec(pre) : 0;
  const win = chestU.filter((c) => c.t >= off && c.t <= off + BREATH_WINDOW_MS + 100);
  const slopes = [];
  for (let s = off; s + 400 <= off + BREATH_WINDOW_MS; s += 50) {
    const w = win.filter((c) => c.t >= s && c.t < s + 400);
    const sl = slopePerSec(w) - trend;
    if (Number.isFinite(sl)) slopes.push({ s, sl, stable: w.every((c) => c.s), lastRx: Math.max(...w.map((c) => c.rx)) });
  }
  cycles.push({ i: iv.i, off, slopes, nWin: win.length });
}
return cycles;
}
const cycles = buildCycles('pause');
const controls = buildCycles('exhale');
// Polarity: speech is produced on the out-breath, so the trace direction
// while speaking is "exhale" and an inhale is the opposite sign.
const speakSl = intervals
  .filter((x) => x.phase === 'speak')
  .map((x) => slopePerSec(chestU.filter((c) => c.t >= x.t0 + 500 && c.t < x.t1)))
  .filter(Number.isFinite);
const polarity = -Math.sign(med(speakSl)) || 1;
p(`- trace while speaking (out-breath): median slope ${f1(med(speakSl), 3)}/s, ${pct(speakSl.filter((x) => Math.sign(x) === -polarity).length / (speakSl.length || 1))} of speaking periods agree → inhale = ${polarity > 0 ? 'rising' : 'falling'} trace`);
const thr = 0.35 * restAmp;
let detected = 0;
let withOffset = 0;
let stableDet = 0;
const detT = [];
const detRx = [];
for (const c of cycles) {
  if (c.off === null) continue;
  withOffset++;
  const hit = (c.slopes ?? []).find((s) => s.sl * polarity > thr);
  if (hit) {
    detected++;
    if (hit.stable) stableDet++;
    detT.push(hit.s + 400 - c.off);
    detRx.push(hit.lastRx - c.off);
  }
}
p(`- cycles with a detected speech offset: ${withOffset}/${cycles.length}`);
p(`- inhale detected (400 ms slope > 0.35 resting amplitudes/s) within ${BREATH_WINDOW_MS / 1000} s of offset: **${detected}/${withOffset}** (${pct(detected / (withOffset || 1))}); with stable trace ${stableDet}`);
p(`- ${stats('detection time (window end − offset)', detT)}`);
p(`- ${stats('detection known to app (last sample received − offset)', detRx)}`);
// Control pauses (instructed out-breath): any "inhale" detection is a false alarm.
const ctl = controls.filter((c) => c.off !== null);
const falseAlarms = ctl.filter((c) => (c.slopes ?? []).some((x) => x.sl * polarity > thr)).length;
if (controls.length) p(`- control pauses (breathing out): ${ctl.length}/${controls.length} with a speech offset; false "inhale" detections **${falseAlarms}/${ctl.length}**`);
const faOk = ctl.length === 0 || falseAlarms / ctl.length <= 0.2;
// Primary also needs the cue to be known before the arbiter's earliest end
// (candidate silence 400 ms + release 300 ms = 700 ms after the offset).
const primary = withOffset >= 10 && detected / withOffset >= 0.8 && med(detRx) <= 700 && stableDet / (detected || 1) >= 0.9 && faOk;
p();
p(`**Decision rule:** breath is a primary cue only if ≥ 80% of inhale pauses are detected, the app learns it within 0.7 s (median; the earliest the arbiter can end a turn), ≥ 90% of detections are on stable traces, and ≤ 20% of out-breath control pauses give a false detection.`);
p(`**Breath decision: ${primary ? 'PRIMARY cue' : 'SUPPORTING cue'}**`);
p();
p(`Per-cycle detail:`);
p('```');
for (const c of [...cycles, ...controls]) {
  if (c.off === null) {
    p(`#${c.i}: no mic offset found`);
    continue;
  }
  const best = (c.slopes ?? []).reduce((m, s) => (m === null || s.sl * polarity > m.sl * polarity ? s : m), null);
  p(`#${String(c.i).padStart(2)}: samples ${c.nWin}, best slope ${f1(best ? best.sl / (restAmp || 1) : NaN, 2)} amp/s at +${best ? best.s - c.off : '-'} ms, stable ${best?.stable ?? '-'}`);
}
p('```');

const text = out.join('\n') + '\n';
const reportPath = file.replace(/\.jsonl$/, '.report.md');
writeFileSync(reportPath, text);
console.log(text);
console.log(`Report written to ${reportPath}`);
