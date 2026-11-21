// The narrow bridge the preload exposes as `window.htf`. The renderer has
// no Node access; everything privileged goes through these calls.
import type { ReadinessResult } from './sdkConfig';
import type { Settings } from './settings';

export interface SessionInfo {
  id: string;
  name: string;
  created: string;
  bytes: number;
}

export interface WsStatus {
  running: boolean;
  port: number | null;
  token: string | null;
  clients: number;
  error: string | null;
}

export interface AppInfo {
  version: string;
  sdkVersion: string;
  platform: string;
  /** Started with --replay (judges without a key). */
  replayFlag: boolean;
  /** Folder holding saved sessions (shown in Privacy). */
  dataPath: string;
  sessionsPath: string;
  /** End-to-end test run. */
  e2e: boolean;
  /** Started with --htf-debug: renderer events go to <app data>/debug.log. */
  debug: boolean;
  debugLogPath: string | null;
  /** Started with `demo`: prompter window + screen recording. */
  demo: boolean;
  /** Demo mode records the window (false with `norec`: script window only). */
  demoRecord: boolean;
  /** Set only on the web replay page (src/web): replay only, no desktop bridge. */
  web?: { repoUrl: string };
}

export interface AppBridge {
  info(): Promise<AppInfo>;
  // API key (stored with OS encryption in the main process)
  hasKey(): Promise<boolean>;
  setKey(key: string): Promise<{ ok: boolean; error?: string }>;
  clearKey(): Promise<void>;
  /** Only for constructing the SDK; never store the result. */
  keyForSdk(): Promise<string | null>;
  /** A development key from .env, if present (dev builds only). */
  hasDevKey(): Promise<boolean>;
  importDevKey(): Promise<boolean>;
  // Readiness (main-process SDK; needs the camera to be free)
  readiness(cameraLabel: string | null): Promise<ReadinessResult & { tookMs: number }>;
  // Settings
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Settings>;
  // Sessions (numbers only)
  saveSession(name: string, jsonl: string): Promise<SessionInfo>;
  listSessions(): Promise<SessionInfo[]>;
  readSession(id: string): Promise<string | null>;
  deleteSession(id: string): Promise<void>;
  deleteAllSessions(): Promise<number>;
  listFixtures(): Promise<{ id: string; label: string }[]>;
  readFixture(id: string): Promise<string | null>;
  // Export
  exportFile(defaultName: string, content: string): Promise<string | null>;
  // TTS fallback
  ttsSpeak(text: string, rate: number): Promise<{ ok: boolean; error?: string }>;
  ttsCancel(): Promise<void>;
  // WebSocket API
  wsStart(): Promise<WsStatus>;
  wsStop(): Promise<WsStatus>;
  wsStatus(): Promise<WsStatus>;
  wsSend(event: unknown): void;
  /** Debug log (only written when the app was started with --htf-debug). */
  debug(event: string, data?: Record<string, unknown>): void;
  // Demo mode only (prompter + recording)
  demoState(s: unknown): void;
  recBegin(mimeType: string): Promise<string>;
  recChunk(chunk: Uint8Array): void;
  recEnd(): Promise<string>;
  recError(message: string): void;
  onDemoStop(cb: () => void): void;
  // Shutdown handshake: main asks, renderer stops sensing and confirms.
  onShutdownRequest(cb: () => void): void;
  shutdownDone(): void;
}

declare global {
  interface Window {
    htf: AppBridge;
  }
}
