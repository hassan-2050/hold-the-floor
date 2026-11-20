// Conversation: the question in large type, the hold state, actions,
// cue lights on the right and the floor ribbon across the bottom.
// Comparison mode splits the stage: left the 2.0 s timer (shadow, never
// drives the agent), right Hold the Floor (drives the agent).
import { ArrowBendUpLeft, Check, PaperPlaneRight, StopCircle, VideoCamera, FlagCheckered } from '@phosphor-icons/react';
import { useApp } from '../state/store';
import { session } from '../app/session';
import { CueColumn } from '../ui/parts';
import { FloorRibbon } from '../ui/FloorRibbon';
import type { EngineSnapshot } from '../turn/engine';

const CUE_TEXT: Record<string, string> = { lips: 'lips', talking: 'still talking', breath: 'breathing in', head: 'head turned' };
const getRibbon = () => session.engine?.ribbon ?? null;

function holdText(s: EngineSnapshot | null, recentEnd: boolean): { cls: string; text: string } {
  if (!s) return { cls: 'agent', text: 'Getting ready…' };
  if (s.oracle && s.htfWouldEndAt !== null && s.state === 'CANDIDATE_END') {
    return { cls: 'ended', text: 'Would reply now (oracle mode waits for Space)' };
  }
  const timerOnly = s.fallback ? ' · timer only' : '';
  if (s.agentSpeaking) return { cls: 'agent', text: 'Agent speaking' };
  if (recentEnd) return { cls: 'ended', text: 'Your turn ended' };
  switch (s.state) {
    case 'HOLDING':
      return { cls: 'holding', text: `Holding — ${s.holdCue === 'lips' ? `lips ${s.holdDetail}` : CUE_TEXT[s.holdCue ?? ''] ?? ''}` };
    case 'WAITING':
      return { cls: 'listening', text: `Your turn — take your time${timerOnly}` };
    case 'LISTENING':
    case 'CANDIDATE_END':
      return { cls: s.fallback ? 'fallback' : 'listening', text: `Listening${timerOnly}` };
    case 'END_OF_TURN':
      return { cls: 'ended', text: 'Your turn ended' };
    default:
      return { cls: 'agent', text: '' };
  }
}

export function Conversation() {
  const snap = useApp((s) => s.snapshot);
  const question = useApp((s) => s.question);
  const qi = useApp((s) => s.questionIndex);
  const qn = useApp((s) => s.questionTotal);
  const settings = useApp((s) => s.settings);
  const mode = useApp((s) => s.mode);
  const cameraOn = useApp((s) => s.cameraOn);
  const micOn = useApp((s) => s.micOn);
  const consent = useApp((s) => s.consent);
  const agentSpeaking = useApp((s) => s.agentSpeaking);

  const recentEnd = !!snap?.lastEnd && snap.t - snap.lastEnd.t < 1500 && !snap.agentSpeaking && snap.state !== 'LISTENING';
  const h = holdText(snap, recentEnd);
  const live = mode === 'live';
  const sensingStopped = live && !cameraOn && !micOn && (consent.camera || consent.mic);
  const oracle = snap?.oracle ?? settings.oracle;

  // Comparison: the 2.0 s timer "cuts in" while the user is still mid-turn.
  const fired = snap?.twoSecondFiredAt ?? null;
  const cutIn = !!snap && fired !== null && snap.t - fired < 2500 && (snap.state === 'HOLDING' || snap.state === 'LISTENING' || snap.state === 'CANDIDATE_END') && !snap.agentSpeaking;
  const left = snap?.twoSecondRemaining;

  const stage = (
    <div className="stage">
      <p className="meta">{mode === 'replay' ? 'Replay' : qn ? `Question ${Math.min(qi, qn)} of ${qn}` : ''}</p>
      <p className="question">{question ?? ' '}</p>
      {settings.comparison ? (
        <div className="compare">
          <div className={`half${cutIn ? ' cut-in' : ''}`} aria-live="polite">
            <span className="tag">Fixed 2.0 s timer · shadow, does not drive the agent</span>
            <strong style={{ fontSize: 'var(--h3)' }}>{cutIn ? 'Would have cut in here' : left !== null && left !== undefined ? `Silence… ${(Math.max(0, left) / 1000).toFixed(1)} s left` : 'Listening'}</strong>
          </div>
          <div className="half drives">
            <span className="tag">{oracle ? 'Hold the Floor · measured against your Space press' : 'Hold the Floor · drives the agent'}</span>
            <span className={`hold-label ${h.cls}`}>{h.text}</span>
          </div>
        </div>
      ) : (
        h.text ? (
          <span className={`hold-label ${h.cls}`} aria-hidden="true">
            {h.text}
          </span>
        ) : null
      )}
      <div className="actions">
        {live ? (
          <>
            <button className="pill primary" onClick={() => session.send()} disabled={agentSpeaking}>
              <PaperPlaneRight size={22} /> Send <span className="key">Enter</span>
            </button>
            {oracle ? (
              <button className="pill primary" onClick={() => session.oracleDone()} disabled={agentSpeaking}>
                <Check size={22} /> I am truly done <span className="key">Space</span>
              </button>
            ) : null}
            {agentSpeaking ? (
              <button className="pill secondary" onClick={() => session.notDone()}>
                <ArrowBendUpLeft size={22} /> I wasn't finished <span className="key">⌫</span>
              </button>
            ) : null}
            {sensingStopped ? (
              <button className="pill secondary" onClick={() => void session.resumeSensing()}>
                <VideoCamera size={22} /> Turn camera and mic back on
              </button>
            ) : (
              <button className="pill secondary" onClick={() => void session.stopSensing()}>
                <StopCircle size={22} /> Stop sensing <span className="key">Esc</span>
              </button>
            )}
          </>
        ) : null}
        <button className="pill secondary" onClick={() => void session.finish()}>
          <FlagCheckered size={22} /> {live ? 'End and see results' : 'Stop replay and see results'}
        </button>
      </div>
      {sensingStopped ? <p className="muted">Camera and microphone are off. Press Enter or Send to end each answer.</p> : null}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100%' }}>
      <div className="stage-wrap">
        {stage}
        <CueColumn cues={snap?.cues ?? null} enabled={settings.cues} />
      </div>
      <FloorRibbon ribbon={getRibbon} />
    </div>
  );
}
