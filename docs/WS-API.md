# end_of_turn WebSocket API

Hold the Floor can tell any local voice agent when the user's turn is over,
so the agent replies at the right moment instead of after a fixed silence.

- **Where:** `ws://127.0.0.1:<port>/?token=<token>`. It listens on the loopback address only; other computers cannot connect.
- **Turn on:** Settings → *end_of_turn API*. The sheet shows the full URL with a fresh random port and a 128-bit token. Both change every time the API starts.
- **Auth:** a missing or wrong token is refused (HTTP 401). Connections that carry a web-page `Origin` are refused, so browsers cannot listen in.
- **Direction:** server → client only. Messages from clients are ignored (max 4 KB).
- **Content:** decisions only. **No camera frames, landmarks, breathing values, audio or loudness** are ever sent.

## Messages

Every message is one JSON object with a `type`. Times `t` are epoch milliseconds.

| type | fields | meaning |
| --- | --- | --- |
| `hello` | `api: "hold-the-floor/end_of_turn"`, `version: 1` | sent once on connect |
| `session.start` | `t`, `oracle` | a conversation began |
| `agent.speaking` | `t`, `speaking` | the built-in interviewer started or stopped talking (the mic is ignored meanwhile) |
| `turn.hold` | `t`, `cue` (`lips` \| `talking` \| `breath` \| `head`), `detail` (e.g. `pressed`, `set`) | the user is silent but still mid-turn: **do not reply yet** |
| `turn.resume` | `t` | the user started speaking again during a hold |
| `turn.end` | `t`, `reason`, `policy`, `silenceMs`, `turn` | **reply now** |
| `quality.fallback` | `t`, `reason`, `hint` | camera cues paused; a fixed silence timer decides until restored |
| `quality.restored` | `t` | camera cues are back |
| `session.stop` | `t` | the session ended |

`turn.end.reason` is one of `cues-relaxed` (a hold ended), `no-cue` (silence with no hold), `hard-cap` (the longest hold was reached), `send` (the user pressed Enter or Send), `fallback-timer` (camera cues were paused) or `oracle` (test mode: the user pressed Space). `policy` is `hold-the-floor`, `fallback-timer` or `oracle`.

Example sequence for "I went to the… *(3 s pressed-lip block)* …market":

```json
{"type":"turn.hold","t":1795200001470,"cue":"lips","detail":"pressed"}
{"type":"turn.resume","t":1795200004010}
{"type":"turn.end","t":1795200006720,"reason":"no-cue","policy":"hold-the-floor","silenceMs":700,"turn":3}
```

## Example client (20 lines)

[`examples/ws-client.mjs`](../examples/ws-client.mjs):

```js
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
```

Run it from the project folder with `node examples/ws-client.mjs "<url from Settings>"`. It uses the `ws` package the app already depends on.

## Notes for agent builders

- Hold the Floor uses its own microphone loudness detector to know when the user is silent. Your agent can keep its own speech recognition; use `turn.end` as the "speak now" signal.
- While your agent talks, tell users to wear headphones, or the agent's voice may be heard as the user.
- The built-in interviewer emits `agent.speaking`. An external agent should stop listening while it speaks too (half-duplex), as the built-in one does.
- Implementation: `electron/main/ws.ts` (server) and `src/app/session.ts` (`wsSend`). Tested in `tests/e2e/app.spec.ts`.
