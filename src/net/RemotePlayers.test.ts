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
  Rotation,
  CombatStateComp,
  CombatStateComponent,
} from '../ecs/components';
import { pushRemoteState, remotePlayerRegistry, deriveRemoteGait } from './RemotePlayers';
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
