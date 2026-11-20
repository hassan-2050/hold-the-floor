// Calibration (~45 s): 10 s resting silently, 5 s lips firmly pressed, then
// one easy question until breathing is stable. Lip and head cues work from
// the end of step 2; breath shows "warming up" until the SDK marks it stable.
//
// The screen says what the camera sees (camera name, face tracked or not,
// SmartSpectra's hint, frames collected) so a failed step always has a
// reason. Only a rest step with almost no face frames must be repeated; a
// slow camera continues with a note.
import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { THRESHOLDS } from '../../config/thresholds';
import { useApp } from '../state/store';
import { session } from '../app/session';
import { dbg } from '../app/debug';
import { CueColumn, Mirror } from '../ui/parts';
import type { EngineSnapshot } from '../turn/engine';

const clock = (): number => performance.now();

type Phase = 'starting' | 'intro' | 'rest' | 'press' | 'question' | 'done';

const WARMUP_Q = 'To warm up: tell me what you did this morning.';

/** Why the face was not tracked, in words, from the latest snapshot. */
function whyNotTracked(s: EngineSnapshot | null, cameraLabel: string): string {
  const code = s?.quality.validationCode;
  if (/virtual|transcreen|obs/i.test(cameraLabel)) return `“${cameraLabel}” looks like a virtual camera. Go back to Setup and choose your real camera.`;
  if (code === 7) return 'SmartSpectra sends no face data until it can see your upper chest. Sit back, or tilt the screen back, so your shoulders and chest are in the picture.';
  if (code === 1) return 'No face found. Sit in front of the camera, facing it.';
  if (code === 5) return 'It is too dark. Add light in front of you.';
  if (code === 2) return 'More than one face is in view.';
  if (s && s.quality.landmarkHz > 0 && s.quality.landmarkHz < 15) return `The camera is slow (${s.quality.landmarkHz} face frames per second). More light in front of you helps.`;
  return s?.quality.hint || 'The camera has not sent a usable picture of your face yet.';
}

