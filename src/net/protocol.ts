/**
 * Multiplayer wire protocol v1 — shared by the browser client (`src/net/`)
 * and the Node game server (`server/`).
 *
 * TRANSPORT (per docs/networking/01): one WebSocket per client, upgrade on
 * the same HTTP listener that serves the bundle, path `/ws`.
 *
 * ENCODING v1: JSON text frames. Doc 01 §1.1 specifies binary msgpackr
 * frames for the full snapshot/delta protocol (doc 02); this relay-v1
 * protocol is deliberately JSON — at FFA scale (≤8 players × 20 Hz × ~200
 * bytes) bandwidth is a non-issue and debuggability wins. The message
 * VOCABULARY below is designed to survive the doc-02 migration: switching
 * encoding does not change message semantics.
 *
 * AUTHORITY v1 (documented trust model): the server owns the roster,
 * scoreboard, match clock, HP, deaths, and respawns. Movement is
 * client-authoritative (each client simulates itself; the server relays).
 * Hits are ATTACKER-claimed with server-side sanity caps (range, rate,
 * per-claim damage). This is honest-client netcode — fine for warmup FFA,
 * NOT for ranked play. The migration path to full server simulation is
 * docs/networking/04 (CoreWorld split); this protocol's `claim` message is
 * exactly the seam that disappears when the server runs its own tracers.
 */

// ── Shared shapes ─────────────────────────────────────────

export interface NetVec3 {
  x: number;
  y: number;
  z: number;
}

/** Compact combat-state mirror for remote-player animation. */
export interface NetCombatState {
  /** CombatState enum value */
  s: number;
  /** Direction enum value */
  d: number;
  /** phaseT 0..1 (drives remote swing animation) */
  pt: number;
  /** weaponId (index into weaponIdToName) */
  w: number;
}

export interface NetPlayerState {
  id: string;
  p: NetVec3;
  yaw: number;
  /** Camera pitch (Rotation.x, positive = looking up). Drives the remote
   * puppet's chest lean so its swing plane matches the real player's aim. */
  pitch: number;
  cs: NetCombatState;
}

export interface NetSpawn {
  x: number;
  z: number;
  yaw: number;
}

export interface NetScoreRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
}

// ── Client → Server ───────────────────────────────────────

export interface JoinMsg {
  t: 'join';
  /** Display name (guest). Ignored when a valid Supabase token is sent. */
  name?: string;
  /** Supabase access token — server verifies and uses profile identity. */
  token?: string;
}

export interface StateMsg {
  t: 'state';
  p: NetVec3;
  yaw: number;
  /** Camera pitch (Rotation.x, positive = looking up). See NetPlayerState. */
  pitch: number;
  cs: NetCombatState;
}

export interface ClaimMsg {
  t: 'claim';
  /** Victim player id */
  v: string;
  /** Damage amount (server clamps) */
  dmg: number;
  /** weaponId */
  w: number;
  /** Direction enum */
  dir: number;
  /** BodyRegion enum */
  region: number;
}

export interface PingMsg {
  t: 'ping';
  n: number;
}

export type ClientMsg = JoinMsg | StateMsg | ClaimMsg | PingMsg;

// ── Server → Client ───────────────────────────────────────

export interface WelcomeMsg {
  t: 'welcome';
  id: string;
  name: string;
  spawn: NetSpawn;
  roster: Array<{ id: string; name: string }>;
  scores: NetScoreRow[];
  match: { remainingMs: number; durationMs: number; live: boolean };
}

export interface PlayerJoinedMsg {
  t: 'playerJoined';
  id: string;
  name: string;
  spawn: NetSpawn;
}

export interface PlayerLeftMsg {
  t: 'playerLeft';
  id: string;
}

export interface StatesMsg {
  t: 'states';
  s: NetPlayerState[];
}

export interface HpMsg {
  t: 'hp';
  id: string;
  hp: number;
  /** attacker id ('' for non-attack adjustments) */
  from: string;
  dmg: number;
  region: number;
  dir: number;
  /** weaponId the damage was dealt with (drives knockback feel) */
  w: number;
}

export interface DeathMsg {
  t: 'death';
  victim: string;
  killer: string;
  w: number;
}

export interface RespawnMsg {
  t: 'respawn';
  id: string;
  spawn: NetSpawn;
}

export interface ScoresMsg {
  t: 'scores';
  list: NetScoreRow[];
}

export interface ClockMsg {
  t: 'clock';
  remainingMs: number;
  live: boolean;
}

export interface MatchEndMsg {
  t: 'matchEnd';
  standings: NetScoreRow[];
  /** ms until the next match starts */
  intermissionMs: number;
}

export interface MatchStartMsg {
  t: 'matchStart';
  durationMs: number;
}

export interface PongMsg {
  t: 'pong';
  n: number;
}

export interface ErrorMsg {
  t: 'error';
  code: string;
  message: string;
}

export type ServerMsg =
  | WelcomeMsg
  | PlayerJoinedMsg
  | PlayerLeftMsg
  | StatesMsg
  | HpMsg
  | DeathMsg
  | RespawnMsg
  | ScoresMsg
  | ClockMsg
  | MatchEndMsg
  | MatchStartMsg
  | PongMsg
  | ErrorMsg;

// ── Tunables (single source of truth for client + server) ─

/** Match length: 15 minutes. */
export const MATCH_DURATION_MS = 15 * 60 * 1000;

/** Post-match intermission before scores reset and a new match starts. */
export const INTERMISSION_MS = 10_000;

/** Server → client state broadcast rate. */
export const BROADCAST_HZ = 20;

/** Client → server local-state send rate. */
export const CLIENT_SEND_HZ = 20;

/** Respawn delay (matches single-player RESPAWN_DELAY_TICKS = 180 @ 60 Hz). */
export const RESPAWN_DELAY_MS = 3_000;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decode<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as T & { t?: string };
    if (!parsed || typeof parsed.t !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
