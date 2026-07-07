/**
 * Regression test for the PR #199 QA blocker: remote-player pitch parity.
 *
 * The hit-accuracy pass leans a swinging player's chest by their camera
 * pitch. For that lean to appear on OTHER clients (so a remote's swing
 * renders at the height they're actually aiming), the pitch must travel on
 * the wire and land in the remote puppet's `Rotation.x`. Before this PR the
 * `pitch` field didn't exist and `Rotation.x` stayed 0 for every remote
 * forever. These tests pin the wire → `Rotation.x` application.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  MovementState,
  RemotePlayer,
  CombatStateComp,
  CombatStateComponent,
} from '../ecs/components';
import {
  pushRemoteState,
  remotePlayerRegistry,
  remotePlayerSystem,
  deriveRemoteGait,
} from './RemotePlayers';
import { CombatState } from '../combat/states';
import { Direction } from '../combat/directions';
import { computeBlockHoldOffsets } from '../animation/blockMotion';
import type { GameWorld } from '../core/types';
import type { NetPlayerState } from './protocol';

function makeRemotePuppet(pitch: number): { eid: number; state: NetPlayerState } {
  const ecs = createWorld();
  addEntity(ecs); // null entity
  const eid = addEntity(ecs);
  addComponent(ecs, Rotation, eid);
  addComponent(ecs, CombatStateComp, eid);
  addComponent(ecs, CombatStateComponent, eid);
  remotePlayerRegistry.set(eid, {
    netId: `net-${eid}`,
    name: 'Remote',
    samples: [],
    weaponId: -1,
    prevCombatState: 0,
    blockStartMs: 0,
  });
  const state: NetPlayerState = {
    id: `net-${eid}`,
    p: { x: 1, y: 0.1, z: 2 },
    yaw: 0.3,
    pitch,
    cs: { s: 0, d: 0, pt: 0, w: 0 },
  };
  return { eid, state };
}

describe('remote pitch parity (PR #199)', () => {
  it('applies streamed pitch to the puppet Rotation.x', () => {
    const { eid, state } = makeRemotePuppet(-0.42);
    pushRemoteState(eid, state, 1000);
    expect(Rotation.x[eid]).toBeCloseTo(-0.42, 6);
    remotePlayerRegistry.delete(eid);
  });

  it('a level aim streams pitch 0 (no residual lean)', () => {
    const { eid, state } = makeRemotePuppet(0);
    // Pre-dirty Rotation.x to prove pushRemoteState overwrites, not accumulates.
    Rotation.x[eid] = 0.9;
    pushRemoteState(eid, state, 2000);
    expect(Rotation.x[eid]).toBe(0);
    remotePlayerRegistry.delete(eid);
  });
});

/**
 * #224 — remote Blocking free-runs `phaseElapsed` client-side so the #218
 * living-guard breathing motion animates for spectators (locally it works
 * off the FSM's free-running phase; remotes have no FSM, so the net layer
 * reconstructs the same clock from wall-clock time held).
 */
