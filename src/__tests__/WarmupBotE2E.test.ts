/**
 * Warmup-bot end-to-end test (issue #119) — REAL physics, REAL AI loop.
 *
 * Boots the same full pipeline as CombatEndToEnd.test.ts plus the bot
 * stack: BotAISystem → MovementSystem (bots move through the actual
 * character controller) → CombatSystem (bot FSM swings) → tracers →
 * damage → death pipeline → gold → respawn.
 *
 * Pins the three promises that make bots the game's first real opponents:
 *   1. A bot APPROACHES the player and lands hits (player HP drops).
 *   2. Killing a bot emits a DeathEvent, pays the player 25 gold, and the
 *      bot respawns 3 s later at a spawn point with full HP.
 *   3. Bots aim themselves (Rotation.y tracks their target, not the camera).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, addEntity, hasComponent } from 'bitecs';

import type { GameWorld } from '../core/types';
import { FIXED_TIMESTEP } from '../core/types';
import { createPlayer } from '../ecs/entities/createPlayer';
import {
  createWarmupBot,
  getWarmupBotEids,
  removeWarmupBot,
  toggleWarmupBot,
} from '../ecs/entities/createWarmupBot';
import { createBotAISystem, pickSwingDirection } from '../ecs/systems/BotAISystem';
import {
  createCombatSystem,
  resetCombatInputState,
  weaponIdToName,
} from '../ecs/systems/CombatSystem';
import { createMovementSystem, resetMovementState } from '../ecs/systems/MovementSystem';
import { hitboxSystem } from '../ecs/systems/HitboxSystem';
import {
  TracerSystem,
  weaponConfigMap,
  weaponBoneMap,
  colliderToHitbox,
  tracerStates,
} from '../ecs/systems/TracerSystem';
import { DamageSystem, clearDamageAttribution } from '../ecs/systems/DamageSystem';
import { knockbackSystem } from '../ecs/systems/KnockbackSystem';
import { animationSystem, resetAnimationSystem } from '../ecs/systems/AnimationSystem';
import { healthSystemTick, resetHealthTracking } from '../ecs/systems/HealthSystem';
import { processDeaths } from '../ecs/systems/processDeaths';
import { processRespawns } from '../ecs/systems/processRespawns';
import { staminaSystemTick } from '../ecs/systems/StaminaSystem';
import {
  tickTrainingDummyHealthReset,
  npcLastHitTick,
} from '../ecs/entities/createTrainingDummy';
import { createNpcDamageObserver } from '../ecs/systems/NpcDamageObserver';
import { createFSM, fsmRegistry } from '../combat/CombatFSM';
import { Direction } from '../combat/directions';
import { weaponConfigs } from '../weapons/WeaponConfig';
import {
  Health,
  Gold,
  Position,
  Rotation,
  DeadTag,
  meshRegistry,
  hitboxColliderRegistry,
} from '../ecs/components';
import { advanceFixedTick, resetFixedTick } from '../core/tickCounter';
import { EventBus } from '../events/EventBus';
import { npcRegistry } from '../ecs/npcRegistry';
import {
  clearSpawnPoints,
  seedPlaceholderSpawnPoints,
} from '../world/SpawnPoints';
import { awardGoldOnKill } from '../economy/goldEconomy';
import type { FloatingDamage } from '../hud/FloatingDamage';
import type { DeathEventPayload } from '../events/types';

import '../weapons/longsword';
import '../weapons/mace';
import '../weapons/dagger';
import '../weapons/battleaxe';

class FakeInput {
  buttons = new Set<number>();
  avgDelta = { dx: 0, dy: 0 };
  isMouseButtonDown(btn: number): boolean {
    return this.buttons.has(btn);
  }
  getAccumulatedDelta(): { dx: number; dy: number } {
    return { ...this.avgDelta };
  }
  getMouseDelta(): { dx: number; dy: number } {
    return { ...this.avgDelta };
  }
}

let rapierReady = false;

beforeAll(async () => {
  if (!rapierReady) {
    await RAPIER.init();
    rapierReady = true;
  }
});

beforeEach(() => {
  meshRegistry.clear();
  fsmRegistry.clear();
  hitboxColliderRegistry.clear();
  weaponBoneMap.clear();
  colliderToHitbox.clear();
  tracerStates.clear();
  npcRegistry.clear();
  npcLastHitTick.clear();
  clearDamageAttribution();
  resetAnimationSystem();
  resetMovementState();
  resetCombatInputState();
  resetHealthTracking();
  resetFixedTick();
  EventBus.clear();
  clearSpawnPoints();
  seedPlaceholderSpawnPoints();
  weaponConfigMap.clear();
  for (const [name, config] of Object.entries(weaponConfigs)) {
    const idx = weaponIdToName.indexOf(name);
    if (idx >= 0) weaponConfigMap.set(idx, config);
  }
});

interface BotHarness {
  world: GameWorld;
  input: FakeInput;
  playerEid: number;
  botEid: number;
  deaths: DeathEventPayload[];
  runTicks: (n: number) => void;
}

function buildHarness(botPos: { x: number; z: number }): BotHarness {
  const physicsWorld = new RAPIER.World(new RAPIER.Vector3(0, -22, 0));
  const groundBody = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(15, 0.1, 15).setTranslation(0, 0, 0),
    groundBody,
  );
  const world: GameWorld = {
    ecs: (() => {
      const ecs = createWorld();
      // Reserve eid 0 as the NULL entity — mirrors createGameWorld. The
      // event schema's "0 = no entity" sentinel (killerEid, targetEid)
      // is only sound if nothing real ever gets id 0.
      addEntity(ecs);
      return ecs;
    })(),
    scene: new THREE.Scene(),
    renderer: null as unknown as THREE.WebGLRenderer,
    rapier: RAPIER,
    physicsWorld,
    camera: new THREE.PerspectiveCamera(),
    playerEntity: -1,
  };

  const input = new FakeInput();
  const { eid: playerEid } = createPlayer(world, { x: 0, z: 0 });
  world.playerEntity = playerEid;
  createFSM(playerEid, weaponConfigs['Longsword']);

  const { eid: botEid } = createWarmupBot(world, {
    spawnPos: botPos,
    targetEid: playerEid,
  });

  const cameraStub = {
    maxTurnRate: Infinity,
    getYaw: () => 0,
    getPitch: () => 0,
  } as never;
  const combatSystem = createCombatSystem(world.ecs, input as never, cameraStub);
  const movementSystem = createMovementSystem(world, cameraStub);
  const botAISystem = createBotAISystem(world);
  const floatingStub = { spawn: () => {} } as unknown as FloatingDamage;
  const npcDamageObserver = createNpcDamageObserver(world, floatingStub);

  const deaths: DeathEventPayload[] = [];
  EventBus.on('DeathEvent', (payload) => {
    deaths.push(payload);
    awardGoldOnKill(
      world.ecs,
      payload.victimEid,
      payload.killerEid === 0 ? undefined : payload.killerEid,
    );
  });

  const tick = (): void => {
    advanceFixedTick();
    botAISystem();
    combatSystem();
    movementSystem(FIXED_TIMESTEP);
    staminaSystemTick(world.ecs);
    const { died, respawned } = healthSystemTick(world.ecs);
    processDeaths(died, world);
    processRespawns(respawned, world);
    world.physicsWorld.step();
    hitboxSystem(world);
    tickTrainingDummyHealthReset(world);
    npcDamageObserver(FIXED_TIMESTEP);
    TracerSystem(world, FIXED_TIMESTEP);
    DamageSystem(world, FIXED_TIMESTEP);
    knockbackSystem(world);
    EventBus.flush();
    animationSystem(world, FIXED_TIMESTEP);
  };

  return {
    world,
    input,
    playerEid,
    botEid,
    deaths,
    runTicks: (n: number) => {
      for (let i = 0; i < n; i++) tick();
    },
  };
}

// Heavy real-physics E2E: hundreds of fixed ticks of real Rapier per case.
// Under full-suite parallel CPU contention these blow the default 5 s
// budget (QA repro on PR #192) — give them an explicit generous timeout.
describe('warmup bot end-to-end (real physics, real AI)', { timeout: 30_000 }, () => {
  it('approaches the player from across the arena, lands hits, and can kill', () => {
    const h = buildHarness({ x: 0, z: -8 });

    // Sample as we go: the bot is lethal enough that the idle player DIES
    // and respawns at full HP within 10 s, so end-state HP alone can read
    // 100 again — track the minimums instead.
    let minDist = Infinity;
    let minHp = 100;
    let playerDied = false;
    for (let i = 0; i < 40; i++) {
      h.runTicks(15);
      const bdx = Position.x[h.botEid] - Position.x[h.playerEid];
      const bdz = Position.z[h.botEid] - Position.z[h.playerEid];
      minDist = Math.min(minDist, Math.hypot(bdx, bdz));
      minHp = Math.min(minHp, Health.current[h.playerEid]);
      if (h.deaths.some((d) => d.victimEid === h.playerEid)) playerDied = true;
    }

    // Bot closed the gap to strike range...
    expect(minDist).toBeLessThan(1.5);
    // ...its swings connected...
    expect(minHp).toBeLessThan(100);
    // ...and an idle, non-blocking player loses the fight (bot's DeathEvent
    // credit flows through the same pipeline as everything else).
    expect(playerDied).toBe(true);
  });

  it('detours around an obstacle instead of grinding against it forever', () => {
    const h = buildHarness({ x: 0, z: -9 });
    // Pillar-sized block squarely on the beeline (mirrors the arena pillar
    // that stranded the first live bot at x=6.3 on the z=0 axis).
    const wallBody = h.world.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.5, -4.5),
    );
    h.world.physicsWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1.5, 1),
      wallBody,
    );

    let minDist = Infinity;
    for (let i = 0; i < 60; i++) {
      h.runTicks(15);
      const bdx = Position.x[h.botEid] - Position.x[h.playerEid];
      const bdz = Position.z[h.botEid] - Position.z[h.playerEid];
      minDist = Math.min(minDist, Math.hypot(bdx, bdz));
      if (minDist < 1.5) break;
    }
    expect(minDist).toBeLessThan(1.5);
  });

  it('killing the bot emits a DeathEvent, pays 25 gold, and it respawns with full HP', () => {
    const h = buildHarness({ x: 0, z: -1.2 });
    h.runTicks(3);

    // Weaken the bot so one overhead finishes it.
    Health.current[h.botEid] = 10;
    const goldBefore = Gold.amount[h.playerEid];

    // Player overhead swing (flick up + click).
    h.input.avgDelta = { dx: 0, dy: -40 };
    h.input.buttons.add(0);
    h.runTicks(1);
    h.input.buttons.delete(0);
    h.runTicks(60);

    expect(h.deaths.length).toBeGreaterThanOrEqual(1);
    const death = h.deaths.find((d) => d.victimEid === h.botEid);
    expect(death).toBeDefined();
    expect(death!.killerEid).toBe(h.playerEid);
    expect(hasComponent(h.world.ecs, DeadTag, h.botEid)).toBe(true);
    expect(Gold.amount[h.playerEid] - goldBefore).toBe(25);

    // Respawn: 180 ticks later the bot is alive, healed, and relocated to
    // a seeded spawn point (placeholder corners at ±10).
    h.runTicks(200);
    expect(hasComponent(h.world.ecs, DeadTag, h.botEid)).toBe(false);
    expect(Health.current[h.botEid]).toBe(100);
    const respawnDist = Math.hypot(
      Position.x[h.botEid],
      Position.z[h.botEid],
    );
    expect(respawnDist).toBeGreaterThan(5); // moved away from the kill spot
  });

  it('aims itself at the target instead of inheriting the camera yaw', () => {
    // Bot due EAST of the player must face WEST (yaw ≈ +π/2) even though
    // the camera stub yaw is 0 — MovementSystem's camera-yaw write is
    // Player-gated.
    const h = buildHarness({ x: 6, z: 0 });
    h.runTicks(30);
    const expected = Math.atan2(-(0 - Position.x[h.botEid]), -(0 - Position.z[h.botEid]));
    expect(Rotation.y[h.botEid]).toBeCloseTo(expected, 3);
    expect(Math.abs(Rotation.y[h.botEid])).toBeGreaterThan(0.5); // definitely not camera yaw 0
  });

  it('toggleWarmupBot spawns one bot and despawns it on the second call', () => {
    const h = buildHarness({ x: 0, z: -8 });
    // Harness already spawned one bot directly; toggle should DESPAWN it.
    expect(toggleWarmupBot(h.world, h.playerEid)).toBe(false);
    expect(getWarmupBotEids(h.world)).toHaveLength(0);
    // Toggle again: fresh bot spawns.
    expect(toggleWarmupBot(h.world, h.playerEid)).toBe(true);
    expect(getWarmupBotEids(h.world)).toHaveLength(1);
    // Clean up via remove (exercises the full disposal path).
    for (const eid of getWarmupBotEids(h.world)) removeWarmupBot(h.world, eid);
    expect(getWarmupBotEids(h.world)).toHaveLength(0);
  });

  it('pickSwingDirection is deterministic and covers all four directions', () => {
    const seen = new Set<Direction>();
    for (let t = 0; t < 400; t += 13) seen.add(pickSwingDirection(t, 7));
    expect(seen.size).toBe(4);
    expect(pickSwingDirection(123, 7)).toBe(pickSwingDirection(123, 7));
  });
});
