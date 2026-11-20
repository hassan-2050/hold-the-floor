// Minimal end_of_turn client (20 lines). Usage:
//   node examples/ws-client.mjs "ws://127.0.0.1:PORT/?token=TOKEN"
// Copy the URL from Settings → end_of_turn API in Hold the Floor.
import WebSocket from 'ws';

const url = process.argv[2];
if (!url) throw new Error('Pass the ws:// URL shown in Settings.');
const ws = new WebSocket(url);

ws.on('open', () => console.log('connected'));
ws.on('message', (data) => {
  const ev = JSON.parse(String(data));
  if (ev.type === 'turn.hold') console.log(`holding (${ev.cue}: ${ev.detail}) - do not reply yet`);
  if (ev.type === 'turn.resume') console.log('user resumed speaking');
  if (ev.type === 'turn.end') console.log(`turn ended (${ev.reason}) after ${ev.silenceMs} ms of silence - reply now`);
  if (ev.type === 'quality.fallback') console.log(`camera cues paused: ${ev.hint}`);
  if (ev.type === 'quality.restored') console.log('camera cues back');
});
ws.on('close', (code) => console.log('closed', code));
