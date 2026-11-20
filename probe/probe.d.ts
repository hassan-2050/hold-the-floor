interface ProbeBridge {
  info(): Promise<{
    sdkVersion: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    hasKey: boolean;
    nativeCameras: { id: string; name: string | null }[];
  }>;
  key(): Promise<string | null>;
  readiness(cameraLabel: string | null): Promise<{ verdict: string; reason: string; tookMs?: number }>;
  openLog(): Promise<string>;
  closeLog(): Promise<string>;
  lines(lines: string[]): void;
}

interface Window {
  probe: ProbeBridge;
}
