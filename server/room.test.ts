/**
 * FfaRoom unit tests — fake clock, no sockets. Pins the authority rules:
 * join/leave/roster, damage-claim validation (caps, rate, range, alive),
 * death → kill credit → respawn, and the 15-minute match lifecycle with
 * intermission + score reset.
 */

import { describe, it, expect } from 'vitest';
import {
  FfaRoom,
  MAX_CLAIM_DAMAGE,
  CLAIM_INTERVAL_MS,
  MAX_CLAIM_RANGE,
  ARENA_SPAWNS,
} from './room';
import {
  MATCH_DURATION_MS,
  INTERMISSION_MS,
  RESPAWN_DELAY_MS,
  type ServerMsg,
} from '../src/net/protocol';
import { ARENA_V2_SPAWNS } from '../src/arena/arenaV2Spec';

const T0 = 1_000_000;

function msgs(out: Array<{ msg: ServerMsg }>, type: string): ServerMsg[] {
  return out.filter((o) => o.msg.t === type).map((o) => o.msg);
}

function joinTwo(room: FfaRoom): void {
  room.join('a', 'Alice', T0);
  room.join('b', 'Bob', T0);
  // Fresh position reports 3 m apart.
  room.handleMessage(
    'a',
    { t: 'state', p: { x: 0, y: 0.1, z: 0 }, yaw: 0, pitch: 0, cs: { s: 0, d: 0, pt: 0, w: 0 } },
    T0,
  );
  room.handleMessage(
    'b',
    { t: 'state', p: { x: 3, y: 0.1, z: 0 }, yaw: 0, pitch: 0, cs: { s: 0, d: 0, pt: 0, w: 0 } },
    T0,
  );
}

describe('FfaRoom — spawn table lockstep (#207)', () => {
  it('server ARENA_SPAWNS is exactly the shared Arena v2 spawn table (no drift)', () => {
    // The server must not silently diverge from the client map. Both import
    // the same source; assert-equal here kills the drift failure mode.
    expect(ARENA_SPAWNS).toHaveLength(10);
    expect(ARENA_SPAWNS).toEqual(
      ARENA_V2_SPAWNS.map((s) => ({ x: s.x, z: s.z, yaw: s.yaw })),
    );
  });

  it('every server spawn carries x/z/yaw and NO y (client resolves y from terrain)', () => {
    for (const s of ARENA_SPAWNS) {
      expect(Object.keys(s).sort()).toEqual(['x', 'yaw', 'z']);
    }
  });
});

describe('FfaRoom — roster', () => {
  it('join sends welcome with spawn + roster; leave broadcasts', () => {
    const room = new FfaRoom(T0);
    const out = room.join('a', 'Alice', T0);
    const welcome = msgs(out, 'welcome')[0] as Extract<ServerMsg, { t: 'welcome' }>;
    expect(welcome.id).toBe('a');
    expect(ARENA_SPAWNS.some((s) => s.x === welcome.spawn.x && s.z === welcome.spawn.z)).toBe(true);
    expect(welcome.match.durationMs).toBe(MATCH_DURATION_MS);
    expect(welcome.match.live).toBe(true);

    const left = room.leave('a');
    expect(msgs(left, 'playerLeft')).toHaveLength(1);
  });
});

describe('FfaRoom — damage claims', () => {
  it('valid claim applies clamped damage and broadcasts hp', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    const out = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 40, w: 0, dir: 0, region: 1 },
      T0 + 100,
    );
    const hp = msgs(out, 'hp')[0] as Extract<ServerMsg, { t: 'hp' }>;
    expect(hp.hp).toBe(60);
    expect(hp.from).toBe('a');
  });

  it('clamps absurd damage to MAX_CLAIM_DAMAGE', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    const out = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 9999, w: 0, dir: 0, region: 0 },
      T0 + 100,
    );
    const hp = msgs(out, 'hp')[0] as Extract<ServerMsg, { t: 'hp' }>;
    expect(hp.dmg).toBe(MAX_CLAIM_DAMAGE);
  });

  it('rate-limits claims per attacker→victim pair', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    room.handleMessage('a', { t: 'claim', v: 'b', dmg: 10, w: 0, dir: 0, region: 1 }, T0 + 100);
    const tooSoon = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 10, w: 0, dir: 0, region: 1 },
      T0 + 100 + CLAIM_INTERVAL_MS - 50,
    );
    expect(tooSoon).toHaveLength(0);
    const okLater = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 10, w: 0, dir: 0, region: 1 },
      T0 + 100 + CLAIM_INTERVAL_MS + 1,
    );
    expect(msgs(okLater, 'hp')).toHaveLength(1);
  });

  it('rejects out-of-range claims when positions are fresh', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    room.handleMessage(
      'b',
      {
        t: 'state',
        p: { x: MAX_CLAIM_RANGE + 5, y: 0.1, z: 0 },
        yaw: 0,
        pitch: 0,
        cs: { s: 0, d: 0, pt: 0, w: 0 },
      },
      T0 + 50,
    );
    const out = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 40, w: 0, dir: 0, region: 1 },
      T0 + 100,
    );
    expect(out).toHaveLength(0);
  });

  it('rejects self-claims and claims on dead victims', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    expect(
      room.handleMessage('a', { t: 'claim', v: 'a', dmg: 10, w: 0, dir: 0, region: 1 }, T0 + 100),
    ).toHaveLength(0);

    // Kill b (100 HP → two 80-caps).
    room.handleMessage('a', { t: 'claim', v: 'b', dmg: 80, w: 0, dir: 0, region: 0 }, T0 + 100);
    const kill = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 80, w: 0, dir: 0, region: 0 },
      T0 + 100 + CLAIM_INTERVAL_MS + 1,
    );
    expect(msgs(kill, 'death')).toHaveLength(1);

    const onDead = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 10, w: 0, dir: 0, region: 1 },
      T0 + 2 * CLAIM_INTERVAL_MS + 200,
    );
    expect(onDead).toHaveLength(0);
  });
});

