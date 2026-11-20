# Demo recording

`npm run demo` starts the app in **demo mode**:

- **Recording starts as soon as the app opens.** It captures the app's own page (no desktop, taskbar or other windows), the system audio (the agent's voice) and your microphone, as an MP4 in your **Videos** folder (`Hold the Floor demo <date>.mp4`).
- **A script window is docked above the app.** For each part of the demo it shows what to **SAY** (lines and answers to read) and what to **DO** (for example *PRESS YOUR LIPS TOGETHER for 3 seconds*). It follows the app on its own, and it is **not** in the recording.
- The script window shows **● REC** with a timer and a **Stop recording** button. Closing the app also stops and saves the recording.
- For this run only, the app turns on the side-by-side comparison, turns off oracle mode and uses the *Places* questions. Your saved settings are not changed.
- The debug log is on too, so anything odd can be checked afterwards.

Demo mode is a tool for making the video. A normal `npm start` never records anything, and nothing is uploaded. Publishing the video is up to you.

## Before you start

- **Plug in the charger** and set Windows *Settings → System → Power & battery → Power mode* to **Best performance**, with *Energy saver* off. SmartSpectra stops below 25 camera frames per second ("frame rate stayed too low"). On battery, and while recording, a laptop can drop below that: on the test laptop, recording on battery cut face tracking from ~30 to 16–20 frames per second. Demo mode already uses the lighter 960×540 camera size and records at 20 fps to leave headroom.
- **If it still stops:** run `npm run demo:script` instead. That gives the same script window with no in-app recording, and you record with Windows Game Bar (`Win + G` → Capture → microphone on, then `Win + Alt + R`). Game Bar encodes in a separate process using the graphics hardware.
- Sit back so your shoulders and upper chest are in the picture, with light in front of you and nobody else in view.
- Headphones keep the agent's voice out of your microphone. The recording still gets the agent through system audio.
- Close other apps that use the camera.

## The seven parts (the script window walks you through them)

| Part | Screen | What happens |
| --- | --- | --- |
| 1 | Welcome | Read the opening lines, click **Start** |
| 2 | Consent | Read the privacy lines, click **Agree and continue** |
| 3 | Setup | **Check readiness** (~25 s; trim the wait later), **Continue to calibration** |
| 4 | Calibration | **Begin** when Lips and Head say *seen*: rest 10 s, press lips **firmly** 5 s (press just as firmly in answer 2), read the warm-up answer, **I've answered**, **Start the conversation** |
| 5 | Conversation | Answer 1 normally (quick reply); answer 2 with a **3 s pressed-lip block** (left: *Would have cut in here*, right: *Holding — lips pressed*); answer 3 stopping with **lips slightly open and still** (*Holding — lips set*) |
| 6 | Conversation | Answer 4 while **covering the camera** for ~4 s and **talking the whole time** (*Camera cues paused*), then **Esc** to stop sensing |
| 7 | Results | **End and see results**, read the line, **Save numbers** as *Demo session*, then close the app to finish the recording |

Keep parts 5–6 unedited: they are the live session the judges care about.

## Wording to avoid

Do not say the app detects, measures, rates or treats stuttering (or any
condition), or that it reads emotions. It only decides when the agent may
reply. It has not yet been tested by people who stutter; the pressed-lip
pause stands in for a silent block.

## Afterwards

- The video is in your Videos folder.
- The saved *Demo session* (numbers only) can become the bundled replay, so judges see the same conversation without a camera:
  `node scripts/make-fixture.mjs "%APPDATA%\hold-the-floor\sessions\<file>.jsonl" fixtures/sessions/demo-session.jsonl --label "Demo session"`

## Narrated walkthrough (made from the replay)

A second video explains the app over the bundled replay. Nothing in it is recorded from a camera or microphone: the footage is the app replaying `fixtures/sessions/demo-session.jsonl`, and the narration is a built-in Windows voice. It is made in two steps (Windows, with `ffmpeg` and `ffprobe` on PATH):

```bash
npm run build
node scripts/walkthrough/capture.mjs <dir>            # ~2 min, the app goes full screen
node scripts/walkthrough/compose.mjs <dir> <out.mp4>  # title cards, narration, captions
```

- **capture.mjs** opens the built app with a throwaway data folder, shows Welcome, presses *Watch replay* and scrolls the Results screen. It records only the app page, through the DevTools screencast, so no recorder, script window, desktop or mouse pointer can appear. The page is laid out at 1280×720 and rendered at 1.5× for 1920×1080 frames. It also keeps the run's own event log.
- **compose.mjs** starts each narration line at the engine event it describes, read from that log (for example the moment the 2 s timer would have cut in). Where a line needs more time than the moment lasts, the picture pauses and the caption says *Paused to explain*. Captions repeat the narration.
