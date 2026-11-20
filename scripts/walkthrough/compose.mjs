// Walkthrough video, step 2: title cards, narration, captions and the edit.
//
// Builds a narrated 1920x1080 video from a capture.mjs folder: title cards,
// the Welcome screen, the replayed session with captions, and the Results
// screen. Narration lines start at the engine events they describe (read
// from the capture's own event log); where a line needs longer than the
// moment lasts, the picture pauses and the caption says "Paused to explain".
// The voice is a built-in Windows voice (tts.ps1): nothing is sent anywhere.
//
//   node scripts/walkthrough/compose.mjs <capture-dir> <out.mp4>
//
// Needs Windows, and ffmpeg and ffprobe on PATH.
import electronBin from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cap = resolve(process.argv[2] ?? 'walkthrough-capture');
const outFile = resolve(process.argv[3] ?? 'walkthrough.mp4');
const work = join(cap, 'compose');
for (const d of ['cards', 'voice', 'pieces']) mkdirSync(join(work, d), { recursive: true });

const W = 1920;
const H = 1080;
const FPS = 30;
const BG = '#0A3B3F';
const APP = { w: 1632, h: 918, x: 144, y: 18 };
const BAND = { y: 944, h: 136 };

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 }).toString();
const ff = (args) => sh('ffmpeg', ['-v', 'error', '-y', ...args]);
const duration = (file) => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).trim());
const slash = (p) => p.replace(/\\/g, '/');
const frame = (t) => Math.round(t * FPS) / FPS;
const s3 = (n) => n.toFixed(3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- Narration ---------------------------------------------------------------
// `say` is spoken; `cap` (if different) is the caption.
const LINES = {
  title: { say: "Hold the Floor: a voice agent that can see you're not finished yet." },
  problem: {
    say: 'Voice assistants end your turn after a fixed silence. Pause to think, take a breath, or search for a word, and they cut in. A longer timer is safer, but every reply gets slower.',
  },
  cues: {
    say: 'Here, the microphone finds each silence, and the camera tells a pause from an ending. With Presage SmartSpectra, the app reads four cues: lips pressed or set for the next word, still talking, breathing in, and head turned away. While any cue is on, the agent waits, for up to eight seconds.',
  },
  welcome: { say: 'You can try it without a camera or a key. Watch replay runs a recorded live session, saved as numbers only, through the same engine.' },
  layout: {
    say: 'On the left, a fixed two-second timer runs in the shadow. On the right, Hold the Floor drives the agent. The cue lights are on the side, and the last twenty seconds run along the bottom.',
  },
  answer1: { say: 'A normal answer gets a reply within a second.' },
  block: { say: 'A pause mid-sentence, with the lips set for the next word. The two-second timer would have cut in here. Hold the Floor holds.' },
  resume: { say: 'The answer goes on, and the reply comes 0.7 seconds after it really ends.' },
  search: { say: 'A search for a word: a three-second pause. Even a three-second timer would have cut in.' },
  cover: { say: "With the camera covered, the cues pause, and it falls back to a plain two-second timer. It never guesses a cue it can't see." },
  results: { say: 'Every policy is scored on the same session. Hold the Floor replied after a median of one second, with no cut-offs.' },
  table: { say: 'The short timers reply fast, but cut in. Only the four-second timer also avoided cut-offs, at four times the wait.' },
  privacy: {
    say: 'The camera and microphone start only after you agree, and Escape turns them off at once. SDK telemetry is off. Nothing is saved unless you choose, and then only numbers: no video and no audio.',
  },
  end: { say: 'Hold the Floor is open source. The code and setup are linked in the post.' },
};
const ids = Object.keys(LINES);
writeFileSync(join(work, 'lines.json'), JSON.stringify(ids.map((id) => ({ id, text: LINES[id].say }))));
if (ids.some((id) => !existsSync(join(work, 'voice', `${id}.wav`)))) {
  sh('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'tts.ps1'), join(work, 'lines.json'), join(work, 'voice'), 'Zira', '1.0']);
}
const D = Object.fromEntries(ids.map((id) => [id, duration(join(work, 'voice', `${id}.wav`))]));

// ---- Capture: frames -> constant 30 fps video, event times ---------------------
const frames = JSON.parse(readFileSync(join(cap, 'frames.json'), 'utf8'));
const marksMs = JSON.parse(readFileSync(join(cap, 'marks.json'), 'utf8'));
const v0 = frames[0].ts * 1000;
const vt = (ms) => (ms - v0) / 1000;
const M = Object.fromEntries(Object.entries(marksMs).map(([k, v]) => [k, vt(v)]));
const events = readFileSync(join(cap, 'events.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((l) => l.ev === 'event')
  .map((l) => ({ ...l, vt: vt(Date.parse(l.at)) }));
const at = (what, pred) => {
  const e = events.find(pred);
  if (!e) throw new Error(`event not found: ${what}`);
  return e.vt;
};
const T = {
  click: M['replay-click'],
  answer1End: at('answer 1 reply', (e) => e.type === 'turn.end' && e.turn === 2),
  blockTimer: at('2 s timer in answer 2', (e) => e.type === 'shadow.end' && e.policy === 'fixed-2000' && e.turn === 3),
  blockResume: at('answer 2 resumes', (e) => e.type === 'shadow.cutoff' && e.turn === 3),
  searchTimer: at('3 s timer in answer 3', (e) => e.type === 'shadow.end' && e.policy === 'fixed-3000' && e.turn === 4),
  cover: at('camera covered', (e) => e.type === 'quality.fallback' && e.vt > M['replay-click'] + 5),
  lastEnd: at('answer 5 reply', (e) => e.type === 'turn.end' && e.turn === 6),
  scroll: M['results-scroll'],
  table: M['results-table'],
  end: M.end,
};
console.log('event times (s):', Object.entries(T).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));

const capture = join(work, 'capture.mp4');
if (!existsSync(capture)) {
  // A few screencast frames arrive with a timestamp at or before the previous
  // one; they would be on screen for no time. Keeping strictly increasing
  // times makes this video's clock equal the screencast's, so events line up.
  const kept = [];
  for (const f of frames) if (!kept.length || f.ts > kept.at(-1).ts) kept.push(f);
  const list = [];
  kept.forEach((f, i) => {
    const next = i + 1 < kept.length ? kept[i + 1].ts : marksMs.end / 1000;
    list.push(`file '${slash(join(cap, 'frames', `${String(f.i).padStart(6, '0')}.jpg`))}'`, `duration ${(next - f.ts).toFixed(6)}`);
  });
  list.push(list.at(-2));
  writeFileSync(join(work, 'frames.txt'), list.join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'), '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', capture]);
}

// ---- Cards and captions (HTML -> PNG) -----------------------------------------
const fontUrl = (pkg, weight) => {
  const dir = join(root, 'node_modules', '@fontsource', pkg, 'files');
  const file = readdirSync(dir).find((f) => f.endsWith(`-latin-${weight}-normal.woff2`));
  return pathToFileURL(join(dir, file)).href;
};
const CSS = `
@font-face { font-family: AHN; font-weight: 400; src: url('${fontUrl('atkinson-hyperlegible-next', 400)}') format('woff2'); }
@font-face { font-family: AHN; font-weight: 700; src: url('${fontUrl('atkinson-hyperlegible-next', 700)}') format('woff2'); }
@font-face { font-family: AHM; font-weight: 400; src: url('${fontUrl('atkinson-hyperlegible-mono', 400)}') format('woff2'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: ${BG}; color: #fff; font-family: AHN, sans-serif; }
.card { position: absolute; inset: 0; padding: 110px 170px; display: flex; flex-direction: column; justify-content: center; gap: 34px; }
h1 { font-size: 112px; line-height: 1.05; font-weight: 700; }
h2 { font-size: 70px; line-height: 1.12; font-weight: 700; }
.lead { font-size: 44px; line-height: 1.32; color: #D7E6E2; max-width: 1540px; }
.small { font-size: 30px; line-height: 1.4; color: #9DBDB6; }
.mono { font-family: AHM, monospace; }
.code { font-size: 44px; color: #fff; background: rgba(255,255,255,0.08); border-radius: 18px; padding: 18px 30px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 60px; margin-top: 8px; }
.cue { display: flex; align-items: center; gap: 28px; }
.cue .ic { flex: none; width: 104px; height: 104px; border-radius: 50%; border: 4px solid #E0A100; display: grid; place-items: center; }
.cue b { display: block; font-size: 40px; line-height: 1.2; }
.cue span { display: block; font-size: 30px; line-height: 1.3; color: #9DBDB6; }
.chips { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 14px; }
.chips span { font-size: 30px; padding: 12px 26px; border-radius: 999px; background: #F6E3B0; color: #142024; font-weight: 700; }
ul.checks { list-style: none; display: grid; gap: 30px; margin-top: 10px; }
ul.checks li { font-size: 42px; line-height: 1.32; color: #EAF2EF; padding-left: 74px; position: relative; max-width: 1560px; }
ul.checks li::before { content: ''; position: absolute; left: 0; top: 8px; width: 40px; height: 22px; border-left: 7px solid #E0A100; border-bottom: 7px solid #E0A100; transform: rotate(-45deg); }
`;
const logo = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 48 48"><rect x="4" y="18" width="16" height="14" rx="7" fill="#F3F6F4"/><rect x="28" y="18" width="16" height="14" rx="7" fill="#F3F6F4"/><path d="M14 17 C 18 6, 30 6, 34 17" fill="none" stroke="#E0A100" stroke-width="3" stroke-linecap="round"/></svg>`;
const icon = (paths) => `<div class="ic"><svg width="60" height="60" viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></div>`;
const page = (body, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${extra}</style></head><body>${body}</body></html>`;

const CARDS = {
  title: page(`<div class="card">${logo(150)}<h1>Hold the Floor</h1><p class="lead">A voice agent that can see you're not finished yet.</p>
    <p class="small" style="margin-top:36px">Built with the Presage SmartSpectra SDK · runs on your own computer</p></div>`),
  problem: page(`<div class="card"><h2>Fixed silence timers cut people off</h2>
    <svg width="1580" height="330" viewBox="0 0 1580 330" font-family="AHN" font-size="31">
      <text x="826" y="50" text-anchor="middle" fill="#fff" font-weight="700">2 s timer: "your turn is over"</text>
      <line x1="826" y1="72" x2="826" y2="300" stroke="#fff" stroke-width="4" stroke-dasharray="10 10"/>
      <rect x="0" y="140" width="540" height="86" rx="43" fill="#F3F6F4"/>
      <text x="270" y="194" text-anchor="middle" fill="#142024">"On the way I pass a bakery, and..."</text>
      <rect x="560" y="140" width="400" height="86" rx="43" fill="none" stroke="#E0A100" stroke-width="4" stroke-dasharray="14 12"/>
      <text x="690" y="194" text-anchor="middle" fill="#E0A100">thinking...</text>
      <text x="690" y="282" text-anchor="middle" fill="#E0A100" font-size="28">a 3 s pause</text>
      <rect x="980" y="140" width="600" height="86" rx="43" fill="#F3F6F4"/>
      <text x="1280" y="194" text-anchor="middle" fill="#142024">"...a small bookshop with a green door."</text>
    </svg>
    <p class="lead">A longer timer cuts in less often, but every reply waits longer.</p></div>`),
  cues: page(`<div class="card" style="gap:26px"><h2>The camera tells a pause from an ending</h2>
    <p class="lead" style="font-size:36px">The microphone finds each silence. Presage SmartSpectra supplies four signs that you are still mid-turn:</p>
    <div class="grid">
      <div class="cue">${icon('<path d="M7 24c6-7 12-9 17-6 5-3 11-1 17 6-6 7-11 9-17 9S13 31 7 24z"/><path d="M8 24h32"/>')}<div><b>Lips pressed or set</b><span>for the next word · face landmarks</span></div></div>
      <div class="cue">${icon('<path d="M10 11h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H23l-9 7v-7h-4a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4z"/>')}<div><b>Still talking</b><span>talking signal + mouth movement</span></div></div>
      <div class="cue">${icon('<path d="M6 17c5 0 7-4 12-4s7 4 12 4 7-3 12-3"/><path d="M6 26c5 0 7-4 12-4s7 4 12 4 7-3 12-3"/><path d="M6 35c5 0 7-4 12-4s7 4 12 4 7-3 12-3"/>')}<div><b>Breathing in</b><span>chest breathing trace</span></div></div>
      <div class="cue">${icon('<circle cx="21" cy="19" r="10"/><path d="M31 18l6 3-6 3"/><path d="M9 42c2-7 7-11 12-11s10 4 12 11"/>')}<div><b>Head turned away</b><span>face landmarks</span></div></div>
    </div>
    <p class="chips"><span>Any cue on → wait (up to 8 s)</span><span>Cues relaxed → reply</span><span>Camera unclear → plain 2 s timer</span></p></div>`),
  privacy: page(`<div class="card"><h2>Private by design</h2><ul class="checks">
    <li>Camera and microphone start only after you agree. Esc turns them off at once.</li>
    <li>SmartSpectra telemetry is off.</li>
    <li>Nothing is saved unless you choose, and then only numbers: no video, no audio.</li>
    <li>A conversation tool: no health, emotion or diagnosis claims.</li></ul></div>`),
  end: page(`<div class="card">${logo(120)}<h1 style="font-size:96px">Hold the Floor</h1>
    <p class="lead">Open source (MIT). Try it without a camera or a key:</p>
    <p class="mono code">npm install  →  npm run start:replay</p>
    <p class="small">Presage SmartSpectra SDK Challenge 2026 · code and setup are linked in the post</p></div>`),
};

const PAUSE_ICON = '<svg width="22" height="26" viewBox="0 0 22 26"><rect x="0" y="0" width="7" height="26" rx="2" fill="#E0A100"/><rect x="15" y="0" width="7" height="26" rx="2" fill="#E0A100"/></svg>';
const caption = (text, paused) =>
  page(
    `${paused ? `<span class="p">${PAUSE_ICON} Paused to explain</span>` : ''}<p class="c">${esc(text).replace(/(\w)-(\w)/g, '$1‑$2')}</p>`,
    `body { display: flex; align-items: center; justify-content: center; }
     .c { font-size: 40px; line-height: 54px; text-align: center; max-width: ${paused ? 1180 : 1560}px; }
     .p { position: absolute; left: 40px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 14px;
          border: 3px solid #E0A100; color: #E0A100; border-radius: 999px; padding: 10px 24px; font-size: 26px; font-weight: 700; }`,
  );

// ---- Timeline -------------------------------------------------------------------
const pieces = [];
const clips = [];
const named = {};
let outT = 0;
const addCard = (name, d) => {
  const dd = frame(d);
  pieces.push({ kind: 'card', name, d: dd });
  named[name] = outT;
  outT += dd;
};
const addClip = (a, b) => {
  const [fa, fb] = [frame(a), frame(b)];
  pieces.push({ kind: 'clip', a: fa, d: fb - fa });
  clips.push({ a: fa, b: fb, out: outT });
  outT += fb - fa;
};
const addFreeze = (name, t, d) => {
  const dd = frame(d);
  pieces.push({ kind: 'freeze', t: frame(t), d: dd });
  named[name] = outT;
  outT += dd;
};
const mapT = (t) => {
  const c = clips.find((s) => t >= s.a && t <= s.b);
  if (!c) throw new Error(`time ${t} is not inside a clip`);
  return c.out + (t - c.a);
};

const voice = [];
const say = (id, t, caption = true, paused = false) => voice.push({ id, t, caption, paused });

// Cards: lead-in 0.7 s, then the line, then 0.9 s.
addCard('title', 0.7 + D.title + 1.0);
say('title', named.title + 0.7, false);
addCard('problem', 0.7 + D.problem + 1.0);
say('problem', named.problem + 0.7, false);
addCard('cues', 0.7 + D.cues + 1.2);
say('cues', named.cues + 0.7, false);

// Welcome, then the replay up to the moment the 2 s timer has fired in answer 2.
const freezeBlock = T.blockTimer + 0.4;
addClip(Math.max(0.5, T.click - 0.7 - D.welcome - 1.0), freezeBlock);
say('welcome', mapT(T.click - 0.4 - D.welcome));
say('layout', mapT(T.click + 0.8));
say('answer1', mapT(T.answer1End + 0.15));
addFreeze('block', freezeBlock, D.block + 1.0);
say('block', named.block + 0.4, true, true);
// Answer 3: pause just after the 3 s timer fires, before speech resumes.
const freezeSearch = T.searchTimer + 0.1;
addClip(freezeBlock, freezeSearch);
say('resume', mapT(T.blockResume + 0.3));
addFreeze('search', freezeSearch, D.search + 0.9);
say('search', named.search + 0.3, true, true);
addClip(freezeSearch, T.lastEnd + 1.6);
say('cover', mapT(T.cover + 0.1));

// Results: the first frame of the scroll shows the top of the Results screen
// (the screencast can drop a single repaint, so the screen's first paint may
// be missing). Use that frame's own time, a little after the scroll mark.
const firstScroll = frames.find((f) => f.ts * 1000 >= marksMs['results-scroll']);
const top = vt(firstScroll.ts * 1000) + 0.05;
addFreeze('results', top, 0.6 + D.results + 0.8);
say('results', named.results + 0.6);
addClip(top, Math.min(T.end, T.table + D.table + 2.0));
say('table', mapT(T.scroll + 0.6));

addCard('privacy', 0.7 + D.privacy + 1.2);
say('privacy', named.privacy + 0.7, false);
addCard('end', 0.7 + D.end + 2.2);
say('end', named.end + 0.7, false);
const total = outT;

// No overlapping lines: push a line later if the previous one is still going.
voice.sort((a, b) => a.t - b.t);
for (let i = 1; i < voice.length; i++) {
  const prevEnd = voice[i - 1].t + D[voice[i - 1].id] + 0.3;
  if (voice[i].t < prevEnd) {
    console.log(`note: "${voice[i].id}" moved ${(prevEnd - voice[i].t).toFixed(2)} s later`);
    voice[i].t = prevEnd;
  }
}
const captions = voice.filter((v) => v.caption).map((v) => ({ ...v, from: v.t, to: v.t + D[v.id] + 0.4 }));

// ---- Render cards and captions --------------------------------------------------
const jobs = [];
for (const [name, html] of Object.entries(CARDS)) {
  writeFileSync(join(work, 'cards', `${name}.html`), html);
  jobs.push({ html: join(work, 'cards', `${name}.html`), out: join(work, 'cards', `${name}.png`), width: W, height: H });
}
for (const c of captions) {
  const l = LINES[c.id];
  writeFileSync(join(work, 'cards', `cap-${c.id}.html`), caption(l.cap ?? l.say, c.paused));
  jobs.push({ html: join(work, 'cards', `cap-${c.id}.html`), out: join(work, 'cards', `cap-${c.id}.png`), width: W, height: BAND.h });
}
writeFileSync(join(work, 'jobs.json'), JSON.stringify(jobs));
sh(electronBin, [join(here, 'render.mjs'), join(work, 'jobs.json')]);

// ---- Render pieces and join them ------------------------------------------------
const ENC = ['-r', String(FPS), '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-an'];
const FRAMED = `scale=${APP.w}:${APP.h}:flags=lanczos,pad=${W}:${H}:${APP.x}:${APP.y}:color=0x${BG.slice(1)},setsar=1,format=yuv420p`;
const list = pieces.map((p, i) => {
  const f = join(work, 'pieces', `${String(i).padStart(2, '0')}-${p.kind}.mp4`);
  if (p.kind === 'card') {
    const fade = `fade=t=in:st=0:d=0.35,fade=t=out:st=${s3(p.d - 0.35)}:d=0.35`;
    ff(['-loop', '1', '-framerate', String(FPS), '-t', s3(p.d), '-i', join(work, 'cards', `${p.name}.png`), '-vf', `format=yuv420p,${fade}`, ...ENC, f]);
  } else if (p.kind === 'clip') {
    ff(['-ss', s3(p.a), '-i', capture, '-t', s3(p.d), '-vf', FRAMED, ...ENC, f]);
  } else {
    const still = join(work, 'pieces', `${String(i).padStart(2, '0')}-still.png`);
    ff(['-ss', s3(p.t), '-i', capture, '-frames:v', '1', '-update', '1', still]);
    ff(['-loop', '1', '-framerate', String(FPS), '-t', s3(p.d), '-i', still, '-vf', FRAMED, ...ENC, f]);
  }
  return `file '${slash(f)}'`;
});
writeFileSync(join(work, 'pieces.txt'), list.join('\n'));
const joined = join(work, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'pieces.txt'), '-c', 'copy', joined]);

// ---- Captions over the band, narration mixed in -----------------------------------
const inputs = ['-i', joined];
for (const v of voice) inputs.push('-i', join(work, 'voice', `${v.id}.wav`));
for (const c of captions) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', s3(total), '-i', join(work, 'cards', `cap-${c.id}.png`));
const graph = [];
let vLabel = '0:v';
captions.forEach((c, k) => {
  const input = 1 + voice.length + k;
  graph.push(`[${vLabel}][${input}:v]overlay=0:${BAND.y}:enable='between(t,${s3(c.from)},${s3(c.to)})'[v${k}]`);
  vLabel = `v${k}`;
});
voice.forEach((v, k) => graph.push(`[${1 + k}:a]aresample=48000,adelay=delays=${Math.round(v.t * 1000)}:all=1[a${k}]`));
graph.push(
  `${voice.map((_, k) => `[a${k}]`).join('')}amix=inputs=${voice.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad[aout]`,
);
ff([
  ...inputs,
  '-filter_complex',
  graph.join(';'),
  '-map',
  `[${vLabel}]`,
  '-map',
  '[aout]',
  '-t',
  s3(total),
  '-r',
  String(FPS),
  '-c:v',
  'libx264',
  '-crf',
  '18',
  '-preset',
  'slow',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  '-movflags',
  '+faststart',
  outFile,
]);
writeFileSync(join(work, 'timeline.json'), JSON.stringify({ total, T, named, voice: voice.map((v) => ({ ...v, d: D[v.id] })), pieces }, null, 2));
console.log(`wrote ${outFile} (${total.toFixed(1)} s)`);