describe('FfaRoom — death, kill credit, respawn', () => {
  it('death credits the killer, updates scores, respawns after delay', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    room.handleMessage('a', { t: 'claim', v: 'b', dmg: 80, w: 3, dir: 0, region: 0 }, T0 + 100);
    const kill = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 80, w: 3, dir: 0, region: 0 },
      T0 + 100 + CLAIM_INTERVAL_MS + 1,
    );
    const death = msgs(kill, 'death')[0] as Extract<ServerMsg, { t: 'death' }>;
    expect(death.victim).toBe('b');
    expect(death.killer).toBe('a');
    const scores = msgs(kill, 'scores')[0] as Extract<ServerMsg, { t: 'scores' }>;
    expect(scores.list.find((r) => r.id === 'a')!.kills).toBe(1);
    expect(scores.list.find((r) => r.id === 'b')!.deaths).toBe(1);

    // Not respawned before the delay…
    const early = room.tick(T0 + 100 + CLAIM_INTERVAL_MS + RESPAWN_DELAY_MS - 100);
    expect(msgs(early, 'respawn')).toHaveLength(0);
    // …respawned after.
    const later = room.tick(T0 + 200 + CLAIM_INTERVAL_MS + RESPAWN_DELAY_MS + 100);
    const respawn = msgs(later, 'respawn')[0] as Extract<ServerMsg, { t: 'respawn' }>;
    expect(respawn.id).toBe('b');
  });
});

describe('FfaRoom — match lifecycle', () => {
  it('runs 15 minutes, ends with standings, restarts after intermission with reset scores', () => {
    const room = new FfaRoom(T0);
    joinTwo(room);
    room.handleMessage('a', { t: 'claim', v: 'b', dmg: 80, w: 0, dir: 0, region: 0 }, T0 + 100);
    room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 80, w: 0, dir: 0, region: 0 },
      T0 + 100 + CLAIM_INTERVAL_MS + 1,
    );

    // Just before the end: still live.
    expect(msgs(room.tick(T0 + MATCH_DURATION_MS - 1_500), 'matchEnd')).toHaveLength(0);
    expect(room.isLive).toBe(true);

    // Past the end: matchEnd with standings.
    const end = room.tick(T0 + MATCH_DURATION_MS + 1);
    const endMsg = msgs(end, 'matchEnd')[0] as Extract<ServerMsg, { t: 'matchEnd' }>;
    expect(endMsg.standings[0].id).toBe('a'); // killer tops the board
    expect(room.isLive).toBe(false);

    // Claims rejected during intermission.
    const midClaim = room.handleMessage(
      'a',
      { t: 'claim', v: 'b', dmg: 10, w: 0, dir: 0, region: 1 },
      T0 + MATCH_DURATION_MS + 2_000,
    );
    expect(midClaim).toHaveLength(0);

    // After intermission: fresh match, zeroed scores, everyone respawned.
    const restart = room.tick(T0 + MATCH_DURATION_MS + INTERMISSION_MS + 100);
    expect(msgs(restart, 'matchStart')).toHaveLength(1);
    const scores = msgs(restart, 'scores')[0] as Extract<ServerMsg, { t: 'scores' }>;
    expect(scores.list.every((r) => r.kills === 0 && r.deaths === 0)).toBe(true);
    expect(msgs(restart, 'respawn').length).toBe(2);
    expect(room.isLive).toBe(true);
  });
});
