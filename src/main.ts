import { createGameWorld } from './core/World';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './input/InputManager';
import { CameraController } from './rendering/CameraController';
import { createMovementSystem } from './ecs/systems/MovementSystem';
import { createCombatSystem } from './ecs/systems/CombatSystem';
import { staminaSystemTick } from './ecs/systems/StaminaSystem';
import { healthSystemTick } from './ecs/systems/HealthSystem';
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
import { animationSystem } from './ecs/systems/AnimationSystem';
import { DebugOverlay } from './hud/DebugOverlay';
import { HUD } from './hud/HUD';
import { DebugRenderer } from './rendering/DebugRenderer';
import { TracerSystem } from './ecs/systems/TracerSystem';
import { DamageSystem } from './ecs/systems/DamageSystem';
import { hitboxSystem } from './ecs/systems/HitboxSystem';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';
import { FloatingDamage } from './hud/FloatingDamage';
import { DummyHealthBar } from './hud/DummyHealthBar';
import { createDummyDamageObserver } from './ecs/systems/DummyDamageObserver';
import { showNotification } from './hud/DebugNotification';
import { InventoryPanel } from './hud/InventoryPanel';
import { FIXED_TIMESTEP, SPAWN_HEIGHT } from './core/types';
import { Position, meshRegistry } from './ecs/components';
import { createFSM, fsmRegistry } from './combat/CombatFSM';
import { weaponConfigs } from './weapons/WeaponConfig';
import {
  initInventory,
  equipWeapon,
  getInventory,
  onEquip,
  registerWeaponModelFactory,
} from './ecs/systems/InventorySystem';
import { createLongswordModel } from './rendering/CharacterModel';
import { createMaceModel, createDaggerModel, createBattleaxeModel } from './rendering/WeaponModels';
import { ViewmodelRenderer } from './rendering/ViewmodelRenderer';
import type { GameWorld } from './core/types';

// Import weapon configs so they auto-register
import './weapons/longsword';
import './weapons/mace';
import './weapons/dagger';
import './weapons/battleaxe';

/** Next dummy spawn index for position cycling */
let dummySpawnIdx = 0;
const DUMMY_SPAWN_POSITIONS: Array<{ x: number; y: number; z: number }> = [
  { x: 0, y: SPAWN_HEIGHT, z: -4 },
  { x: 3, y: SPAWN_HEIGHT, z: -4 },
  { x: -3, y: SPAWN_HEIGHT, z: -4 },
  { x: 0, y: SPAWN_HEIGHT, z: -7 },
  { x: 3, y: SPAWN_HEIGHT, z: -7 },
  { x: -3, y: SPAWN_HEIGHT, z: -7 },
  { x: 6, y: SPAWN_HEIGHT, z: -4 },
  { x: -6, y: SPAWN_HEIGHT, z: -4 },
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
  const { eid: playerEid, mesh: playerMesh } = createPlayer(world, { x: 0, y: SPAWN_HEIGHT, z: 0 });
  world.playerEntity = playerEid;
  cameraController.setPlayerMesh(playerMesh);

  // Register combat FSM for the player entity (uses auto-registered dagger config)
  createFSM(playerEid, weaponConfigs['Dagger']);

  // Register weapon model factories
  registerWeaponModelFactory('Longsword', createLongswordModel);
  registerWeaponModelFactory('Mace', createMaceModel);
  registerWeaponModelFactory('Dagger', createDaggerModel);
  registerWeaponModelFactory('Battleaxe', createBattleaxeModel);

  // Initialize player inventory with available weapons, Dagger equipped
  const availableWeapons = Object.keys(weaponConfigs);
  initInventory(playerEid, availableWeapons, 'Dagger');

  // ─── First-person viewmodel ───
  const viewmodel = new ViewmodelRenderer(world.scene, world.camera.aspect, {
    initialWeapon: 'Dagger',
    weaponFactories: {
      Longsword: createLongswordModel,
      Mace: createMaceModel,
      Dagger: createDaggerModel,
      Battleaxe: createBattleaxeModel,
    },
  });
  cameraController.setViewmodel(viewmodel);

  // Keep viewmodel camera aspect ratio in sync on resize
  window.addEventListener('resize', () => {
    viewmodel.updateAspect(window.innerWidth / window.innerHeight);
  });

  // Listen for equip events to show HUD notifications and swap viewmodel weapon
  onEquip((event) => {
    showNotification(`Equipped: ${event.weaponName}`);
    viewmodel.swapWeapon(event.weaponName);
  });

  // Spawn initial training dummy
  createDummy(world, 0, SPAWN_HEIGHT, -4, 0xcc4444);
  dummySpawnIdx = 1;

  // Create movement system
  const movementSystem = createMovementSystem(world, input, cameraController);

  // Create combat system (reads input, drives per-entity FSMs)
  const combatSystem = createCombatSystem(world.ecs, input);

  // HUD & debug
  const debugOverlay = new DebugOverlay();
  const debugRenderer = new DebugRenderer(world);

  // HUD (health bar, stamina bar, FSM state label, FPS counter)
  const hud = new HUD();

  // Inventory panel (I key to toggle)
  const inventoryPanel = new InventoryPanel(input, playerEid);
  // Suppress click-to-play overlay while inventory is open
  input._suppressClickToPlay = () => inventoryPanel.isOpen;

  // Initialize debug renderers
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
    const success = equipWeapon(world.playerEntity, name);
    if (success) {
      console.log(`Weapon set to: ${config.name}`);
    } else {
      console.warn(`Could not equip "${name}" — player may not be idle or weapon not in inventory`);
    }
  };

  // ─── Expose inventory query for debugging ───
  (window as any).getInventory = () => getInventory(world.playerEntity);

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
    // Combat system (reads input, ticks FSMs, syncs ECS components)
    combatSystem();

    // Movement system
    movementSystem(FIXED_TIMESTEP);

    // Stamina system (reads combat state, handles regen/costs)
    staminaSystemTick(world.ecs);

    // Health system (processes damage, handles death/respawn)
    healthSystemTick(world.ecs);

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

    // Sync player mesh position with ECS (skeletal model group)
    const playerModelData = meshRegistry.get(playerEid);
    if (playerModelData) {
      playerModelData.group.position.set(
        Position.x[playerEid],
        Position.y[playerEid],
        Position.z[playerEid],
      );
    }

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
    // Variable-rate updates: animation blending
    animationSystem(world, dt);
    debugOverlay.update(dt, playerEid, cameraController);
    hud.update(dt, playerEid);
  };

  loop.render = (alpha: number) => {
    debugRenderer.update();
    tracerDebugRenderer.update();
    floatingDamage.update();
    dummyHealthBar.update();
    cameraController.updateCamera(playerEid, alpha);

    // Pass 1: Render world scene (Layer 0) with world camera
    world.renderer.render(world.scene, world.camera);

    // Pass 2: Sync viewmodel camera, clear depth, render viewmodel (Layer 1)
    viewmodel.syncWithCamera(world.camera);
    world.renderer.autoClear = false;
    world.renderer.clearDepth();
    world.renderer.render(world.scene, viewmodel.camera);
    world.renderer.autoClear = true;
  };

  loop.onFrameEnd = () => {
    input.resetFrameDeltas();
  };

  loop.start();
}

main().catch(console.error);
