import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Play } from '@phosphor-icons/react';
import { useApp } from '../state/store';
import { FloorRibbon } from '../ui/FloorRibbon';
import { startDemoRibbon } from '../ui/demoRibbon';
import { startBundledReplay } from '../app/App';
import type { Ribbon } from '../turn/ribbon';

export function Welcome() {
  const [demo] = useState(startDemoRibbon);
  useEffect(() => () => demo.stop(), [demo]);
  const getRibbon = useCallback((): Ribbon | null => demo.ribbon, [demo]);
  // The web replay page has no camera path: replay only, plus a link to the app.
  const web = useApp((s) => s.info?.web ?? null);

  return (
    <div className="column" style={{ maxWidth: 980 }}>
      <div style={{ display: 'grid', gap: 16, marginTop: 24 }}>
        <h1>Voice AI that can see you are not finished yet.</h1>
        <p style={{ fontSize: 24, lineHeight: '36px', maxWidth: 820 }}>
          Voice assistants end your turn after a fixed silence. Hold the Floor uses your own camera to notice when you are still mid-turn: lips pressed or set to speak,
          a breath in, your head turned while you think. It waits until those relax, then replies quickly.
        </p>
      </div>
      <figure style={{ margin: 0, display: 'grid', gap: 8 }}>
        <FloorRibbon ribbon={getRibbon} seconds={14} />
        <figcaption className="small muted">
          Illustration: a 3-second pause with lips pressed. The dashed line is where a 2-second timer would cut in. The amber band is Hold the Floor waiting.
        </figcaption>
      </figure>
      {web ? (
        <>
          <div className="row">
            <button className="pill primary" onClick={() => void startBundledReplay()} autoFocus>
              <Play size={22} /> Watch replay
            </button>
          </div>
          <p className="small" style={{ maxWidth: 820 }}>
            This page replays a recorded live session through the same engine, right in your browser: no camera, microphone or key. The live app, with your own camera and
            the SmartSpectra SDK, runs on your computer: <a href={web.repoUrl}>code and setup on GitHub</a>.
          </p>
        </>
      ) : (
        <div className="row">
          <button className="pill primary" onClick={() => useApp.getState().go('consent')} autoFocus>
            Start <ArrowRight size={22} />
          </button>
          <button className="pill secondary" onClick={() => void startBundledReplay()}>
            <Play size={22} /> Watch replay (no camera)
          </button>
        </div>
      )}
      <p className="small muted" style={{ maxWidth: 820 }}>
        Hold the Floor is a conversation tool. It does not detect, rate or treat stuttering or any condition, and it does not judge what you say.
      </p>
    </div>
  );
}
