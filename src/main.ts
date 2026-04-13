import { createGameWorld } from './core/World';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './input/InputManager';
import { CameraController } from './rendering/CameraController';
import { createMovementSystem } from './ecs/systems/MovementSystem';
import { createPlayer } from './ecs/entities/createPlayer';
import { createArena } from './ecs/entities/createArena';
import {
  createDummy,
  removeDummy,
  resetAllDummies,
  toggleDummyBlock,
  cycleDummyBlockDirection,
  tickDummyHealthReset,
  activeDummies,
} from './ecs/entities/createDummy';
import { DebugOverlay } from './hud/DebugOverlay';
import { DebugRenderer } from './rendering/DebugRenderer';
import { TracerSystem } from './ecs/systems/TracerSystem';
import { DamageSystem } from './ecs/systems/DamageSystem';
import { hitboxSystem } from './ecs/systems/HitboxSystem';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';
import { FloatingDamage } from './hud/FloatingDamage';
import { DummyHealthBar } from './hud/DummyHealthBar';
import { createDummyDamageObserver } from './ecs/systems/DummyDamageObserver';
import { showNotification } from './hud/DebugNotification';
import { FIXED_TIMESTEP } from './core/types';
import { Position, meshRegistry } from './ecs/components';
import { weaponConfigs } from './weapons/WeaponConfig';
import type { GameWorld } from './core/types';

// Import weapon configs so they auto-register
import './weapons/longsword';

/** Next dummy spawn index for position cycling */
let dummySpawnIdx = 0;
const DUMMY_SPAWN_POSITIONS: Array<{ x: number; y: number; z: number }> = [
  { x: 0, y: 0, z: -4 },
  { x: 3, y: 0, z: -4 },
  { x: -3, y: 0, z: -4 },
  { x: 0, y: 0, z: -7 },
  { x: 3, y: 0, z: -7 },
  { x: -3, y: 0, z: -7 },
  { x: 6, y: 0, z: -4 },
  { x: -6, y: 0, z: -4 },
];

function spawnDummyAtNextPosition(world: GameWorld): void {
  const pos = DUMMY_SPAWN_POSITIONS[dummySpawnIdx % DUMMY_SPAWN_POSITIONS.length];
  const colors = [0xcc4444, 0xcc8844, 0xcc44cc, 0x44cccc, 0xcccc44];
  const color = colors[dummySpawnIdx % colors.length];
  createDummy(world, pos.x, pos.y, pos.z, color);
  dummySpawnIdx++;
  showNotification(`Dummy spawned (${activeDummies.length} total)`);
}

async function main(): Promise<void> {
  // Initialize game world
  const world = await createGameWorld();
  document.body.prepend(world.renderer.domElement);

  // Input manager
  const input = new InputManager(world.renderer.domElement);

  // Camera controller
  const cameraController = new CameraController(world.camera, input);

  // Create arena
  createArena(world);

  // Create player
  const { eid: playerEid, mesh: playerMesh } = createPlayer(world, { x: 0, y: 0.1, z: 0 });
  world.playerEntity = playerEid;
  cameraController.setPlayerMesh(playerMesh);

  // Spawn initial training dummy
  createDummy(world, 0, 0, -4, 0xcc4444);
  dummySpawnIdx = 1;

  // Create movement system
  const movementSystem = createMovementSystem(world, input, cameraController);

  // HUD & debug
  const debugOverlay = new DebugOverlay();
  const debugRenderer = new DebugRenderer(world);
  const tracerDebugRenderer = new TracerDebugRenderer(world.scene);
  const floatingDamage = new FloatingDamage(world.camera);
  const dummyHealthBar = new DummyHealthBar(world.camera);
  const dummyDamageObserver = createDummyDamageObserver(world, floatingDamage);

  // ─── Keybind handler (T, Y, J, K, number keys) ───
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyT': {
        const state = toggleDummyBlock();
        showNotification(`Dummy: ${state}`);
        break;
      }
      case 'KeyY': {
        const dir = cycleDummyBlockDirection();
        showNotification(`Dummy Block Dir: ${dir}`);
        break;
      }
      case 'KeyJ':
        spawnDummyAtNextPosition(world);
        break;
      case 'KeyK':
        resetAllDummies(world);
        showNotification('All dummies reset');
        break;
    }
  });

  // ─── Runtime weapon swap via console ───
  (window as any).setWeapon = (name: string): void => {
    const config = weaponConfigs[name];
    if (!config) {
      console.warn(
        `Weapon "${name}" not found. Available: ${Object.keys(weaponConfigs).join(', ')}`,
      );
      return;
    }
    console.log(`Weapon set to: ${config.name}`);
    showNotification(`Weapon: ${config.name}`);
    // In the future this will update the player's weapon config reference.
    // For now it logs and notifies, since the full combat FSM (#5) is not yet merged.
  };

  // ─── Click-to-play handler ───
  const overlay = document.getElementById('click-to-play');
  if (overlay) {
    overlay.addEventListener('click', () => {
      input.requestPointerLock();
    });
    world.renderer.domElement.addEventListener('click', () => {
      if (!input.isPointerLocked) {
        input.requestPointerLock();
      }
    });
  }

  // ─── Game loop ───
  const loop = new GameLoop();

  loop.onFrameStart = () => {
    cameraController.processInput();
  };

  loop.fixedUpdate = (_dt: number) => {
    // Movement system
    movementSystem(FIXED_TIMESTEP);

    // Step physics
    world.physicsWorld.step();

    // Sync hitbox positions to skeleton bones
    hitboxSystem(world);

    // Observe damage events (floating numbers) before they're consumed
    dummyDamageObserver(FIXED_TIMESTEP);

    // Tracer hit detection + damage resolution
    TracerSystem(world, FIXED_TIMESTEP);
    DamageSystem(world, FIXED_TIMESTEP);

    // Dummy health reset timer
    tickDummyHealthReset();

    // Sync player mesh position with ECS
    playerMesh.position.set(
      Position.x[playerEid],
      Position.y[playerEid],
      Position.z[playerEid],
    );

    // Sync dummy meshes
    for (const deid of activeDummies) {
      const modelData = meshRegistry.get(deid);
      if (modelData) {
        modelData.group.position.set(
          Position.x[deid],
          Position.y[deid],
          Position.z[deid],
        );
      }
    }
  };

  loop.update = (dt: number) => {
    debugOverlay.update(dt, playerEid, cameraController);
  };

  loop.render = (alpha: number) => {
    debugRenderer.update();
    tracerDebugRenderer.update();
    floatingDamage.update();
    dummyHealthBar.update();
    cameraController.updateCamera(playerEid, alpha);
    world.renderer.render(world.scene, world.camera);
  };

  loop.onFrameEnd = () => {
    input.resetFrameDeltas();
  };

  loop.start();
}

main().catch(console.error);
