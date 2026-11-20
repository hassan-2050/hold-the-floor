# Stage 1 probe

A developer tool that checks the SDK on your machine before the app relies on it.
It logs **numbers only**: decoded SDK metrics, plus one microphone loudness
value per 20 ms. No video or audio is saved. Telemetry is off.

## Run

1. Copy `.env.example` to `.env` and set `SMARTSPECTRA_API_KEY=` to your Presage key.
2. Close anything else that is using the webcam.
3. `npm run probe`
4. In the window:
   1. **I agree** asks for camera and mic permission once, so the device names appear.
   2. Pick the camera and microphone. Headphones help.
   3. **1 · Readiness check**: the verdict and reason are shown and logged.
   4. **2 · Start measuring + log**: the mirror shows landmarks. *Labels: key* shows the indices the app uses; *all* shows every index (zoom in to check the mouth and eyes).
   5. **3 · Run protocol** (about 3 minutes), following the prompts:
      - 35 s still and silent, breathing normally. This warms up the breathing window and gives the lip and mic baselines.
      - 5 s lips gently pressed.
      - 20 cycles: count aloud for 3 s, then stop and **breathe in**, then wait.
      - Head left, right, up and down, 2 s each.
      - 3 s with lips slightly parted, silent ("set").
   6. **Stop**: stops tracks and the SDK, and reports how long the stop took.
5. `npm run probe:analyze` writes `probe/logs/<log>.report.md` and prints it.

Logs live in `probe/logs/` (git-ignored). Delete them whenever you like.
