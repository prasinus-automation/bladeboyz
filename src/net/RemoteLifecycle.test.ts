/**
 * Regression test for the PR #193 QA blocker: server-owned remote puppets
 * must NEVER enter the local death/respawn lifecycle. A RemotePlayer whose
 * HP hits 0 (server hp echo) must not be DeadTag'd, timer-tracked, or
 * teleported by healthSystemTick/processRespawns.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent, hasComponent } from 'bitecs';
import {
  Health,
  RemotePlayer,
  DeadTag,
  RespawnPending,
  Position,
} from '../ecs/components';
import { healthSystemTick, resetHealthTracking } from '../ecs/systems/HealthSystem';
import type { IWorld } from 'bitecs';

function makeRemote(ecs: IWorld, hp: number): number {
  const eid = addEntity(ecs);
  addComponent(ecs, RemotePlayer, eid);
  addComponent(ecs, Health, eid);
  addComponent(ecs, Position, eid);
  Health.current[eid] = hp;
  Health.max[eid] = 100;
  Position.x[eid] = 5;
  Position.z[eid] = 5;
  return eid;
}

beforeEach(() => {
  resetHealthTracking();
});

describe('remote players are excluded from the local lifecycle', () => {
  it('HP 0 does NOT death-tag a RemotePlayer or push it into died[]', () => {
    const ecs = createWorld();
    addEntity(ecs); // null entity
    const remote = makeRemote(ecs, 0);

    const { died } = healthSystemTick(ecs);

    expect(died).not.toContain(remote);
    expect(hasComponent(ecs, DeadTag, remote)).toBe(false);
    expect(hasComponent(ecs, RespawnPending, remote)).toBe(false);
  });

  it('a local entity at 0 HP alongside a remote still dies normally', () => {
    const ecs = createWorld();
    addEntity(ecs); // null entity
    const remote = makeRemote(ecs, 0);
    const local = addEntity(ecs);
    addComponent(ecs, Health, local);
    Health.current[local] = 0;
    Health.max[local] = 100;

    const { died } = healthSystemTick(ecs);

    expect(died).toContain(local);
    expect(died).not.toContain(remote);
    expect(hasComponent(ecs, DeadTag, local)).toBe(true);
    expect(hasComponent(ecs, DeadTag, remote)).toBe(false);
  });

  it('a RemotePlayer never accrues a respawn timer across many ticks', () => {
    const ecs = createWorld();
    addEntity(ecs); // null entity
    const remote = makeRemote(ecs, 0);
    const startX = Position.x[remote];

    for (let i = 0; i < 200; i++) healthSystemTick(ecs);

    expect(hasComponent(ecs, DeadTag, remote)).toBe(false);
    expect(hasComponent(ecs, RespawnPending, remote)).toBe(false);
    expect(Position.x[remote]).toBe(startX); // never teleported
  });
});
