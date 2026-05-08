import { createGameWorld } from './core/World';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './input/InputManager';
import { CameraController } from './rendering/CameraController';
import { createMovementSystem } from './ecs/systems/MovementSystem';
import { createInputSystem } from './ecs/systems/InputSystem';
import { createCombatSystem } from './ecs/systems/CombatSystem';
import { staminaSystemTick } from './ecs/systems/StaminaSystem';
import { healthSystemTick } from './ecs/systems/HealthSystem';
import { createPlayer } from './ecs/entities/createPlayer';
import { createArena } from './arena/createArena';
import {
  createDummy,
  removeDummy,
  resetAllDummies,
  toggleDummyBlock,
  cycleDummyBlockDirection,
  tickDummyHealthReset,
  activeDummies,
} from './ecs/entities/createDummy';
import { createShopkeep } from './ecs/entities/createShopkeep';
import {
  interactionSystem,
  getNearbyInteractable,
} from './ecs/systems/InteractionSystem';
import { animationSystem } from './ecs/systems/AnimationSystem';
import { DebugOverlay } from './hud/DebugOverlay';
import { HUD } from './hud/HUD';
import { DebugRenderer } from './rendering/DebugRenderer';
import { TracerSystem, weaponConfigMap } from './ecs/systems/TracerSystem';
import { DamageSystem } from './ecs/systems/DamageSystem';
import { hitboxSystem } from './ecs/systems/HitboxSystem';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';
import { FloatingDamage } from './hud/FloatingDamage';
import { DummyHealthBar } from './hud/DummyHealthBar';
import { WorldLabel } from './hud/WorldLabel';
import { createDummyDamageObserver } from './ecs/systems/DummyDamageObserver';
import { showNotification } from './hud/DebugNotification';
import { InventoryPanel } from './hud/InventoryPanel';
import { ShopPanel } from './hud/ShopPanel';
import { FIXED_TIMESTEP, SPAWN_HEIGHT } from './core/types';
import { Position, PreviousPosition, meshRegistry } from './ecs/components';
import { lerp } from './utils/math';
import { createFSM, fsmRegistry } from './combat/CombatFSM';
import { weaponConfigs } from './weapons/WeaponConfig';
import { weaponIdToName } from './ecs/systems/CombatSystem';
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
import { viewmodelAnimationSystem } from './rendering/ViewmodelAnimationSystem';
import type { GameWorld } from './core/types';

// Import weapon configs so they auto-register
import './weapons/longsword';
import './weapons/mace';
import './weapons/dagger';
import './weapons/battleaxe';

// Populate weaponConfigMap for TracerSystem — maps numeric weapon IDs to configs
for (const [name, config] of Object.entries(weaponConfigs)) {
  const idx = weaponIdToName.indexOf(name);
  if (idx >= 0) weaponConfigMap.set(idx, config);
}

/** Next dummy spawn index for position cycling */
let dummySpawnIdx = 0;
// Y is resolved per-spawn by createDummy → spawnAtGround (raycast).
const DUMMY_SPAWN_POSITIONS: Array<{ x: number; z: number }> = [
  { x: 0, z: -4 },
  { x: 3, z: -4 },
  { x: -3, z: -4 },
  { x: 0, z: -7 },
  { x: 3, z: -7 },
  { x: -3, z: -7 },
  { x: 6, z: -4 },
  { x: -6, z: -4 },
];

