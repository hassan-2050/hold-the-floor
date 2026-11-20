// Results: per-policy would-be cut-offs and median reply delay from the
// same session, a dot plot of delays and bars of cut-offs (ink and teal
// only), CSV/Markdown export, and saving a numbers-only session.
import { useEffect, useState } from 'react';
import { ArrowLeft, DownloadSimple, FloppyDisk, Trash } from '@phosphor-icons/react';
import { useApp } from '../state/store';
import { session } from '../app/session';
import type { SessionInfo } from '../shared/bridge';
import type { SessionSummary } from '../results/metrics';

function Chart({ s }: { s: SessionSummary }) {
  const rows = s.policies;
  const W = 760;
  const rowH = 44;
  const left = 170;
  const mid = 470;
  const H = rows.length * rowH + 44;
  const maxDelay = 4.5;
  const maxCut = Math.max(1, ...rows.map((r) => Math.max(r.cutoffs, r.premature ?? 0)));
  const dx = (sec: number): number => left + (sec / maxDelay) * (mid - left - 40);
  const bx = (n: number): number => (n / maxCut) * (W - mid - 40);
  return (
    <svg className="dotplot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reply delay and cut-offs per policy">
      <text x={left} y={18} fontSize="16" fill="var(--ink-2)">
        Median reply delay (s)
      </text>
      <text x={mid + 10} y={18} fontSize="16" fill="var(--ink-2)">
        Would-be cut-offs
      </text>
      {[0, 1, 2, 3, 4].map((v) => (
        <g key={v}>
          <line x1={dx(v)} x2={dx(v)} y1={28} y2={H - 8} stroke="var(--line)" />
          <text x={dx(v)} y={H} fontSize="14" textAnchor="middle" fill="var(--ink-2)" fontFamily="var(--mono)">
            {v}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 40 + i * rowH;
        const us = r.policy === 'hold-the-floor';
        const color = us ? 'var(--teal)' : 'var(--ink)';
        return (
          <g key={r.policy}>
            <text x={0} y={y + 6} fontSize="17" fontWeight={us ? 700 : 400} fill="var(--ink)">
              {r.label}
            </text>
            {r.medianDelayMs !== null ? <circle cx={dx(r.medianDelayMs / 1000)} cy={y} r={us ? 9 : 7} fill={color} /> : null}
            <rect x={mid + 10} y={y - 10} width={Math.max(2, bx(r.cutoffs))} height={20} fill={color} />
            <text x={mid + 18 + bx(r.cutoffs)} y={y + 6} fontSize="16" fontFamily="var(--mono)" fill="var(--ink)">
              {r.cutoffs}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Results() {
  const results = useApp((s) => s.results);
  const [name, setName] = useState('My session');
  const [saved, setSaved] = useState<string | null>(null);
  const [list, setList] = useState<SessionInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void window.htf.listSessions().then(setList);
  }, [saved]);

  if (!results) return <p>No results yet.</p>;
  const s = results.summary;
  const htf = s.policies.find((p) => p.policy === 'hold-the-floor')!;
  const two = s.policies.find((p) => p.policy === 'fixed-2000');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  return (
    <div className="column">
      <h1>Results</h1>
      {s.turns === 0 ? <p>No complete answers were recorded in this session, so there is nothing to compare yet.</p> : null}
      <p hidden={s.turns === 0}>
        {s.turns} answer{s.turns === 1 ? '' : 's'}
        {s.oracle ? ' in oracle test mode (you pressed Space when truly done)' : ''}. Hold the Floor replied after a median{' '}
        <strong className="num">{htf.medianDelayMs === null ? '—' : `${(htf.medianDelayMs / 1000).toFixed(2)} s`}</strong>
        {two ? (
          <>
            {' '}
            and would have cut you off <strong className="num">{htf.cutoffs}</strong> time{htf.cutoffs === 1 ? '' : 's'}; a fixed 2-second timer on the same session would have cut you off{' '}
            <strong className="num">{two.cutoffs}</strong> time{two.cutoffs === 1 ? '' : 's'}.
          </>
        ) : (
          '.'
        )}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Policy</th>
            <th className="right">Would-be cut-offs</th>
            {s.oracle ? <th className="right">Premature ends</th> : null}
            <th className="right">Median reply delay</th>
          </tr>
        </thead>
        <tbody>
          {s.policies.map((p) => (
            <tr key={p.policy} className={p.policy === 'hold-the-floor' ? 'us' : ''}>
              <td>{p.label}</td>
              <td className="num right">{p.cutoffs}</td>
              {s.oracle ? <td className="num right">{p.premature ?? '—'}</td> : null}
              <td className="num right">{p.medianDelayMs === null ? '—' : `${(p.medianDelayMs / 1000).toFixed(2)} s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Chart s={s} />
      <div className="small muted" style={{ display: 'grid', gap: 8 }}>
        <p>
          A <strong>cut-off</strong> means the policy ended your turn and you started speaking again within 2.5 seconds. The fixed timers never drove the agent; they ran on the same
          live input. {s.oracle ? 'A premature end means a policy ended your turn and you went on speaking before pressing Space, however long the pause.' : ''}
        </p>
        <p>
          Holds by cue: lips {s.holdsByCue.lips}, still talking {s.holdsByCue.talking}, breathing in {s.holdsByCue.breath}, head turned {s.holdsByCue.head}. Camera cues paused{' '}
          {s.fallbackCount} time{s.fallbackCount === 1 ? '' : 's'}.
        </p>
      </div>
      <div className="row">
        <button className="pill secondary" onClick={() => void window.htf.exportFile(`hold-the-floor-${stamp}.csv`, results.csv)}>
          <DownloadSimple size={22} /> Export CSV
        </button>
        <button className="pill secondary" onClick={() => void window.htf.exportFile(`hold-the-floor-${stamp}.md`, results.markdown)}>
          <DownloadSimple size={22} /> Export Markdown
        </button>
      </div>
      {results.canSave ? (
        <section className="field">
          <h2>Save this session</h2>
          <p className="help">Saves numbers only (lip and head positions for a few face points, breathing trace, loudness values, events). No video, no audio. You can delete it any time.</p>
          <label htmlFor="sname">Name</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="sname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              className="pill primary"
              disabled={!!saved}
              onClick={() =>
                void session
                  .saveSession(name)
                  .then((id) => {
                    setSaved(id);
                    setMsg('Saved.');
                  })
                  .catch((e: Error) => setMsg(e.message))
              }
            >
              <FloppyDisk size={22} /> {saved ? 'Saved' : 'Save numbers'}
            </button>
          </div>
          {msg ? <p aria-live="polite">{msg}</p> : null}
        </section>
      ) : null}
      {list.length ? (
        <section className="field">
          <h2>Saved sessions</h2>
          {list.map((x) => (
            <div key={x.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                {x.name} <span className="small muted num">{new Date(x.created).toLocaleString()}</span>
              </span>
              <button
                className="pill secondary"
                aria-label={`Delete ${x.name}`}
                onClick={() => void window.htf.deleteSession(x.id).then(() => window.htf.listSessions().then(setList))}
              >
                <Trash size={22} /> Delete
              </button>
            </div>
          ))}
        </section>
      ) : null}
      <div className="row">
        <button
          className="pill primary"
          onClick={() => {
            void session.end();
            useApp.getState().set({ results: null });
            useApp.getState().go('welcome');
          }}
        >
          <ArrowLeft size={22} /> Back to start
        </button>
      </div>
    </div>
  );
}
