// UI state. Raw signals never go here: the engine keeps them, and the
// store receives a snapshot at 15 Hz for the cue lights and labels.
import { create } from 'zustand';
import type { AppInfo, WsStatus } from '../shared/bridge';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import type { EngineSnapshot } from '../turn/engine';
import type { SessionSummary } from '../results/metrics';

export type Screen = 'welcome' | 'consent' | 'setup' | 'calibration' | 'conversation' | 'results';
export type Sheet = 'settings' | 'privacy' | null;

export interface Banner {
  kind: 'error' | 'fallback' | 'info' | 'replay';
  title: string;
  message: string;
  actionLabel?: string;
  action?: () => void;
}

export interface ResultsView {
  summary: SessionSummary;
  markdown: string;
  csv: string;
  canSave: boolean;
  savedAs: string | null;
}

export interface AppState {
  screen: Screen;
  sheet: Sheet;
  info: AppInfo | null;
  settings: Settings;
  consent: { camera: boolean; mic: boolean; given: boolean };
  mode: 'live' | 'replay';
  cameraOn: boolean;
  micOn: boolean;
  snapshot: EngineSnapshot | null;
  banner: Banner | null;
  /** Text for the aria-live region (rate-limited by the session). */
  announcement: string;
  question: string | null;
  questionIndex: number;
  questionTotal: number;
  agentSpeaking: boolean;
  results: ResultsView | null;
  ws: WsStatus | null;
  set: (p: Partial<AppState>) => void;
  go: (s: Screen) => void;
  openSheet: (s: Sheet) => void;
  updateSettings: (p: Partial<Settings>) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'welcome',
  sheet: null,
  info: null,
  settings: DEFAULT_SETTINGS,
  consent: { camera: false, mic: false, given: false },
  mode: 'live',
  cameraOn: false,
  micOn: false,
  snapshot: null,
  banner: null,
  announcement: '',
  question: null,
  questionIndex: 0,
  questionTotal: 0,
  agentSpeaking: false,
  results: null,
  ws: null,
  set: (p) => set(p),
  go: (screen) => {
    if (window.htf && typeof window.htf.debug === 'function') {
      try {
        window.htf.debug('screen', { screen });
      } catch {
        /* ignore */
      }
    }
    set({ screen });
  },
  openSheet: (sheet) => set({ sheet }),
  updateSettings: async (p) => {
    const next = { ...get().settings, ...p, cues: { ...get().settings.cues, ...(p.cues ?? {}) } };
    set({ settings: next });
    try {
      set({ settings: await window.htf.setSettings(next) });
    } catch {
      /* keep the in-memory value */
    }
  },
}));