function spawnDummyAtNextPosition(world: GameWorld): void {
  const pos = DUMMY_SPAWN_POSITIONS[dummySpawnIdx % DUMMY_SPAWN_POSITIONS.length];
  const colors = [0xcc4444, 0xcc8844, 0xcc44cc, 0x44cccc, 0xcccc44];
  const color = colors[dummySpawnIdx % colors.length];
  createDummy(world, pos.x, pos.z, color);
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

  // Create player (Y resolved by spawnAtGround raycast)
  const { eid: playerEid, mesh: playerMesh } = createPlayer(world, { x: 0, z: 0 });
  world.playerEntity = playerEid;
  cameraController.setPlayerMesh(playerMesh);

  // Register combat FSM for the player entity (uses auto-registered dagger config)
  createFSM(playerEid, weaponConfigs['Dagger']);

  // Register weapon model factories
  registerWeaponModelFactory('Longsword', createLongswordModel);
  registerWeaponModelFactory('Mace', createMaceModel);
  registerWeaponModelFactory('Dagger', createDaggerModel);
  registerWeaponModelFactory('Battleaxe', createBattleaxeModel);

  // Initialize player inventory with the starter weapon only.
  // Other weapons must be purchased from the shopkeep (issue #107). When the
  // full gold-currency design (#95) lands and earning loops exist, this list
  // will likely stay the same — gold/shop is the entry point, not initInventory.
  initInventory(playerEid, ['Dagger'], 'Dagger');

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

  // Spawn initial training dummy (Y resolved by spawnAtGround raycast)
  createDummy(world, 0, -4, 0xcc4444);
  dummySpawnIdx = 1;

  // Spawn shopkeep NPC at far corner of arena. Walking distance from origin
  // is intentional — proves the interact prompt only shows up close.
  // NOTE: SPAWN_HEIGHT is now a deprecated alias of GROUND_TOP_Y (= 0.1) per
  // #104's feet-origin convention. The shopkeep mesh root is at feet (y=0
  // local), so passing 0.1 puts its feet on the ground — fixing what was
  // previously a floating shopkeep at y=1.1.
  createShopkeep(world, 8, SPAWN_HEIGHT, 8, { name: 'Shopkeep' });

  // Input + movement systems (input writes MovementIntent; movement consumes it)
  const inputSystem = createInputSystem(world, input, cameraController);
  const movementSystem = createMovementSystem(world, cameraController);

  // Create combat system (reads input, drives per-entity FSMs)
  const combatSystem = createCombatSystem(world.ecs, input, cameraController);

  // HUD & debug
  const debugOverlay = new DebugOverlay();
  const debugRenderer = new DebugRenderer(world);

  // HUD (health bar, stamina bar, FSM state label, FPS counter)
  const hud = new HUD();

  // Inventory panel (I key to toggle)
  const inventoryPanel = new InventoryPanel(input, playerEid);

  // Shop panel — opens via the KeyE handler when standing near the
  // shopkeep NPC. Purchases go through `purchaseWeapon()` (#123), which is
  // the atomic validate-then-mutate API that becomes server-authoritative
  // when networking lands.
  const shopPanel = new ShopPanel(input, playerEid);

  // Dev console helpers — handy for testing without walking to the NPC
  (window as any).openShop = () => shopPanel.open();
  (window as any).closeShop = () => shopPanel.close();

  // Suppress click-to-play overlay while inventory or shop is open
  input._suppressClickToPlay = () => inventoryPanel.isOpen || shopPanel.isOpen;

  // Initialize debug renderers
  const tracerDebugRenderer = new TracerDebugRenderer(world.scene);
  const floatingDamage = new FloatingDamage(world.camera);
  const dummyHealthBar = new DummyHealthBar(world.camera);
  const dummyDamageObserver = createDummyDamageObserver(world, floatingDamage);

  // Shopkeep nameplate + "Press [E] to shop" prompt
  const worldLabel = new WorldLabel(world.camera);

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
      case 'KeyI': {
        // Defensive: close the shop if KeyI was pressed while it was open.
        // InventoryPanel handles its own toggle on its own listener
        // (registered on `document`); this `window` handler runs after that
        // bubbles up, so the resulting state is shop-closed + inventory-open.
        if (shopPanel.isOpen) shopPanel.close();
        break;
      }
      case 'KeyE': {
        // Bail out if input is paused (e.g. inventory open) so pressing E
        // with another overlay up doesn't trigger weird state.
        if (input.paused) break;
        const target = getNearbyInteractable(playerEid);
        if (target !== null) {
          // Defensive: never have the inventory and shop open simultaneously.
          // Different keys (I vs E) make this unlikely, but if it ever
          // happens neither panel should fight over pointer-lock state.
          if (inventoryPanel.isOpen) inventoryPanel.close();
          shopPanel.open(target);
        }
        break;
      }
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
    // Translate raw input → MovementIntent for the player. Must run before
    // combat/movement so they see this tick's intent.
    inputSystem(FIXED_TIMESTEP);

    // Combat system (reads input, ticks FSMs, syncs ECS components)
    combatSystem();

    // Movement system — consumes MovementIntent, writes Position via Rapier
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

    // Update nearest-interactable cache (for KeyE handler + WorldLabel prompt)
    interactionSystem(playerEid);

    // NOTE: mesh sync MOVED OUT of fixedUpdate — see loop.render below.
    // Syncing mesh positions in fixedUpdate snaps them at 60Hz; in render
    // we lerp between PreviousPosition and Position so motion stays smooth
    // at high framerates (vsync 144Hz, etc.).
  };

  loop.update = (dt: number) => {
    // Variable-rate updates: animation blending
    animationSystem(world, dt);
    viewmodelAnimationSystem(viewmodel, playerEid, dt, weaponIdToName);
    debugOverlay.update(dt, playerEid, cameraController);
    hud.update(dt, playerEid);
  };

  loop.render = (alpha: number) => {
    // Sync skeletal mesh groups by interpolating between the previous tick
    // and current tick's positions. This prevents visible 60Hz snapping at
    // higher render framerates (e.g. 144Hz vsync). Runs in render — NOT
    // fixedUpdate — so the mesh interpolates smoothly between physics ticks.
    const playerModelData = meshRegistry.get(playerEid);
    if (playerModelData) {
      const px = lerp(PreviousPosition.x[playerEid], Position.x[playerEid], alpha);
      const py = lerp(PreviousPosition.y[playerEid], Position.y[playerEid], alpha);
      const pz = lerp(PreviousPosition.z[playerEid], Position.z[playerEid], alpha);
      playerModelData.group.position.set(px, py, pz);
    }
    for (const deid of activeDummies) {
      const modelData = meshRegistry.get(deid);
      if (modelData) {
        // Dummies are static — Position.* equals PreviousPosition.* so the
        // lerp is effectively a no-op, but we go through it anyway so that
        // future moving NPCs that reuse this loop pattern just work.
        const dx = lerp(PreviousPosition.x[deid], Position.x[deid], alpha);
        const dy = lerp(PreviousPosition.y[deid], Position.y[deid], alpha);
        const dz = lerp(PreviousPosition.z[deid], Position.z[deid], alpha);
        modelData.group.position.set(dx, dy, dz);
      }
    }

    debugRenderer.update();
    tracerDebugRenderer.update();
    floatingDamage.update();
    dummyHealthBar.update();
    worldLabel.update(getNearbyInteractable(playerEid));
    cameraController.updateCamera(playerEid, alpha);

    // Pass 1: Render world scene (Layer 0) with world camera
    world.renderer.render(world.scene, world.camera);

    // Pass 2: Sync viewmodel camera, clear depth, render viewmodel (Layer 1)
    viewmodel.syncWithCamera(world.camera);
    world.renderer.autoClear = false;
    world.renderer.clearDepth();
    // Null scene.background during Pass 2 to prevent Three.js from rendering
    // a full-screen background quad that overwrites Pass 1's world geometry.
    // scene.background is rendered independently of autoClear, so we must
    // suppress it manually for correct multi-pass compositing.
    const savedBackground = world.scene.background;
    world.scene.background = null;
    world.renderer.render(world.scene, viewmodel.camera);
    world.scene.background = savedBackground;
    world.renderer.autoClear = true;
  };

  loop.onFrameEnd = () => {
    input.resetFrameDeltas();
  };

  loop.start();
}

main().catch(console.error);
