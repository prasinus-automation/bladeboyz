import { createGameWorld } from './core/World';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './input/InputManager';
import { CameraController } from './rendering/CameraController';
import { createMovementSystem } from './ecs/systems/MovementSystem';
import { createInputSystem } from './ecs/systems/InputSystem';
import { createCombatSystem } from './ecs/systems/CombatSystem';
import { staminaSystemTick } from './ecs/systems/StaminaSystem';
import { healthSystemTick } from './ecs/systems/HealthSystem';
import { processDeaths } from './ecs/systems/processDeaths';
import { EventBus } from './events/EventBus';
import { createPlayer } from './ecs/entities/createPlayer';
import { createArena } from './arena/createArena';
import { processRespawns } from './ecs/systems/processRespawns';
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
import { hitReactSystemTick } from './ecs/systems/HitReactSystem';
import { hitboxSystem } from './ecs/systems/HitboxSystem';
import { advanceFixedTick, getCurrentFixedTick } from './core/tickCounter';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';
import { FloatingDamage } from './hud/FloatingDamage';
import { DummyHealthBar } from './hud/DummyHealthBar';
import { WorldLabel } from './hud/WorldLabel';
import { createDummyDamageObserver } from './ecs/systems/DummyDamageObserver';
import { showNotification } from './hud/DebugNotification';
import { InventoryPanel } from './hud/InventoryPanel';
import { ShopPanel } from './hud/ShopPanel';
import { FIXED_TIMESTEP } from './core/types';
import { Position, PreviousPosition, Rotation, meshRegistry } from './ecs/components';
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
import { weaponModelFactories } from './rendering/WeaponModels';
import { ViewmodelRenderer, getArmOffset } from './rendering/ViewmodelRenderer';
import { viewmodelAnimationSystem } from './rendering/ViewmodelAnimationSystem';
import { pickupRenderer } from './rendering/PickupRenderer';
import { ViewmodelDebugOverlay } from './hud/ViewmodelDebugOverlay';
import { PickupPrompt } from './hud/PickupPrompt';
import { CombatStateComp } from './ecs/components';
import { COMBAT_STATE_NAMES } from './combat/states';
import type * as THREE from 'three';
import type { GameWorld } from './core/types';
import { GameStateManager, GameState } from './core/GameState';
import { MenuManager } from './hud/MenuManager';

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

/**
 * Resolve the dummy spawn-position list from the active arena's interior
 * spawn points. Issue #112 spec calls out S2/S3/S5/S6 as the four interior
 * spawns that "work well" for dummies. Falls back to a small inline list
 * if the arena hasn't been built yet (defensive — main wires the arena
 * before this is called).
 */
function getDummySpawnPositions(world: GameWorld): Array<{ x: number; z: number }> {
  const arena = world.arena;
  if (arena) {
    // Indices 1, 2, 4, 5 = S2, S3, S5, S6 — the four interior spawns,
    // mirror-symmetric across z = 0. Used as a starting set; J cycles
    // through them in order.
    const interior = [1, 2, 4, 5].map((i) => arena.spawnPoints[i].position);
    return interior.map((p) => ({ x: p.x, z: p.z }));
  }
  // Fallback (used only if a test path constructs the world without an
  // arena). Matches the v0 layout for behavioural compatibility.
  return [
    { x: 0, z: -4 },
    { x: 3, z: -4 },
    { x: -3, z: -4 },
    { x: 0, z: -7 },
  ];
}

