# Results

Status, 20 Nov 2026: technical validation and replay results are in. The live
oracle self-test (30 answers) and real-camera checks are **not yet run**;
sections marked *pending* say how to run them. No numbers in this file are
estimated or filled in.

## 1. Method

- **Hardware:** HP laptop, Intel i5-13420H, Windows 11, built-in HP Wide Vision HD Camera (≈25 fps), built-in Intel Smart Sound microphone array.
- **SDK:** `@smartspectra/node-sdk` 3.5.0, telemetry off, metrics = breathing bundle + face landmarks + talking.
- **Policies compared on the same input:** Hold the Floor (the arbiter) against fixed silence timers of 0.7, 2, 3 and 4 s. The fixed timers never drive the agent; they are replayed on the same mic and camera numbers ("shadow timers").
- **Measures:**
  - *Cut-off* (plan definition): a policy ended the turn and the user resumed speaking within 2.5 s.
  - *Premature end* (oracle mode only, ground truth): a policy ended the turn and the user went on speaking before pressing Space, however long the pause.
  - *Reply delay*: end time − last speech offset. For a fixed timer this equals its length.
- **Determinism:** live sessions and replays run through the same `Engine`. A replay of a recording gives identical events; a unit test checks this.

## 2. Stage 1 technical validation (real camera)

Full details are in [SDK-NOTES.md](SDK-NOTES.md). Highlights from two probe runs:

| Check | Result |
| --- | --- |
| Device readiness | `ready` ("Qualified…"), 24–27 s; once `inconclusive` (network) then `ready` on retry |
| Metrics after `start()` | first packet 1.2 s (target < 5 s) |
| Landmark order | MediaPipe Face Mesh confirmed (9 of 9 geometry checks) |
| Delivery delay (frame → app) | landmarks 32 ms, talking 61 ms, chest 57 ms (medians, chest in view) |
| Frame rate | ≈25 fps (the SDK minimum); one session ended with `kSustainedLowFrameRate` in dim light |
| Chest not in view (code 7) | **no landmarks at all** while it lasts, so framing is coached in Setup and Calibration |
| SDK talking flag | 0% true while counting aloud, so visible talking comes from mouth movement instead |
| Breath polarity | rising = inhale (20/20 instructed inhales rose; speaking periods fell 85%) |
| Stop | tracks + SDK stop + destroy in 118–131 ms (target < 1 s) |

## 3. Replay of the recorded protocol (bundled fixture)

`fixtures/sessions/probe-protocol.jsonl` is probe run 2: 35 s rest, 5 s pressed lips, then 20 cycles of counting aloud followed by a 2.5 s "stop and breathe in" prompt, then 6 control cycles with a "breathe out" prompt. Replayed in oracle mode as one long turn, so every pause is a mid-turn pause.

| Policy | Cut-offs | Premature ends | Median reply delay |
| --- | ---: | ---: | ---: |
| **Hold the Floor** | **5** | **27** | **0.73 s** |
| 0.7 s timer | 7 | 28 | 0.70 s |
| 2.0 s timer | 23 | 24 | 2.00 s |
| 3.0 s timer | 20 | 20 | 3.00 s |
| 4.0 s timer | 6 | 6 | 4.00 s |

Ablation (`npm run ablation`), Hold the Floor only:

| Variant | Cut-offs | Premature ends | Holds lips/talk/breath/head |
| --- | ---: | ---: | --- |
| all cues | 5 | 27 | 4/2/1/0 |
| no lips | 5 | 27 | 0/2/1/0 |
| no talking | 5 | 27 | 4/0/1/0 |
| no breath | 6 | 28 | 4/2/0/0 |
| no head | 5 | 27 | 4/2/1/0 |
| no camera cues | 6 | 28 | 0/0/0/0 |

**Reading this honestly.** On this recording the cues barely help: Hold the Floor behaves almost like the 0.7 s timer. Most protocol pauses were 3.5–4 s long (you finished counting, then waited for the prompt). There were no pressed or "set" lips, and the inhale arrived about 1–2.5 s after you stopped speaking. That came mostly after the arbiter's earliest decision (0.7 s), because people waited for the "breathe in" prompt. The "5 cut-offs" figure looks better than the 2 s timer's 23 only because the 2.5 s cut-off window does not count long pauses. The premature-end column is the fair comparison, and there the gain is 1 pause. This recording is a sensor validation, not a test of mid-turn holding. It is bundled so the app runs without a key, and its numbers are not offered as evidence that the method works.

