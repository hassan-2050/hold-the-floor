# Privacy, consent and data handling

Hold the Floor needs only your own face and upper chest, plus microphone
loudness. It stores nothing unless you save a session, and then only numbers.

## Consent

- Nothing starts before the **Consent** screen. Camera and microphone are separate choices, and the operating system asks again the first time each is used.
- Declining the microphone still works: camera cues decide, and you end each answer with Enter or Send. Declining both leaves a Send-only conversation.
- The consent text names what is measured (lip shape, head direction, breathing movement, whether you appear to be talking, microphone loudness) and what is not (identity, emotion, health, words).
- Only the person who started the session is watched. If SmartSpectra reports more than one face (`MULTIPLE_FACES_FOUND`), camera cues pause at once.

## When the camera and microphone are on

- During **Calibration** and **Conversation**, and in **Setup** only when you press *Test camera* (a preview with a frame-rate check) or *Check readiness* (about 25 s). A *Camera on* / *Mic on* indicator is shown in the top bar whenever either is live.
- **Stop** works everywhere: the Stop button, **Esc** or **F8**, closing the window, and quitting. Each one stops the camera and microphone tracks first (the camera light goes off at once), then stops and destroys the SDK. The stop path has a 1 s budget. On quit, the main process waits for the window to confirm the tracks are stopped (at most 1 s) and then closes the WebSocket server.

## Processing

| Data | Where it is processed | Kept? |
| --- | --- | --- |
| Camera frames | On this computer, by the SmartSpectra SDK (renderer → main process over a private MessagePort) | Never stored or sent by the app |
| Face landmarks, talking flag, breathing traces | In memory, in a 20 s ring buffer for the floor ribbon | Only if you save a session (numbers, a subset of 26 face points) |
| Microphone audio | In an AudioWorklet that computes one loudness number per 20 ms and drops the samples | Audio never; loudness numbers only if you save a session |
| Mic check in Setup (*Record 3 s → Play back*) | In memory, so you can hear that the right mic is selected | Played once, then discarded. Never saved or sent. This is the one time audio is held for more than 20 ms, and only when you press Record |

## Network

- SmartSpectra telemetry is **off**: every SDK instance, including the readiness check, is created with `enableTelemetry: false`. `requestInsight` (which would send text to Presage) is never called.
- The SmartSpectra SDK still **authenticates and checks usage with Presage online** while measuring; there is no offline mode. This happens even with telemetry off.
- The app makes **no other network requests**. The CSP limits the page to its own files, and navigation away from the bundled page is blocked.
- The optional end_of_turn API listens on `127.0.0.1` only, needs a random token, and sends decisions only (see [WS-API.md](WS-API.md)).

## Storage and deletion

All files live in the app data folder, shown in the Privacy sheet:

| OS | Folder |
| --- | --- |
| Windows | `%APPDATA%\hold-the-floor\` |
| macOS | `~/Library/Application Support/hold-the-floor/` |
| Linux | `~/.config/hold-the-floor/` |

| File | Contents | How to delete |
| --- | --- | --- |
| `settings.json` | Your settings (timings, cue toggles, voice, chosen devices) | Delete the file, or the folder |
| `secrets/api-key.bin` | Your Presage API key, encrypted with Electron `safeStorage` (Windows DPAPI, macOS Keychain, Linux libsecret) | Setup → *Remove key* |
| `sessions/*.jsonl` | Saved sessions: numbers only (see below) | Results or Privacy → *Delete*, or Privacy → *Delete all sessions* |

`debug.log` exists only if you start the app with `--htf-debug` (`npm run start:debug`). It is a troubleshooting log of event names, SmartSpectra status codes and hints, frame counts per second, calibration summaries (resting lip-gap and lip-height numbers), cue states and timings. It contains no face points, video, audio or key, and is overwritten at each debug start.

The SDK also keeps its own model cache under the OS cache folder (`SmartSpectraSDK/` inside the app's cache directory). It holds no personal data.

A saved session is JSON lines of: frame times; x/y for 26 face points (lips, eye corners, nose, chin); talking flags; chest-trace values; breathing-rate confidence; SDK validation codes; loudness numbers; question texts; and your key presses (Send, Space, "I wasn't finished"). It never contains video, audio, the full face mesh, device names or your key. Unsaved sessions vanish when you close the app.

## API key

- Entered in Setup, encrypted at rest by the main process, never written in plain text.
- It leaves the main process only to construct the SmartSpectra SDK (the renderer SDK forwards constructor options to the main process). It is never put in React state, the store, browser storage, logs or recordings. An end-to-end test checks it is absent from `localStorage`, `sessionStorage` and IndexedDB, and absent in plain text from the key file.
- For development, a git-ignored `.env` (`SMARTSPECTRA_API_KEY=`) can be imported once from Setup in non-packaged builds.

## Demo mode (`npm run demo`)

A separate tool for making the demo video, never active in a normal start. It records the app's own window, the system audio and the microphone into an MP4 in your Videos folder from the moment the app opens. A script window above the app shows **● REC** the whole time and has a Stop button. The video stays on your computer; the app never uploads it. Because this recording contains video and audio, it is outside the product's numbers-only guarantee. Use it only for your own demo.

## What the app never does

It does not identify you, infer emotions or health, transcribe or judge speech, or detect, rate or treat stuttering or any other condition. It decides only when the agent may reply.