function spawnDummyAtNextPosition(world: GameWorld): void {
  const positions = getDummySpawnPositions(world);
  const pos = positions[dummySpawnIdx % positions.length];
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

  // Create arena. `createArena` adds the lighting rig + 9 static props
  // (ground, walls, pillars, shop counter / back wall) AND registers the
  // 6 arena spawn points into `world/SpawnPoints.ts` (replacing the v0
  // `seedPlaceholderSpawnPoints()` call). The returned ArenaSpec is the
  // runtime data store for the spawn-point list, shopkeep stall AABB, and
  // weapon-pickup safe volume — stored on `world.arena` so other systems
  // can query it without re-importing.
  const arena = createArena(world);
  world.arena = arena;

  // Create player at the first arena spawn point (S1 — west side, on the
  // E-W axis). The createPlayer factory still falls back to the registry
  // selector when called without an explicit position, but pinning to S1
  // here keeps initial spawn deterministic and matches the issue spec's
  // "Replace hardcoded player spawn with arena.spawnPoints[0].position"
  // direction.
  // Issue #130: default starter weapon is Longsword (was Dagger).
  const spawn0 = arena.spawnPoints[0];
  const { eid: playerEid, mesh: playerMesh } = createPlayer(world, spawn0.position);
  world.playerEntity = playerEid;
  // Apply spawn-point facing. createPlayer's explicit-position path leaves
  // Rotation.y at 0; we'd otherwise spawn the player facing -Z regardless of
  // which spawn point was used. Mirror what the registry path does.
  Rotation.y[playerEid] = spawn0.facing;
  cameraController.setPlayerMesh(playerMesh);

  // Register combat FSM for the player entity using the default starter weapon
  createFSM(playerEid, weaponConfigs['Longsword']);

  // Register weapon model factories with InventorySystem (3rd-person model
  // swap on equip). Single source of truth: the canonical registry lives
  // in `src/rendering/WeaponModels.ts`. ViewmodelRenderer reads from the
  // same registry by default — see #125 cleanup.
  for (const [name, factory] of Object.entries(weaponModelFactories)) {
    registerWeaponModelFactory(name, factory);
  }

  // Initialize player inventory.
  //
  // Issue #130: starter weapon is now Longsword (matches the design doc's
  // "default starter weapon" decision). The death pipeline emits a DeathEvent
  // per kill, so picking up a respawn-default that the player doesn't own
  // would surface a UX bug — list it here. The full purchase flow still
  // uses Dagger as the cheapest option in the shop.
  //
  // Other weapons must be purchased from the shopkeep (#107). When the full
  // gold-currency design (#95) lands and earning loops exist, this list will
  // likely stay the same — gold/shop is the entry point, not initInventory.
  //
  // The 4th arg is the permanent `starterWeapon` (won't be dropped on death
  // per #94). Passed explicitly even though the default would resolve the
  // same — keeps this call self-documenting.
  initInventory(playerEid, ['Longsword'], 'Longsword', 'Longsword');

  // ─── First-person viewmodel ───
  // ViewmodelRenderer defaults `weaponFactories` to the canonical
  // `weaponModelFactories` registry exported from `./rendering/WeaponModels`,
  // so we no longer inline the factory list here (#125 cleanup).
  const viewmodel = new ViewmodelRenderer(world.scene, world.camera.aspect, {
    initialWeapon: 'Longsword',
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

  // Snap the viewmodel after a respawn so the aim-sway lag (#129, doc §7)
  // doesn't visibly catch up over ~5 frames after the player teleports to
  // the new spawn point. Without this, the viewmodel rotation lerps from
  // the death-time orientation toward the spawn-time orientation, which
  // looks like a delayed "swing" right at the moment the player needs to
  // reorient. snap() also resets the locomotion bob accumulator.
  EventBus.on('RespawnEvent', (payload) => {
    if (payload.eid === playerEid) {
      viewmodel.snap(world.camera);
    }
  });

  // ─── --debug-viewmodel toggle (issue #122) ───
  //
  // Initial state: URL query param `?debug-viewmodel=...` (presence is enough).
  // Runtime: F7 keydown flips it. The URL is just an initial seed — F7 is the
  // source of truth once the app is running.
  const viewmodelDebugOverlay = new ViewmodelDebugOverlay();
  let viewmodelDebugEnabled = false;
  if (typeof location !== 'undefined') {
    viewmodelDebugEnabled = new URLSearchParams(location.search).has('debug-viewmodel');
  }
  function applyViewmodelDebug(enabled: boolean): void {
    viewmodelDebugEnabled = enabled;
    viewmodel.setDebugMode(enabled);
    viewmodelDebugOverlay.setVisible(enabled);
    showNotification(`Viewmodel debug: ${enabled ? 'ON' : 'OFF'}`);
  }
  // Apply initial state without firing a toast (toast is only on user-initiated
  // toggles — boot-time URL is silent).
  if (viewmodelDebugEnabled) {
    viewmodel.setDebugMode(true);
    viewmodelDebugOverlay.setVisible(true);
  }

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'F7') {
      e.preventDefault();
      applyViewmodelDebug(!viewmodelDebugEnabled);
    }
  });

  // Pre-allocated euler-record object so the per-frame snapshot doesn't
  // allocate. Bones expose `.rotation` as a `THREE.Euler` directly so we
  // just alias them in the snapshot — no copy needed.
  const _boneEulers: Record<string, THREE.Euler> = {};

  // Spawn initial training dummy (Y resolved by spawnAtGround raycast)
  createDummy(world, 0, -4, 0xcc4444);
  dummySpawnIdx = 1;

  // Spawn shopkeep NPC behind the SW shop counter. Coordinates come from
  // the arena's documented `shopkeepStall.npcAnchor` so the NPC sits on
  // the right side of the counter (behind it) rather than the v0
  // arbitrary `(8, _, 8)` location.
  // NOTE: SPAWN_HEIGHT is the deprecated alias of GROUND_TOP_Y (= 0.1) per
  // #104's feet-origin convention. The npcAnchor's y already matches.
  const npc = arena.shopkeepStall.npcAnchor;
  createShopkeep(world, npc.x, npc.y, npc.z, { name: 'Shopkeep' });

  // Input + movement systems (input writes MovementIntent; movement consumes it)
  const inputSystem = createInputSystem(world, input, cameraController);
  const movementSystem = createMovementSystem(world, cameraController);

  // Create combat system (reads input, drives per-entity FSMs)
  const combatSystem = createCombatSystem(world.ecs, input, cameraController);

  // HUD & debug
  const debugOverlay = new DebugOverlay();
  const debugRenderer = new DebugRenderer(world);

  // HUD (health bar, stamina bar, FSM state label, FPS counter, plus the
  // spawn/death/respawn overlays from #137: DeathScreen, Killfeed, Scoreboard).
  // Passing `world` is what enables the #137 overlays — they need ECS state
  // and EventBus subscription. HUD's update(dt, eid) signature is unchanged.
  const hud = new HUD(world);

  // Weapon-pickup prompt (shown when player is within 1.5m of a ground
  // pickup AND in Idle FSM state — issue #127). KeyE handler that actually
  // consumes the pickup is wired by sibling issue #121.
  const pickupPrompt = new PickupPrompt();

  // ─── Game state + menu manager (#101 foundation) ───
  // GameStateManager defaults to MAIN_MENU. For now we eagerly transition to
  // PLAYING since the game still starts directly in the world (issue #2 will
  // replace this with a real main menu flow).
  const gameStateManager = new GameStateManager();
  gameStateManager.state = GameState.PLAYING;

  // MenuManager owns the ESC listener, pointer-lock release, input pause, and
  // click-to-play suppression for any modal that registers with it. Its ctor
  // sets `input._suppressClickToPlay = () => menuManager.isAnyOpen()` — we
  // override that below to also account for ShopPanel (which doesn't yet
  // register with MenuManager — its modal kind isn't part of #101's contract).
  const menuManager = new MenuManager(input, gameStateManager);

  // Inventory panel (I key to toggle). Registers itself with menuManager so
  // ESC routes to it and pointer-lock / input.paused are managed centrally.
  const inventoryPanel = new InventoryPanel(input, playerEid, menuManager);

  // Shop panel — opens via the KeyE handler when standing near the
  // shopkeep NPC. Purchases go through `purchaseWeapon()` (#123), which is
  // the atomic validate-then-mutate API that becomes server-authoritative
  // when networking lands.
  const shopPanel = new ShopPanel(input, playerEid);

  // Dev console helpers — handy for testing without walking to the NPC
  (window as any).openShop = () => shopPanel.open();
  (window as any).closeShop = () => shopPanel.close();

  // Override MenuManager's default suppression (`() => menuManager.isAnyOpen()`)
  // to also cover ShopPanel so the click-to-play prompt stays hidden while
  // the shop is up.
  input._suppressClickToPlay = () => menuManager.isAnyOpen() || shopPanel.isOpen;

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
    // Advance the global fixed-tick counter ONCE per fixedUpdate so
    // tick-stamped events (e.g. HitReactComp.spawnedAtTick) are consistent
    // for everything that runs this tick.
    advanceFixedTick();

    // Translate raw input → MovementIntent for the player. Must run before
    // combat/movement so they see this tick's intent.
    inputSystem(FIXED_TIMESTEP);

    // Combat system (reads input, ticks FSMs, syncs ECS components)
    combatSystem();

    // Movement system — consumes MovementIntent, writes Position via Rapier
    movementSystem(FIXED_TIMESTEP);

    // Stamina system (reads combat state, handles regen/costs)
    staminaSystemTick(world.ecs);

    // Health system (processes damage, handles death/respawn timer).
    // Issue #130: capture `died`/`respawned` arrays. healthSystemTick is
    // pure detection — it adds DeadTag + RespawnPending and ticks the
    // respawn countdown.
    //
    // Issue #134: processRespawns consumes `respawned` to teleport, restore
    // HP/stamina, equip default weapon, and remove the lifecycle tags.
    // TODO(#A2): weaponPickupSystem(world, currentTick, died, ...);
    const { died, respawned } = healthSystemTick(world.ecs);

    // Death-cleanup hook. Emits DeathEvent, increments Score, resets FSM,
    // zeros velocity, calls dropEquippedWeapon stub. Restricted to entities
    // with the Player or Bot tag — dummies opt out.
    processDeaths(died, world);

    // Respawn-cleanup hook. Picks a spawn point (weighted away from live
    // combatants), teleports the entity, restores HP/Stamina, equips the
    // default starter, removes DeadTag+RespawnPending, emits RespawnEvent.
    processRespawns(respawned, world);

    // Step physics
    world.physicsWorld.step();

    // Sync hitbox positions to skeleton bones
    hitboxSystem(world);

    // Observe damage events (floating numbers) before they're consumed
    dummyDamageObserver(FIXED_TIMESTEP);

    // Tracer hit detection + damage resolution. DamageSystem may stamp
    // HitReactComp on a target this tick; the hit-react clear pass runs
    // after so it doesn't immediately wipe a fresh entry.
    TracerSystem(world, FIXED_TIMESTEP);
    DamageSystem(world, FIXED_TIMESTEP);
    hitReactSystemTick(world.ecs);

    // Dummy health reset timer
    tickDummyHealthReset();

    // Update nearest-interactable cache (for KeyE handler + WorldLabel prompt)
    interactionSystem(playerEid);

    // Drain queued events (DamageDealt, DeathEvent, etc.) to subscribers.
    // Must be the LAST thing in fixedUpdate so handlers see a consistent
    // snapshot of all systems for this tick. Anything emitted from inside
    // a handler (rare) will land on the next tick's flush.
    EventBus.flush();

    // NOTE: mesh sync MOVED OUT of fixedUpdate — see loop.render below.
    // Syncing mesh positions in fixedUpdate snaps them at 60Hz; in render
    // we lerp between PreviousPosition and Position so motion stays smooth
    // at high framerates (vsync 144Hz, etc.).
  };

  // Render-frame `dt` cache. GameLoop's render(alpha) doesn't receive dt, but
  // the viewmodel's aim-sway lag + locomotion bob need it (see #129). Capturing
  // it from the immediately-prior `update(dt)` call is correct because update
  // and render always run in lockstep inside one GameLoop tick.
  let lastUpdateDt = 1 / 60;

  loop.update = (dt: number) => {
    lastUpdateDt = dt;
    // Variable-rate updates: animation blending
    animationSystem(world, dt);
    viewmodelAnimationSystem(viewmodel, playerEid, dt, weaponIdToName);
    // Weapon-pickup visuals — spin / bob / blink+fade in last 5s. Reads the
    // current fixed tick from the global tick counter so the blink phase is
    // tick-aligned (rather than wall-clock).
    const currentTick = getCurrentFixedTick();
    pickupRenderer(world, currentTick, dt);
    pickupPrompt.update(playerEid);
    debugOverlay.update(dt, playerEid, cameraController);
    hud.update(dt, playerEid);

    // --debug-viewmodel overlay update. setVisible(false) makes update() a
    // no-op, so the only cost when disabled is the boolean check below
    // (snapshot is built only on the enabled branch).
    if (viewmodelDebugEnabled) {
      const stateNum = CombatStateComp.state[playerEid];
      const dirNum = CombatStateComp.direction[playerEid];
      // Direction labels — single unified `Direction` enum after FSM v2 #139
      // (Overhead=0, Left=1, Right=2, Stab=3). No longer state-dependent —
      // attack and block share the same enum and the same numeric value.
      // (Pre-#139 this branched on Block/ParryWindow; those states no
      // longer exist anyway, having been collapsed into Blocking/Parry.)
      const dirLabel =
        ['Overhead', 'Left', 'Right', 'Stab'][dirNum] ?? String(dirNum);
      _boneEulers['upper_arm_R'] = viewmodel.bones['upper_arm_R'].rotation;
      _boneEulers['forearm_R'] = viewmodel.bones['forearm_R'].rotation;
      _boneEulers['hand_R'] = viewmodel.bones['hand_R'].rotation;
      _boneEulers['weapon_attach'] = viewmodel.bones['weapon_attach'].rotation;
      // Aim-sway lag readout (#129): live angle between the viewmodel group
      // and the world camera, in degrees. With τ=80ms and a frame at 16ms,
      // this hovers near 0° at rest and spikes briefly during fast aim
      // flicks, decaying back to 0 over a few frames. A non-zero idle value
      // would indicate a broken sync or a per-frame source of rotation
      // outside the slerp.
      const aimSwayDeg =
        viewmodel.group.quaternion.angleTo(world.camera.quaternion) * (180 / Math.PI);

      viewmodelDebugOverlay.update({
        weaponName: viewmodel.getCurrentWeaponName() ?? '?',
        combatState: COMBAT_STATE_NAMES[stateNum] ?? String(stateNum),
        direction: dirLabel,
        phaseElapsed: CombatStateComp.phaseElapsed[playerEid],
        phaseTotal: CombatStateComp.phaseTotal[playerEid],
        boneEulers: _boneEulers,
        armOffset: getArmOffset(),
        fov: viewmodel.camera.fov,
        aimSwayDeg,
      });
    }
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

    // Pass 2: Sync viewmodel camera, clear depth, render viewmodel (Layer 1).
    //
    // Issue #129: pass dt + horizontal velocity so the renderer can apply the
    // aim-sway lag (rotational low-pass, doc §7) and locomotion bob (doc §6).
    //   - `dt` is captured from the prior `loop.update(dt)` call (render gets
    //     `alpha`, not `dt`, from GameLoop). Caching it across the
    //     update→render boundary is sound because they always run in lockstep
    //     within one tick (see GameLoop.tick).
    //   - Horizontal velocity: kinematic-position-based bodies don't populate
    //     Rapier's `linvel()`, and `Velocity.x/.z` aren't written by any system
    //     today, so derive from Position deltas. Position only changes on
    //     fixed ticks; the read is piecewise-constant between physics steps,
    //     which is fine for the bob (perceived as a smooth stride).
    const velX = (Position.x[playerEid] - PreviousPosition.x[playerEid]) / FIXED_TIMESTEP;
    const velZ = (Position.z[playerEid] - PreviousPosition.z[playerEid]) / FIXED_TIMESTEP;
    viewmodel.syncWithCamera(world.camera, lastUpdateDt, velX, velZ);
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
