// Small shared UI pieces: logo, cue lights, banners, sheet, mirror,
// status chips. Phosphor Regular icons; one hand-drawn lips glyph in the
// same style (Phosphor has none).
import { useEffect, useRef, type ReactNode } from 'react';
import { ChatCircle, UserFocus, Wind, X, VideoCamera, VideoCameraSlash, Microphone, MicrophoneSlash, WarningCircle, Info } from '@phosphor-icons/react';
import type { CueName, CueState, CueStates } from '../turn/events';
import type { Banner as BannerT } from '../state/store';

export function Logo({ size = 40 }: { size?: number }) {
  // Two rounded speech bars with a gap bridged by a thin amber arc.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="4" y="18" width="16" height="14" rx="7" fill="var(--teal)" />
      <rect x="28" y="18" width="16" height="14" rx="7" fill="var(--teal)" />
      <path d="M14 17 C 18 6, 30 6, 34 17" fill="none" stroke="var(--amber)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LipsIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <path
        d="M24 128c24-36 56-52 76-44 12 5 20 6 28 0 8 6 16 5 28 0 20-8 52 8 76 44-28 40-64 56-104 56S52 168 24 128Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinejoin="round"
      />
      <path d="M24 128c40 8 72 10 104 10s64-2 104-10" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
    </svg>
  );
}

const CUE_META: Record<CueName, { label: string; icon: (s: number) => ReactNode }> = {
  lips: { label: 'Lips', icon: (s) => <LipsIcon size={s} /> },
  talking: { label: 'Talking', icon: (s) => <ChatCircle size={s} /> },
  breath: { label: 'Breath', icon: (s) => <Wind size={s} /> },
  head: { label: 'Head', icon: (s) => <UserFocus size={s} /> },
};

export function CueLight({ name, state }: { name: CueName; state: CueState }) {
  const m = CUE_META[name];
  const word = state.status === 'unavailable' ? 'not visible' : state.status === 'warming' ? state.detail || 'warming up' : state.detail;
  return (
    <div className={`cue ${state.status}`} role="status" aria-label={`${m.label}: ${word}`}>
      <span className="light">{m.icon(26)}</span>
      <span>
        <span className="name">{m.label}</span>
        <br />
        <span className="detail">{word}</span>
      </span>
    </div>
  );
}

export function CueColumn({ cues, enabled }: { cues: CueStates | null; enabled: Record<CueName, boolean> }) {
  const order: CueName[] = ['lips', 'talking', 'breath', 'head'];
  return (
    <aside className="cues" aria-label="Cue lights">
      {order.map((c) => (
        <CueLight
          key={c}
          name={c}
          state={!enabled[c] ? { status: 'unavailable', detail: 'off in Settings' } : (cues?.[c] ?? { status: 'unavailable', detail: '' })}
        />
      ))}
    </aside>
  );
}

export function BannerView({ banner, onClose }: { banner: BannerT; onClose?: () => void }) {
  return (
    <div className={`banner ${banner.kind}`} role={banner.kind === 'error' ? 'alert' : 'status'}>
      {banner.kind === 'error' ? <WarningCircle size={28} color="var(--error)" /> : <Info size={28} />}
      <div className="text">
        <strong>{banner.title}</strong>
        <span>{banner.message}</span>
      </div>
      {banner.action && banner.actionLabel ? (
        <button className="pill secondary" onClick={banner.action}>
          {banner.actionLabel}
        </button>
      ) : null}
      {onClose && banner.kind !== 'replay' ? (
        <button className="icon-btn" onClick={onClose} aria-label="Dismiss">
          <X size={24} />
        </button>
      ) : null}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={26} />
          </button>
        </header>
        <div className="body">{children}</div>
      </div>
    </>
  );
}

export function Mirror({ stream, large = false, frame = false }: { stream: MediaStream | null; large?: boolean; frame?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={`mirror${large ? ' large' : ''}${frame ? ' frame' : ''}`} aria-label="Your camera preview, mirrored">
      <video ref={ref} autoPlay muted playsInline />
    </div>
  );
}

export function DeviceChips({ cameraOn, micOn }: { cameraOn: boolean; micOn: boolean }) {
  return (
    <div className="row" aria-live="polite">
      <span className={`chip ${cameraOn ? 'on' : 'off'}`}>
        {cameraOn ? <VideoCamera size={20} /> : <VideoCameraSlash size={20} />}
        {cameraOn ? 'Camera on' : 'Camera off'}
        {cameraOn ? <span className="dot" /> : null}
      </span>
      <span className={`chip ${micOn ? 'on' : 'off'}`}>
        {micOn ? <Microphone size={20} /> : <MicrophoneSlash size={20} />}
        {micOn ? 'Mic on (loudness only)' : 'Mic off'}
      </span>
    </div>
  );
}