export function Calibration() {
  const snap = useApp((s) => s.snapshot);
  const settings = useApp((s) => s.settings);
  const consent = useApp((s) => s.consent);
  const agentSpeaking = useApp((s) => s.agentSpeaking);
  const [phase, setPhase] = useState<Phase>('starting');
  const [progress, setProgress] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [answeredMs, setAnsweredMs] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void session.startLive().then(() => {
      if (!alive) return;
      setStream(session.previewStream);
      setPhase('intro');
    });
    return () => {
      alive = false;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const runTimed = (step: 'rest' | 'press', ms: number, then: () => void): void => {
    setPhase(step);
    setProgress(0);
    session.calibrationStep(step);
    const t0 = clock();
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const f = Math.min(1, (clock() - t0) / ms);
      setProgress(f);
      if (f >= 1) {
        window.clearInterval(timer.current!);
        timer.current = null;
        then();
      }
    }, 100);
  };

  const begin = (): void => {
    setProblem(null);
    setNotes([]);
    runTimed('rest', THRESHOLDS.calibration.restMs, () =>
      runTimed('press', THRESHOLDS.calibration.pressMs, () => {
        const r = session.finishCalibration();
        if (consent.camera && r) {
          if (r.quality.rest === 'missing') {
            const why = whyNotTracked(useApp.getState().snapshot, cameraLabel());
            setProblem(`Your face was not tracked while resting (${r.frames.rest} face frames in 10 s). ${why}`);
            dbg('cal-blocked', { frames: r.frames, why });
            setPhase('intro');
            return;
          }
          const n: string[] = [];
          if (r.quality.rest === 'low') n.push(`Face tracking was slow (${Math.round(r.frames.rest / 10)} frames per second). Cues will work but react less smoothly; more light in front of you helps.`);
          if (r.quality.press === 'missing') n.push('The lips-pressed step was not seen clearly, so the app uses your resting shape only.');
          setNotes(n);
        }
        void askQuestion();
      }),
    );
  };

  const askQuestion = async (): Promise<void> => {
    setPhase('question');
    setAnsweredMs(0);
    await session.sayCalibrationQuestion(WARMUP_Q);
    session.calibrationStep('question');
    const t0 = clock();
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const el = clock() - t0;
      setAnsweredMs(el);
      setProgress(Math.min(1, el / THRESHOLDS.calibration.questionMaxMs));
      const st = useApp.getState().snapshot;
      if (el >= THRESHOLDS.calibration.questionMaxMs || (st?.quality.breathingStable && el > 8000)) finish();
    }, 200);
  };

  const finish = (): void => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    session.finishCalibration();
    setPhase('done');
  };

  const restart = (): void => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setPhase('intro');
  };

  const backToSetup = async (): Promise<void> => {
    if (timer.current) window.clearInterval(timer.current);
    await session.end();
    useApp.getState().go('setup');
  };

  const startConversation = (): void => {
    useApp.getState().go('conversation');
    void session.beginConversation();
  };

  const stepState = (s: Phase): string => {
    const order: Phase[] = ['rest', 'press', 'question', 'done'];
    const cur = order.indexOf(phase);
    const me = order.indexOf(s);
    return cur > me ? 'done' : cur === me ? 'active' : '';
  };

  function cameraLabel(): string {
    return stream?.getVideoTracks()[0]?.label ?? '';
  }

  const hz = snap?.quality.landmarkHz ?? 0;
  // Tracked = face landmarks are actually arriving (the SDK sends none while
  // the chest is out of view).
  const tracked = hz >= 5;
  const breathing = snap?.cues.breath.status;
  const frames = snap?.calibrationFrames;
  const label = cameraLabel();

  return (
    <div className="stage-wrap" style={{ padding: 0, height: 'auto' }}>
      <div className="column">
        <h1>Calibration</h1>
        <p>About 45 seconds. This learns how your face looks at rest, so the app can tell when you are mid-turn. Sit back so your shoulders and upper chest are in the picture.</p>
        <div className="row" style={{ alignItems: 'center', gap: 24 }}>
          {consent.camera ? <Mirror stream={stream} frame /> : null}
          <div className="status-list" aria-live="polite">
            {consent.camera ? (
              <>
                <span>
                  <strong>Camera:</strong> {label || 'starting…'}
                </span>
                <span>
                  <strong>Face:</strong>{' '}
                  {phase === 'starting' ? 'starting…' : tracked ? <span className="good">tracked ({hz} per second)</span> : <span className="bad">not tracked</span>}
                </span>
                {!tracked && phase !== 'starting' ? <span>{whyNotTracked(snap, label)}</span> : null}
                {tracked && snap?.quality.hint ? (
                  <span>
                    <strong>SmartSpectra:</strong> {snap.quality.hint}
                  </span>
                ) : null}
                {(phase === 'rest' || phase === 'press') && frames ? <span className="small muted num">Face frames this step: {frames[phase]}</span> : null}
              </>
            ) : (
              <span>Camera off: only the microphone is calibrated.</span>
            )}
          </div>
        </div>
        <ol className="steps" aria-label="Calibration steps">
          <li className={stepState('rest')}>
            <span className="n">1</span>
            <strong>Rest silently</strong>
            <span className="small">Relax your face and stay quiet for 10 seconds.</span>
            <div className="track">
              <div className="fill" style={{ width: phase === 'rest' ? `${progress * 100}%` : undefined }} />
            </div>
          </li>
          <li className={stepState('press')}>
            <span className="n">2</span>
            <strong>Press your lips</strong>
            <span className="small">Press your lips firmly together for 5 seconds, the way you would hold them in a block.</span>
            <div className="track">
              <div className="fill" style={{ width: phase === 'press' ? `${progress * 100}%` : undefined }} />
            </div>
          </li>
          <li className={stepState('question')}>
            <span className="n">3</span>
            <strong>Answer one easy question</strong>
            <span className="small">Talk normally. Breathing joins when it is ready ({breathing === 'warming' ? 'warming up' : breathing === 'unavailable' ? 'not visible' : 'ready'}).</span>
            <div className="track">
              <div className="fill" style={{ width: phase === 'question' ? `${progress * 100}%` : undefined }} />
            </div>
          </li>
        </ol>

        <div aria-live="polite" style={{ minHeight: 64, display: 'grid', gap: 8 }}>
          {phase === 'starting' && <p>Starting the camera and microphone…</p>}
          {phase === 'intro' && (problem ? <p role="alert">{problem}</p> : <p>When you are ready, press Begin. You don't need to wait for Breath: it joins by itself once you have sat still for about 30 seconds, alone in view, with your chest visible.</p>)}
          {phase === 'rest' && <p className="h3">Relax and stay silent.</p>}
          {phase === 'press' && <p className="h3">Press your lips firmly together.</p>}
          {phase === 'question' && <p style={{ fontSize: 'var(--question)', lineHeight: 'var(--question-lh)' }}>{WARMUP_Q}</p>}
          {phase === 'done' && (
            <p>
              Calibration done.{' '}
              {snap?.lipsReady && snap?.headReady ? 'Lip and head cues are ready' : 'Lip and head cues could not be calibrated; the fixed timer will be used'}
              {breathing === 'warming' ? '; breathing is still warming up and will join soon' : ''}.
            </p>
          )}
          {phase !== 'starting' && phase !== 'intro' && phase !== 'rest' && phase !== 'press' && snap?.lipsReady && !snap.pressEnabled ? (
            <p className="small" role="status">
              Your lips-pressed step looked almost the same as your resting lips, so pressed-lip holds are off for this session (lips slightly open, talking, breath and head still work).
              To use them, restart calibration and press harder in step 2.
            </p>
          ) : null}
          {notes.map((n) => (
            <p key={n} className="small">
              {n}
            </p>
          ))}
        </div>

        <div className="row">
          {phase === 'intro' && (
            <button className="pill primary" onClick={begin} autoFocus>
              {problem ? 'Try again' : 'Begin'}
            </button>
          )}
          {phase === 'question' && (
            <button className="pill primary" onClick={finish} disabled={agentSpeaking || answeredMs < 5000}>
              I've answered <ArrowRight size={22} />
            </button>
          )}
          {phase === 'done' && (
            <button className="pill primary" onClick={startConversation} autoFocus>
              Start the conversation <ArrowRight size={22} />
            </button>
          )}
          {phase !== 'starting' && phase !== 'intro' && (
            <button className="pill secondary" onClick={restart}>
              <ArrowClockwise size={22} /> Restart calibration
            </button>
          )}
          <button className="pill secondary" onClick={() => void backToSetup()}>
            <ArrowLeft size={22} /> Back to Setup
          </button>
          <button className="pill secondary" onClick={() => void session.stopSensing()}>
            Stop <span className="key">Esc</span>
          </button>
        </div>
      </div>
      <CueColumn cues={snap?.cues ?? null} enabled={settings.cues} />
    </div>
  );
}
