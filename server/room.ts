/**
 * FfaRoom — pure, transport-free FFA match logic. The single source of
 * server authority for: roster, spawn assignment, HP, damage-claim
 * validation, deaths/kill credit, respawns, the scoreboard, and the
 * 15-minute match clock with intermission + reset.
 *
 * No `ws` import, no timers — the caller (server/index.ts) feeds it
 * `join/leave/handleMessage/tick(nowMs)` and delivers the returned
 * `Outbound` envelopes. That keeps every rule unit-testable with a fake
 * clock (see server/room.test.ts).
 *
 * Trust model v1 (see src/net/protocol.ts header): movement is relayed
 * as-reported; damage claims are attacker-authoritative but pass through
 * `validateClaim` — per-claim damage cap, per-attacker→victim rate limit,
 * range check against last reported positions, and alive checks. The
 * doc-04 CoreWorld migration replaces claims with server-side tracers;
 * everything else here (roster/clock/scores) survives that migration.
 */

import type {
  ClientMsg,
  ServerMsg,
  NetSpawn,
  NetScoreRow,
  NetPlayerState,
} from '../src/net/protocol';
import {
  MATCH_DURATION_MS,
  INTERMISSION_MS,
  RESPAWN_DELAY_MS,
} from '../src/net/protocol';
import { ARENA_V2_SPAWNS } from '../src/arena/arenaV2Spec';

// Arena spawn points — the SHARED Arena v2 spawn table (issue #207). The server
// imports the exact same x/z/yaw list the client mesh builder uses, so the two
// tables can never drift (pinned by a deep-equal test in server/room.test.ts).
// The table carries NO y: clients resolve ground-y from the shared terrain
// sampler (`sampleTerrainHeight`) per #206, so the server needs no terrain math.
// `arenaV2Spec.ts` is pure data (no Three.js/Rapier runtime imports), safe to
// bundle into the Node server.
export const ARENA_SPAWNS: NetSpawn[] = ARENA_V2_SPAWNS;

// ── Claim validation tunables ─────────────────────────────

/** Hard per-claim damage cap (highest legit hit: zweihander overhead head 75). */
export const MAX_CLAIM_DAMAGE = 80;

/** Min interval between accepted claims for one attacker→victim pair. */
export const CLAIM_INTERVAL_MS = 250;

/**
 * Max distance between attacker and victim at claim time (largest weapon
 * reach is the spear at 2.4 m + arm + generous latency slack).
 */
export const MAX_CLAIM_RANGE = 7;

/** Position reports older than this don't participate in range checks. */
export const POSITION_STALE_MS = 2_000;

export const MAX_HP = 100;

// ── Types ─────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  name: string;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  /** Last reported state (relayed to others). */
  state: NetPlayerState | null;
  lastStateAt: number;
  /** Pending respawn timestamp (ms), 0 = none. */
  respawnAt: number;
  /** Last accepted claim time per victim id. */
  lastClaimAt: Map<string, number>;
}

export interface Outbound {
  /** 'all' broadcasts to every connected player; otherwise a player id. */
  to: 'all' | string;
  msg: ServerMsg;
}

// ── Room ──────────────────────────────────────────────────

export class FfaRoom {
  readonly players = new Map<string, RoomPlayer>();

  /** Match end timestamp (ms). */
  private matchEndsAt: number;
  /** True while a match is running; false during intermission. */
  private live = true;
  /** When intermission ends and the next match starts. */
  private nextMatchAt = 0;
  private lastClockSentAt = 0;
  private spawnCursor = 0;

  constructor(now: number) {
    this.matchEndsAt = now + MATCH_DURATION_MS;
  }

  get isLive(): boolean {
    return this.live;
  }

  remainingMs(now: number): number {
    return Math.max(0, this.matchEndsAt - now);
  }