describe('remote Blocking free-running clock (#224)', () => {
  const TICK_MS = (1 / 60) * 1000; // FIXED_TIMESTEP in ms

  /** A remote puppet wired for `remotePlayerSystem` (needs RemotePlayer + Position). */
  function makeBlockPuppet(): { world: GameWorld; eid: number } {
    const ecs = createWorld();
    addEntity(ecs); // null entity
    const eid = addEntity(ecs);
    addComponent(ecs, RemotePlayer, eid);
    addComponent(ecs, Position, eid);
    addComponent(ecs, PreviousPosition, eid);
    addComponent(ecs, Rotation, eid);
    addComponent(ecs, PreviousRotation, eid);
    addComponent(ecs, MovementState, eid);
    addComponent(ecs, CombatStateComp, eid);
    addComponent(ecs, CombatStateComponent, eid);
    remotePlayerRegistry.set(eid, {
      netId: `net-${eid}`,
      name: 'Remote',
      samples: [],
      weaponId: -1,
      prevCombatState: CombatState.Idle,
      blockStartMs: 0,
    });
    return { world: { ecs } as unknown as GameWorld, eid };
  }

  function blockState(eid: number, d = Direction.Overhead, pt = 0): NetPlayerState {
    return {
      id: `net-${eid}`,
      p: { x: 0, y: 0.1, z: 0 },
      yaw: 0,
      pitch: 0,
      cs: { s: CombatState.Blocking, d, pt, w: 0 },
    };
  }

  it('advances phaseElapsed monotonically (~60 ticks/sec) as now advances', () => {
    const { world, eid } = makeBlockPuppet();
    pushRemoteState(eid, blockState(eid), 1000); // enter Blocking @ 1000ms

    remotePlayerSystem(world, 1000);
    expect(CombatStateComp.phaseElapsed[eid]).toBe(0);

    remotePlayerSystem(world, 1000 + 500);
    const half = CombatStateComp.phaseElapsed[eid];
    expect(half).toBe(Math.round(500 / TICK_MS)); // ~30

    remotePlayerSystem(world, 1000 + 1000);
    const full = CombatStateComp.phaseElapsed[eid];
    expect(full).toBe(Math.round(1000 / TICK_MS)); // ~60
    expect(full).toBeGreaterThan(half); // monotonic

    remotePlayerRegistry.delete(eid);
  });

  it('sets phaseTotal to 0 (not the synthetic 100) during Blocking', () => {
    const { eid } = makeBlockPuppet();
    // Pre-dirty to prove the reconstruction path is skipped for Blocking.
    CombatStateComp.phaseTotal[eid] = 100;
    pushRemoteState(eid, blockState(eid), 1000);
    expect(CombatStateComp.phaseTotal[eid]).toBe(0);
    expect(CombatStateComp.phaseT[eid]).toBe(0);
    remotePlayerRegistry.delete(eid);
  });

  it('a block-direction change mid-hold does NOT reset the counter', () => {
    const { world, eid } = makeBlockPuppet();
    pushRemoteState(eid, blockState(eid, Direction.Left), 1000); // enter @ 1000
    remotePlayerSystem(world, 1500);
    // Same state (Blocking), new direction — an in-place morph, blockStartMs stays.
    pushRemoteState(eid, blockState(eid, Direction.Right), 1500);
    expect(remotePlayerRegistry.get(eid)!.blockStartMs).toBe(1000);

    remotePlayerSystem(world, 2000);
    // Elapsed measured from the ORIGINAL entry (1000), not the direction change.
    expect(CombatStateComp.phaseElapsed[eid]).toBe(Math.round(1000 / TICK_MS));
    expect(CombatStateComp.direction[eid]).toBe(Direction.Right);
    remotePlayerRegistry.delete(eid);
  });

  it('exiting to a bounded state restores reconstruction; re-entry restarts from 0', () => {
    const { world, eid } = makeBlockPuppet();
    pushRemoteState(eid, blockState(eid), 1000);
    remotePlayerSystem(world, 2000);
    expect(CombatStateComp.phaseElapsed[eid]).toBe(Math.round(1000 / TICK_MS));

    // Exit → Windup at pt = 0.5: bounded reconstruction is byte-identical to before.
    const windup: NetPlayerState = {
      id: `net-${eid}`,
      p: { x: 0, y: 0.1, z: 0 },
      yaw: 0,
      pitch: 0,
      cs: { s: CombatState.Windup, d: Direction.Overhead, pt: 0.5, w: 0 },
    };
    pushRemoteState(eid, windup, 2000);
    expect(CombatStateComp.phaseTotal[eid]).toBe(100);
    expect(CombatStateComp.phaseElapsed[eid]).toBe(50);
    expect(CombatStateComp.phaseT[eid]).toBeCloseTo(0.5, 6);

    // Re-enter Blocking → clock restarts from the new entry time.
    pushRemoteState(eid, blockState(eid), 3000);
    expect(remotePlayerRegistry.get(eid)!.blockStartMs).toBe(3000);
    remotePlayerSystem(world, 3000);
    expect(CombatStateComp.phaseElapsed[eid]).toBe(0);
    remotePlayerRegistry.delete(eid);
  });

  it('bounded-state reconstruction is unchanged for a non-Blocking snapshot', () => {
    const { eid } = makeBlockPuppet();
    const release: NetPlayerState = {
      id: `net-${eid}`,
      p: { x: 0, y: 0.1, z: 0 },
      yaw: 0,
      pitch: 0,
      cs: { s: CombatState.Release, d: Direction.Overhead, pt: 0.75, w: 0 },
    };
    pushRemoteState(eid, release, 1000);
    expect(CombatStateComp.phaseTotal[eid]).toBe(100);
    expect(CombatStateComp.phaseElapsed[eid]).toBe(75);
    expect(CombatStateComp.phaseT[eid]).toBeCloseTo(0.75, 6);
    remotePlayerRegistry.delete(eid);
  });

  it('reconstructed phaseElapsed feeds computeBlockHoldOffsets a live signal (manual-verify substitute)', () => {
    const { world, eid } = makeBlockPuppet();
    pushRemoteState(eid, blockState(eid, Direction.Left), 1000);
    // Hold ~1s so the fade-in has saturated and the wave is well off zero.
    remotePlayerSystem(world, 2000);
    const offsets = computeBlockHoldOffsets(
      CombatStateComp.direction[eid],
      CombatStateComp.phaseElapsed[eid],
    );
    // A frozen statue would yield phaseElapsed 0 → {} (empty). A live clock
    // yields non-empty per-bone Euler offsets → the spectator sees breathing.
    expect(Object.keys(offsets).length).toBeGreaterThan(0);
    remotePlayerRegistry.delete(eid);
  });
});

describe('deriveRemoteGait (#goal-2026-07 locomotion pass)', () => {
  const TICK = 1 / 60;
  const WALK = 4.5;

  it('a stationary puppet decays toward speedFactor 0', () => {
    const g = deriveRemoteGait(0, 0, 0, 1.0);
    expect(g.speedFactor).toBeLessThan(1.0);
    expect(g.sprinting).toBe(0);
    expect(g.grounded).toBe(1);
  });

  it('walking pace converges to speedFactor 1 without sprint flag', () => {
    let factor = 0;
    for (let i = 0; i < 40; i++) {
      factor = deriveRemoteGait(WALK * TICK, 0, 0, factor).speedFactor;
    }
    expect(factor).toBeGreaterThan(0.95);
    expect(deriveRemoteGait(WALK * TICK, 0, 0, factor).sprinting).toBe(0);
  });

  it('sprint pace sets the sprint flag', () => {
    const g = deriveRemoteGait(7.5 * TICK, 0, 0, 0.5);
    expect(g.sprinting).toBe(1);
  });

  it('fast vertical motion reads as airborne; slope noise does not', () => {
    expect(deriveRemoteGait(0, 9 * TICK, 0, 0).grounded).toBe(0);
    expect(deriveRemoteGait(0, 0.5 * TICK, 0, 0).grounded).toBe(1);
  });
});
