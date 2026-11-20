// The local end_of_turn API: a WebSocket server on 127.0.0.1 only, with a
// random token required in the URL (?token=...). It sends JSON turn events
// to any local voice agent. It never sends camera or mic data, only the
// arbiter's decisions. See docs/WS-API.md.
import { WebSocketServer, type WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import type { WsStatus } from '../../src/shared/bridge';

let server: WebSocketServer | null = null;
let token: string | null = null;
let port: number | null = null;
let lastError: string | null = null;
const clients = new Set<WebSocket>();

export function wsStatus(): WsStatus {
  return { running: server !== null, port, token, clients: clients.size, error: lastError };
}

export function wsStart(preferredPort = 0): Promise<WsStatus> {
  if (server) return Promise.resolve(wsStatus());
  token = randomBytes(16).toString('hex');
  lastError = null;
  return new Promise((resolve) => {
    const s = new WebSocketServer({
      host: '127.0.0.1',
      port: preferredPort,
      maxPayload: 4096,
      verifyClient: (info, cb) => {
        const url = new URL(info.req.url ?? '/', 'ws://127.0.0.1');
        const okToken = url.searchParams.get('token') === token;
        // Browsers send an Origin; refuse web pages so only local programs connect.
        const origin = info.origin;
        const okOrigin = !origin || origin === 'null' || origin.startsWith('file://');
        cb(okToken && okOrigin, okToken ? 403 : 401);
      },
    });
    s.on('listening', () => {
      const addr = s.address();
      port = typeof addr === 'object' && addr ? addr.port : null;
      server = s;
      resolve(wsStatus());
    });
    s.on('error', (err) => {
      lastError = err.message;
      server = null;
      port = null;
      resolve(wsStatus());
    });
    s.on('connection', (sock) => {
      clients.add(sock);
      sock.send(JSON.stringify({ type: 'hello', api: 'hold-the-floor/end_of_turn', version: 1 }));
      sock.on('close', () => clients.delete(sock));
      // Clients may only listen; incoming messages are ignored.
      sock.on('message', () => undefined);
    });
  });
}

export function wsStop(): Promise<WsStatus> {
  return new Promise((resolve) => {
    if (!server) return resolve(wsStatus());
    for (const c of clients) c.terminate();
    clients.clear();
    server.close(() => {
      server = null;
      port = null;
      token = null;
      resolve(wsStatus());
    });
  });
}

const ALLOWED = new Set(['turn.hold', 'turn.end', 'turn.resume', 'quality.fallback', 'quality.restored', 'agent.speaking', 'session.start', 'session.stop']);

export function wsBroadcast(event: unknown): void {
  if (!server || !event || typeof event !== 'object') return;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== 'string' || !ALLOWED.has(type)) return;
  const msg = JSON.stringify(event);
  if (msg.length > 2048) return;
  for (const c of clients) if (c.readyState === c.OPEN) c.send(msg);
}
