/**
 * BotAISystem unit tests (AC #9 of issue #119) — pure ECS, no Rapier, no
 * scene graph. The system only reads/writes components and drives the
 * (physics-free) CombatFSM, so a bare bitECS world + a stub GameWorld is
 * enough to pin:
 *   - Approach ↔ Engage ↔ Reposition mode transitions by distance
 *   - facing (Rotation.y aims at the target)
 *   - swing cadence (FSM Attack issued in range, gated by cooldown)
 *   - retarget on target despawn / idle when no target exists
 *   - knocked-back and dead bots stand down
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent, removeEntity } from 'bitecs';
import {
  Bot,
  BotBrain,
  Player,
  Position,
  Rotation,
  MovementIntent,
  DeadTag,
  KnockbackState,
} from '../components';
import { createBotAISystem, BotMode, pickSwingDirection } from './BotAISystem';
import { createFSM, fsmRegistry, setFsmTraceEnabled } from '../../combat/CombatFSM';
import { CombatState } from '../../combat/states';
import { longsword } from '../../weapons/longsword';
import { advanceFixedTick, resetFixedTick } from '../../core/tickCounter';
import type { GameWorld } from '../../core/types';

function makeWorld(): GameWorld {
  const ecs = createWorld();
  // Reserve the NULL entity (id 0) — mirrors createGameWorld.
  addEntity(ecs);
  return { ecs } as unknown as GameWorld;
}

function makePlayer(world: GameWorld, x: number, z: number): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, Player, eid);
  addComponent(world.ecs, Position, eid);
  Position.x[eid] = x;
  Position.z[eid] = z;
  return eid;
}

function makeBot(
  world: GameWorld,
  x: number,
  z: number,
  targetEid: number,
  meleeRange = 1.3,
): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, Bot, eid);
  addComponent(world.ecs, BotBrain, eid);
  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, Rotation, eid);
  addComponent(world.ecs, MovementIntent, eid);
  addComponent(world.ecs, KnockbackState, eid);
  Position.x[eid] = x;
  Position.z[eid] = z;
  BotBrain.targetEid[eid] = targetEid;
  BotBrain.meleeRange[eid] = meleeRange;
  BotBrain.prevX[eid] = x;
  BotBrain.prevZ[eid] = z;
  createFSM(eid, longsword);
  return eid;
}

beforeEach(() => {
  setFsmTraceEnabled(false);
  fsmRegistry.clear();
  resetFixedTick();
});

describe('BotAISystem — mode transitions', () => {
  it('Approach outside meleeRange: intent points at the target', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -8, player);
    createBotAISystem(world)();
    expect(BotBrain.mode[bot]).toBe(BotMode.Approach);
    // Target is at +Z relative to the bot.
    expect(MovementIntent.moveZ[bot]).toBeGreaterThan(0);
    expect(Math.abs(MovementIntent.moveX[bot])).toBeLessThan(0.01);
  });

  it('Engage inside meleeRange: intent zeroed', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -1.1, player);
    createBotAISystem(world)();
    expect(BotBrain.mode[bot]).toBe(BotMode.Engage);
    expect(MovementIntent.moveX[bot]).toBe(0);
    expect(MovementIntent.moveZ[bot]).toBe(0);
  });

  it('Reposition when body-blocking close: intent points away', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -0.5, player);
    createBotAISystem(world)();
    expect(BotBrain.mode[bot]).toBe(BotMode.Reposition);
    expect(MovementIntent.moveZ[bot]).toBeLessThan(0); // backs off along -Z
  });

  it('faces the target (Rotation.y) in every mode', () => {
    const world = makeWorld();
    const player = makePlayer(world, 5, 0);
    const bot = makeBot(world, 0, 0, player);
    createBotAISystem(world)();
    // Target due +X → yaw = atan2(-5, 0) = -π/2.
    expect(Rotation.y[bot]).toBeCloseTo(-Math.PI / 2, 4);
  });
});

describe('BotAISystem — swing cadence', () => {
  it('swings (FSM leaves Idle) when in range, then respects the cooldown', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -1.1, player);
    const system = createBotAISystem(world);

    advanceFixedTick();
    system();
    const fsm = fsmRegistry.get(bot)!;
    expect(fsm.state).toBe(CombatState.Windup);
    const firstSwingTick = BotBrain.lastSwingTick[bot];

    // Force the FSM back to Idle immediately — the cooldown alone must
    // prevent a second swing on the next tick.
    fsm.reset();
    advanceFixedTick();
    system();
    expect(fsm.state).toBe(CombatState.Idle);
    expect(BotBrain.lastSwingTick[bot]).toBe(firstSwingTick);
  });

  it('does not swing outside meleeRange', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -6, player);
    advanceFixedTick();
    createBotAISystem(world)();
    expect(fsmRegistry.get(bot)!.state).toBe(CombatState.Idle);
  });
});

describe('BotAISystem — retargeting', () => {
  it('retargets to the nearest living Player when the target despawns', () => {
    const world = makeWorld();
    const p1 = makePlayer(world, 0, 0);
    const p2 = makePlayer(world, 3, 0);
    const bot = makeBot(world, 5, 0, p1);
    const system = createBotAISystem(world);

    removeEntity(world.ecs, p1); // despawn the original target
    system();
    expect(BotBrain.targetEid[bot]).toBe(p2);
    expect(BotBrain.mode[bot]).toBe(BotMode.Approach);
    expect(MovementIntent.moveX[bot]).toBeLessThan(0); // heads toward p2 at -X
  });

  it('idles (zero intent) when no valid target exists', () => {
    const world = makeWorld();
    const p1 = makePlayer(world, 0, 0);
    const bot = makeBot(world, 5, 0, p1);
    const system = createBotAISystem(world);
    removeEntity(world.ecs, p1);
    system();
    expect(MovementIntent.moveX[bot]).toBe(0);
    expect(MovementIntent.moveZ[bot]).toBe(0);
  });

  it('does NOT retarget away from a merely-dead target (it respawns)', () => {
    const world = makeWorld();
    const p1 = makePlayer(world, 0, 0);
    const p2 = makePlayer(world, 3, 0);
    const bot = makeBot(world, 5, 0, p1);
    addComponent(world.ecs, DeadTag, p1);
    createBotAISystem(world)();
    expect(BotBrain.targetEid[bot]).toBe(p1);
    // …but it stands down while the target is dead.
    expect(MovementIntent.moveX[bot]).toBe(0);
    expect(MovementIntent.moveZ[bot]).toBe(0);
    void p2;
  });
});

describe('BotAISystem — stand-down states', () => {
  it('dead bots write zero intent', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -8, player);
    addComponent(world.ecs, DeadTag, bot);
    createBotAISystem(world)();
    expect(MovementIntent.moveX[bot]).toBe(0);
    expect(MovementIntent.moveZ[bot]).toBe(0);
  });

  it('knocked-back bots write zero intent', () => {
    const world = makeWorld();
    const player = makePlayer(world, 0, 0);
    const bot = makeBot(world, 0, -8, player);
    KnockbackState.ticksRemaining[bot] = 30;
    createBotAISystem(world)();
    expect(MovementIntent.moveX[bot]).toBe(0);
    expect(MovementIntent.moveZ[bot]).toBe(0);
  });
});

describe('pickSwingDirection', () => {
  it('is deterministic per (tick, eid) and covers all four directions', () => {
    expect(pickSwingDirection(42, 3)).toBe(pickSwingDirection(42, 3));
    const seen = new Set<number>();
    for (let t = 0; t < 400; t += 7) seen.add(pickSwingDirection(t, 3));
    expect(seen.size).toBe(4);
  });
});