  scores(): NetScoreRow[] {
    return Array.from(this.players.values())
      .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  /** Pick the spawn furthest from any living player (fallback: cycle). */
  private pickSpawn(): NetSpawn {
    const living = Array.from(this.players.values()).filter(
      (p) => p.alive && p.state,
    );
    if (living.length === 0) {
      const s = ARENA_SPAWNS[this.spawnCursor % ARENA_SPAWNS.length];
      this.spawnCursor++;
      return s;
    }
    let best = ARENA_SPAWNS[0];
    let bestScore = -1;
    for (const sp of ARENA_SPAWNS) {
      let nearest = Infinity;
      for (const p of living) {
        const st = p.state!;
        const d = (st.p.x - sp.x) ** 2 + (st.p.z - sp.z) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = sp;
      }
    }
    return best;
  }

  join(id: string, name: string, now: number): Outbound[] {
    const spawn = this.pickSpawn();
    const player: RoomPlayer = {
      id,
      name,
      hp: MAX_HP,
      alive: true,
      kills: 0,
      deaths: 0,
      state: null,
      lastStateAt: 0,
      respawnAt: 0,
      lastClaimAt: new Map(),
    };
    this.players.set(id, player);

    const out: Outbound[] = [];
    out.push({
      to: id,
      msg: {
        t: 'welcome',
        id,
        name,
        spawn,
        roster: Array.from(this.players.values()).map((p) => ({
          id: p.id,
          name: p.name,
        })),
        scores: this.scores(),
        match: {
          remainingMs: this.live
            ? this.remainingMs(now)
            : Math.max(0, this.nextMatchAt - now),
          durationMs: MATCH_DURATION_MS,
          live: this.live,
        },
      },
    });
    out.push({ to: 'all', msg: { t: 'playerJoined', id, name, spawn } });
    out.push({ to: 'all', msg: { t: 'scores', list: this.scores() } });
    return out;
  }

  leave(id: string): Outbound[] {
    if (!this.players.delete(id)) return [];
    return [
      { to: 'all', msg: { t: 'playerLeft', id } },
      { to: 'all', msg: { t: 'scores', list: this.scores() } },
    ];
  }

  handleMessage(id: string, msg: ClientMsg, now: number): Outbound[] {
    const player = this.players.get(id);
    if (!player) return [];
    switch (msg.t) {
      case 'state':
        if (
          !msg.p ||
          !Number.isFinite(msg.p.x) ||
          !Number.isFinite(msg.p.y) ||
          !Number.isFinite(msg.p.z) ||
          !Number.isFinite(msg.yaw)
        ) {
          return [];
        }
        player.state = {
          id,
          p: msg.p,
          yaw: msg.yaw,
          // Relay pitch as-is; default 0 defends against a client that
          // omits it (older bundle / hand-built test message).
          pitch: Number.isFinite(msg.pitch) ? msg.pitch : 0,
          cs: msg.cs,
        };
        player.lastStateAt = now;
        return [];
      case 'claim':
        return this.handleClaim(player, msg.v, msg.dmg, msg.w, msg.dir, msg.region, now);
      case 'ping':
        return [{ to: id, msg: { t: 'pong', n: msg.n } }];
      default:
        return [];
    }
  }

  private handleClaim(
    attacker: RoomPlayer,
    victimId: string,
    rawDmg: number,
    weaponId: number,
    dir: number,
    region: number,
    now: number,
  ): Outbound[] {
    const victim = this.players.get(victimId);
    if (!victim) return [];
    if (!this.live) return [];
    if (!attacker.alive || !victim.alive) return [];
    if (attacker.id === victim.id) return [];
    if (!Number.isFinite(rawDmg) || rawDmg <= 0) return [];

    // Rate limit per attacker→victim pair.
    const last = attacker.lastClaimAt.get(victimId) ?? 0;
    if (now - last < CLAIM_INTERVAL_MS) return [];

    // Range check when both positions are fresh.
    const a = attacker.state;
    const v = victim.state;
    if (
      a &&
      v &&
      now - attacker.lastStateAt < POSITION_STALE_MS &&
      now - victim.lastStateAt < POSITION_STALE_MS
    ) {
      const d = Math.hypot(a.p.x - v.p.x, a.p.z - v.p.z);
      if (d > MAX_CLAIM_RANGE) return [];
    }

    attacker.lastClaimAt.set(victimId, now);
    const dmg = Math.min(MAX_CLAIM_DAMAGE, Math.round(rawDmg));
    victim.hp = Math.max(0, victim.hp - dmg);

    const out: Outbound[] = [
      {
        to: 'all',
        msg: {
          t: 'hp',
          id: victim.id,
          hp: victim.hp,
          from: attacker.id,
          dmg,
          region,
          dir,
          w: weaponId,
        },
      },
    ];

    if (victim.hp <= 0) {
      victim.alive = false;
      victim.deaths += 1;
      attacker.kills += 1;
      victim.respawnAt = now + RESPAWN_DELAY_MS;
      out.push({
        to: 'all',
        msg: { t: 'death', victim: victim.id, killer: attacker.id, w: weaponId },
      });
      out.push({ to: 'all', msg: { t: 'scores', list: this.scores() } });
    }
    return out;
  }

  /**
   * Advance time-driven state: respawns, the 1 Hz clock broadcast, match
   * end → intermission → reset. Call every server tick (~50 ms).
   */
  tick(now: number): Outbound[] {
    const out: Outbound[] = [];

    // Respawns.
    for (const p of this.players.values()) {
      if (!p.alive && p.respawnAt > 0 && now >= p.respawnAt) {
        p.alive = true;
        p.hp = MAX_HP;
        p.respawnAt = 0;
        const spawn = this.pickSpawn();
        out.push({ to: 'all', msg: { t: 'respawn', id: p.id, spawn } });
      }
    }

    // Match clock / lifecycle.
    if (this.live && now >= this.matchEndsAt) {
      this.live = false;
      this.nextMatchAt = now + INTERMISSION_MS;
      out.push({
        to: 'all',
        msg: {
          t: 'matchEnd',
          standings: this.scores(),
          intermissionMs: INTERMISSION_MS,
        },
      });
    } else if (!this.live && now >= this.nextMatchAt) {
      this.live = true;
      this.matchEndsAt = now + MATCH_DURATION_MS;
      for (const p of this.players.values()) {
        p.kills = 0;
        p.deaths = 0;
        p.hp = MAX_HP;
        p.alive = true;
        p.respawnAt = 0;
        const spawn = this.pickSpawn();
        out.push({ to: 'all', msg: { t: 'respawn', id: p.id, spawn } });
      }
      out.push({ to: 'all', msg: { t: 'matchStart', durationMs: MATCH_DURATION_MS } });
      out.push({ to: 'all', msg: { t: 'scores', list: this.scores() } });
    }

    // 1 Hz clock.
    if (now - this.lastClockSentAt >= 1_000) {
      this.lastClockSentAt = now;
      out.push({
        to: 'all',
        msg: {
          t: 'clock',
          remainingMs: this.live
            ? this.remainingMs(now)
            : Math.max(0, this.nextMatchAt - now),
          live: this.live,
        },
      });
    }

    return out;
  }

  /** Snapshot of all fresh player states EXCEPT `excludeId`'s own. */
  statesFor(excludeId: string, now: number): NetPlayerState[] {
    const list: NetPlayerState[] = [];
    for (const p of this.players.values()) {
      if (p.id === excludeId) continue;
      if (!p.state) continue;
      if (now - p.lastStateAt > POSITION_STALE_MS) continue;
      list.push(p.state);
    }
    return list;
  }
}