What it did change in the design: breath cannot hold alone for more than 1.5 s per pause (ordinary resting inhales pass the plan's 0.35 slope threshold), and talking uses mouth movement rather than the SDK flag.

## 4. Automated tests

| Suite | Count | Result |
| --- | ---: | --- |
| Unit (Vitest): every arbiter transition, shadow timers, mic detector, lips/head/breath/talking extractors, calibration (incl. slow-camera grading), quality gate, engine scenarios, results, replay determinism, SDK error mapping | 93 | pass |
| End-to-end (Playwright, Electron, no camera): replay mode, keyboard-only flow, settings, Delete all, key encryption and absence from renderer storage, reduced motion, WebSocket token/localhost, the Calibration screen fed live-shaped recorded packets, demo mode (prompter + recording written) | 9 | pass |

Engine scenarios on synthetic signals (unit tests):

- A 3 s pressed-lip silent block is held; the reply comes 0.25–0.6 s after the lips relax; the 0.7 s and 2 s shadow timers would both have cut in.
- With no cues the reply comes 0.65–0.9 s after speech stops.
- A covered lens mid-pause falls back to the 2.0 s timer and never ends sooner than it.
- Arbiter tick < 2 ms (measured well below).

## 5. First live session (conversation mode, 20 Nov 2026)

One full question set (10 answers) with the agent driven by Hold the Floor. The numbers come from the opt-in debug log (`npm start debug`). Seated with shoulders and chest in view.

| Measure | Result |
| --- | --- |
| Calibration | rest 301 face frames in 10 s (30/s), lips-pressed 149 in 5 s: both "good". Rest outer-lip height 0.205 (MAD 0.002), pressed 0.136, so the press line is at 0.175. Mic floor −60.9 dBFS, speech p90 −39.1 dBFS |
| Camera during the conversation | quality OK 99% of seconds, median 23 face frames/s, 0 fallbacks |
| Holds | talking 12, lips 6, head 4, breath 2 |
| You went on speaking after a pause that reached "candidate end" or a hold | 11 times |
| Would-be cut-offs on the same session (shadow timers) | 0.7 s: 4 · 2 s: 1 · 3 s: 1 · 4 s: 1 |
| Hold the Floor cut-offs reported ("I wasn't finished") | 0 |
| Reply delay (end − last speech) | median 1.21 s, range 0.73–4.00 s; 9 of 10 ends after cues relaxed, 1 with no cue |

Caveats: conversation mode has no ground truth. Hold the Floor's own cut-offs are only the ones you flagged, and you may not have flagged every one. The median reply of 1.2 s is slower than the 0.7 s floor because "still talking" (mouth movement) often holds briefly as an answer ends. The oracle self-test below measures both properly.

A later demo run (same evening) found a threshold bug. A natural, light lip press measured outer height 0.200 against a rest of 0.209 (MAD 0.002), but the press line sat at 0.179, because a fixed 0.03 minimum margin made the plan's "rest − 3 MAD" rule 15 MAD strict on a very steady face. The press was missed and the turn ended. The margin is now 0.006, so 3 MAD decides (line at 0.203). The same run showed a "thinking" head turn of about 10°, under the plan's 15°. The demo script now uses the "lips set" posture instead, which held reliably.

That fix went too far. In the next run, ordinary closed lips after each answer (0.166–0.184, against a calibration rest of 0.223 and a listening rest of about 0.194) counted as "pressed", and replies slowed to a 1.81 s median. The press line is now anchored on the user's own calibrated press: 35% of the way from it (0.139) up to rest. Replaying that saved session (`npm run tune`, 9 answers, decisions shadowed and scored against when the agent actually spoke next):

| Press rule | Premature ends | Median reply |
| --- | ---: | ---: |
| Fixed 0.03 margin (first version) | 1 | 1.95 s |
| rest − 3 MAD | 1 | 1.95 s |
| **Anchored on the calibrated press, 0.35 (shipped)** | **1** | **1.24 s** |
| Anchored 0.25, listening rest only | 2 | 1.12 s |
| Anchored 0.5, listening rest only | 1 | 1.55 s |
| Pressed cue off | 2 | 1.09 s |

A second saved take, with a soft calibration press (0.202, only 0.048 below a rest of 0.250), showed the remaining failure: ordinary closed lips again counted as "pressed". The shipped rule therefore also requires the calibrated press to sit at least 0.05 below rest, otherwise pressed-lip holds are switched off for that session and Calibration asks for a firmer press. Replays of both saved takes with the shipped rule (anchor 0.35, minimum depth 0.05):

| Saved take | Calibration press | Before | Shipped rule |
| --- | --- | --- | --- |
| 1 (firm press) | 0.084 below rest | 1 premature, 1.95 s median | 1 premature, **1.24 s** |
| 2 (soft press) | 0.048 below rest | 2 premature, 1.74 s median | 2 premature, **1.13 s** (pressed cue off) |

Switching the pressed cue off entirely would have added a premature end in take 1, so a firm press does help. Take 2 had the same two premature ends under every press rule. Both settings were chosen on these two takes; the oracle self-test is the independent check. (These tables were re-scored after the replay fixes below; the first scoring counted one premature end fewer per take.)

**Demo take with the shipped rules** (live, comparison view on, recorded with `npm run demo`). The calibration press was soft (0.047 below rest), so pressed-lip holds were off and the planned silent block used the "lips set" posture.

| Moment | What happened |
| --- | --- |
| Answer 1 (normal) | reply 0.91 s after the last word |
| Answer 2 (silent pause, lips set and still) | held. The 0.7 s and 2 s shadow timers both fired during the pause and speech resumed: two would-be cut-offs. Hold the Floor ended the answer 0.72 s after the last word |
| Answer 3 (word search, lips set) | held a 3.2 s pause; the 0.7 s, 2 s and 3 s timers would have cut in. Reply 1.86 s after the last word |
| Answer 4 (camera covered while talking) | fallback banner, fixed timer, restored 4 s later; reply 1.55 s |
| Answer 5 (normal) | reply 1.01 s |
| Esc | camera and mic off in 0.73 s |
| Results (bundled replay, `npm run start:replay`) | 5 answers, median reply **1.00 s**, **0** would-be cut-offs. Fixed timers on the same input: 0.7 s ×2, 2 s ×2, 3 s ×1, 4 s ×0 (but a 4.00 s median wait) |
| Scored replay (`npm run tune`) | 5 answers, **0 premature ends**, median reply 1.00 s |

This session is bundled as `fixtures/sessions/demo-session.jsonl` (numbers only) and is what *Watch replay* plays.

**Replay fidelity.** Replaying this session at first gave slightly different decisions from the live run. The causes were three timing faults and one counting fault, all fixed. A unit test now checks that the bundled replay reproduces all six live turn decisions within two engine ticks, and the would-be cut-offs exactly.

- **Agent start stamped early.** Recordings stamped "agent speaking" when a question was queued, but the engine only learns it when the voice starts. In this session the voice began 331–481 ms after the stamp on all 7 questions (median 392 ms, measured from the microphone level). In the replay, the next question cancelled answer 1's reply by 19 ms. Recordings now (format v2) stamp the real start; older files are replayed with the start 300 ms after the stamp, just under the shortest measured delay.
- **A one-frame "more than one face" report.** As the hand came up to the lens, SmartSpectra reported a second face for one status update (33 ms). Whether the 30 Hz engine tick saw it was luck: live it did not, in the replay it did. Every such report now pauses camera cues, as the consent rules require.
- **A late microphone edge.** You resumed 2.46 s after the 0.7 s timer fired in answer 3, which is a would-be cut-off. Live, a tick discarded that timer moment at 2.5 s on the wall clock before the speech start, which reaches the engine a little after the sound, was processed. So the live screen showed one 0.7 s cut-off too few. Ticks no longer discard them.
- **The warm-up answer.** Replays counted the calibration warm-up answer; like a live session, they now count the conversation only.

What the first attempts taught (before this session): at normal laptop distance SmartSpectra reported "Place more of the chest in view" and sent **no face landmarks**, so calibration could not start. The Calibration screen now shows whether the face is tracked, and why not when it isn't.

## 6. Oracle self-test — *pending*

Protocol (plan T7.1): Settings → *Oracle test mode* on, *Comparison* on. Calibrate, then answer 30 questions (three sets). In each answer, plan **one 2–5 s pause mid-sentence**, and in **10 of them hold a lips-pressed block** for the pause (as in a silent block). Press **Space** only when truly done. Then Results → Export Markdown and Save numbers. Afterwards, run `RECORDING=<saved file> npm run ablation` for the per-cue contribution.

Results: *to be added from the real session.*

## 7. Real-camera checks — *pending*

| Test (plan §12) | How | Result |
| --- | --- | --- |
| Readiness `ready` | Setup → Check readiness | ready (Stage 1) |
| Metrics within 5 s | Stage 1 probe | 1.2 s |
| Cue latency < 300 ms vs mic | Stage 1: lip opening reached the app ≈0.25 s *before* the mic marked speech onset (31/31) | likely pass; re-measure with the corrected mic clock |
| Covered lens → fallback ≤ 1 s, recovery ≤ 2 s | Cover the lens mid-conversation | Live demo: fallback 1.04 s after the first "Increase light" status (the one-frame "second face" report 0.5 s earlier now pauses cues at once); restored 1.5 s after uncovering |
| No breath holds before breathing is stable | Watch Breath "warming up" during calibration | *pending live* (unit-tested) |
| Dim light and second face pause cues | Turn off the light; a second person leans in | *pending live* |
| Camera LED off ≤ 1 s after Esc | Press Esc during conversation | Live demo: camera and mic off 0.73 s after Esc (probe: 0.13 s) |
| Telemetry off, no other network calls | Constructor options; Windows Resource Monitor network tab | *pending live* |
| Memory growth < 50 MB in 20 min | Task Manager, 20-minute session | *pending live* |

## 8. Known failures and limits

- Breathing is a supporting cue only. Its timing is not yet shown to arrive early enough to start a hold.
- The webcam on the test laptop runs at the SDK's 25 fps minimum; dim light ends sessions.
- With the chest out of view, all camera cues stop (an SDK behaviour); the app falls back to the fixed timer.
- The scripted lip-press only approximates a stuttering block; no people who stutter have tested it yet.
