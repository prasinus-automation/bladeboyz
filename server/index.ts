/**
 * BladeBoyz game server — single-port HTTP + WebSocket (docs/networking/01:
 * "WS upgrade goes through the same HTTP listener that already serves the
 * static client bundle").
 *
 *   - `GET /*`      → static files from `dist/` (production container).
 *   - `GET /healthz`→ liveness + room stats JSON.
 *   - `GET /ws`     → WebSocket upgrade into the single quick-play FFA room.
 *
 * Run: `npm run dev:server` (tsx, port 3004) alongside `npm run dev`
 * (vite proxies /ws), or bundled via `npm run build:server` in the Docker
 * image (port 80).
 *
 * Identity: if the client supplies a Supabase access token AND the server
 * has SUPABASE_URL + SUPABASE_ANON_KEY env, the token is verified against
 * the Supabase auth API and the profile username becomes the display name.
 * Otherwise the player joins as a sanitized guest. The server never trusts
 * a client-supplied name when a token verifies.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { FfaRoom } from './room';
import type { Outbound } from './room';
import {
  decode,
  encode,
  BROADCAST_HZ,
  type ClientMsg,
  type JoinMsg,
} from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 3004);
const DIST_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'dist',
);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

// ── Identity ──────────────────────────────────────────────

let guestCounter = 1;

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/[^\w \-]/g, '').slice(0, 20);
  return trimmed.length >= 2 ? trimmed : null;
}

/**
 * Verify a Supabase access token; returns the display name to use, or null
 * if verification is unavailable/failed (caller falls back to guest).
 */
async function verifySupabaseToken(token: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) return null;
    const user = (await userRes.json()) as { id?: string; email?: string };
    if (!user.id) return null;

    // Prefer the profile username (RLS: own-row select works with the
    // user's own token).
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=username`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (profRes.ok) {
      const rows = (await profRes.json()) as Array<{ username?: string }>;
      const username = sanitizeName(rows[0]?.username);
      if (username) return username;
    }
    return sanitizeName(user.email?.split('@')[0]) ?? null;
  } catch {
    return null;
  }
}

// ── Static file serving (production) ──────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = (req.url ?? '/').split('?')[0];
  // Path traversal guard: normalize and refuse anything escaping DIST_DIR.
  const rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST_DIR, rel === '/' ? 'index.html' : rel);
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA fallback.
    filePath = join(DIST_DIR, 'index.html');
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': filePath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

// ── Server wiring ─────────────────────────────────────────

const room = new FfaRoom(Date.now());
const sockets = new Map<string, WebSocket>();
let connCounter = 1;

function deliver(outbound: Outbound[]): void {
  for (const { to, msg } of outbound) {
    const raw = encode(msg);
    if (to === 'all') {
      for (const ws of sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(raw);
      }
    } else {
      const ws = sockets.get(to);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
  }
}

const httpServer = createServer((req, res) => {
  if (req.url?.startsWith('/healthz')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        players: room.players.size,
        live: room.isLive,
        remainingMs: room.remainingMs(Date.now()),
      }),
    );
    return;
  }
  void serveStatic(req, res);
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  const id = `p${connCounter++}`;
  let joined = false;

  ws.on('message', (data) => {
    const msg = decode<ClientMsg>(String(data));
    if (!msg) return;

    if (!joined) {
      if (msg.t !== 'join') return; // first message must be join
      const join = msg as JoinMsg;
      void (async () => {
        let name: string | null = null;
        if (join.token) name = await verifySupabaseToken(join.token);
        if (!name) name = sanitizeName(join.name);
        if (!name) name = `Guest ${guestCounter++}`;
        if (ws.readyState !== WebSocket.OPEN) return;
        joined = true;
        sockets.set(id, ws);
        deliver(room.join(id, name, Date.now()));
        console.log(`[room] ${id} joined as "${name}" (${room.players.size} players)`);
      })();
      return;
    }

    deliver(room.handleMessage(id, msg, Date.now()));
  });

  ws.on('close', () => {
    if (!joined) return;
    sockets.delete(id);
    deliver(room.leave(id));
    console.log(`[room] ${id} left (${room.players.size} players)`);
  });

  ws.on('error', () => {
    /* close handler runs after */
  });
});

// Room tick: respawns + clock + match lifecycle (20 Hz).
setInterval(() => {
  deliver(room.tick(Date.now()));
}, 50);

// State broadcast: per-recipient snapshots (excludes own echo).
setInterval(() => {
  const now = Date.now();
  for (const [id, ws] of sockets) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const s = room.statesFor(id, now);
    if (s.length > 0) ws.send(encode({ t: 'states', s }));
  }
}, 1000 / BROADCAST_HZ);

httpServer.listen(PORT, () => {
  console.log(`[bladeboyz-server] listening on :${PORT} (ws path /ws)`);
  console.log(
    `[bladeboyz-server] supabase auth: ${SUPABASE_URL ? 'ENABLED' : 'disabled (guest mode only)'}`,
  );
});
