import { createGameWorld } from './core/World';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './input/InputManager';
import { shouldDispatchDebugKey } from './input/debugKeyGate';
import { CameraController } from './rendering/CameraController';
import { extrapolateRenderPosition } from './rendering/renderExtrapolation';
import { createMovementSystem } from './ecs/systems/MovementSystem';
import { createInputSystem } from './ecs/systems/InputSystem';
import { createCombatSystem } from './ecs/systems/CombatSystem';
import { staminaSystemTick } from './ecs/systems/StaminaSystem';
import { healthSystemTick } from './ecs/systems/HealthSystem';
import { processDeaths } from './ecs/systems/processDeaths';
import { EventBus } from './events/EventBus';
import { awardGold, awardGoldOnKill } from './economy/goldEconomy';
import { flushGoldWrites } from './economy/goldPersistence';
import { createPlayer } from './ecs/entities/createPlayer';
import { createArenaV2 } from './arena/createArenaV2';
import { processRespawns } from './ecs/systems/processRespawns';
import {
  createTrainingDummy,
  removeTrainingDummy,
  resetAllTrainingDummies,
  toggleTrainingDummyBlock,
  cycleTrainingDummyBlockDirection,
  tickTrainingDummyHealthReset,
  getTrainingDummyEids,
} from './ecs/entities/createTrainingDummy';
import { createShopkeep } from './ecs/entities/createShopkeep';
import { NetClient } from './net/NetClient';
import { NetworkSystem } from './net/NetworkSystem';
import { removeAllRemotePlayers, getRemotePlayerEids } from './net/RemotePlayers';
import { MatchHUD } from './hud/MatchHUD';
import { initAuth, getAuthState } from './auth/session';
import { toggleWarmupBot, getWarmupBotEids, removeWarmupBot } from './ecs/entities/createWarmupBot';
import { createBotAISystem } from './ecs/systems/BotAISystem';
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
import { knockbackSystem } from './ecs/systems/KnockbackSystem';
import { advanceFixedTick, getCurrentFixedTick } from './core/tickCounter';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';
import { FloatingDamage } from './hud/FloatingDamage';
import { DummyHealthBar } from './hud/DummyHealthBar';
import { WorldLabel } from './hud/WorldLabel';
import { createNpcDamageObserver } from './ecs/systems/NpcDamageObserver';
import { showNotification } from './hud/DebugNotification';
import { InventoryPanel } from './hud/InventoryPanel';
import { ShopPanel } from './hud/ShopPanel';
import { FIXED_TIMESTEP } from './core/types';
import {
  Position,
  PreviousPosition,
  Rotation,
  PreviousRotation,
  Health,
  KnockbackState,
  DeadTag,
  MovementIntent,
  MovementState,
  BotBrain,
  meshRegistry,
} from './ecs/components';
import { lerp } from './utils/math';
import { createFSM, fsmRegistry } from './combat/CombatFSM';
import { weaponConfigs } from './weapons/WeaponConfig';
import { weaponIdToName } from './ecs/systems/CombatSystem';
import {
  initInventory,
  equipWeapon,
  addWeaponToInventory,
  getInventory,
  onEquip,
  registerWeaponModelFactory,
} from './ecs/systems/InventorySystem';
import { weaponModelFactories } from './rendering/WeaponModels';
import { ViewmodelRenderer, getArmOffset } from './rendering/ViewmodelRenderer';
import { viewmodelAnimationSystem } from './rendering/ViewmodelAnimationSystem';
import { pickupRenderer } from './rendering/PickupRenderer';
import { weaponPickupSystem } from './ecs/systems/WeaponPickupSystem';
import { ViewmodelDebugOverlay } from './hud/ViewmodelDebugOverlay';
import { PickupPrompt } from './hud/PickupPrompt';
import { CombatStateComp } from './ecs/components';
import { COMBAT_STATE_NAMES } from './combat/states';
import { hasComponent } from 'bitecs';
import * as THREE from 'three';
import type { GameWorld } from './core/types';
import { GameState, GameStateManager } from './core/GameState';
import { MenuManager } from './hud/MenuManager';
import { MainMenu } from './hud/MainMenu';
import { PauseMenu } from './hud/PauseMenu';
import { ControlsOverlay } from './hud/ControlsOverlay';

// Import weapon configs so they auto-register
import './weapons/longsword';
import './weapons/mace';
import './weapons/dagger';
import './weapons/battleaxe';
import './weapons/zweihander';
import './weapons/warhammer';
import './weapons/spear';
import './weapons/katana';
import './weapons/scythe';
import './weapons/yeeter';
import './weapons/rapier';
import './weapons/halberd';

// Populate weaponConfigMap for TracerSystem — maps numeric weapon IDs to configs
for (const [name, config] of Object.entries(weaponConfigs)) {
  const idx = weaponIdToName.indexOf(name);
  if (idx >= 0) weaponConfigMap.set(idx, config);
}

/** Next dummy spawn index for position cycling */
let dummySpawnIdx = 0;

/**
 * Practice training-dummy spawn positions (J-key cycle).
 *
 * Arena v2 (#207) is a 100 m map with a raised central plateau (the future
 * castle site). The old logic reused the arena's interior spawn indices, but
 * v2's 10 spawns sit on a 39 m ring — scattering dummies across the whole map.
 * Instead we place practice dummies at a fixed cluster of OPEN, FLAT grass
 * positions on the +Z play side, a few meters apart and comfortably off the
 * plateau skirt (radius ≈ 26 m) so they stay reachable and don't stand on the
 * elevated foundation. These are code-authored, not derived from spawn points.
 */
function getDummySpawnPositions(_world: GameWorld): Array<{ x: number; z: number }> {
  return [
    { x: 12, z: 30 },
    { x: -12, z: 30 },
    { x: 24, z: 28 },
    { x: -24, z: 28 },
  ];
}

function spawnDummyAtNextPosition(world: GameWorld): void {
  const positions = getDummySpawnPositions(world);
  const pos = positions[dummySpawnIdx % positions.length];
  const colors = [0xcc4444, 0xcc8844, 0xcc44cc, 0x44cccc, 0xcccc44];
  const color = colors[dummySpawnIdx % colors.length];
  createTrainingDummy(world, { spawnPos: { x: pos.x, z: pos.z }, color });
  dummySpawnIdx++;
  showNotification(
    `Dummy spawned (${getTrainingDummyEids(world).length} total)`,
  );
}

async function main(): Promise<void> {
  // Initialize game world
  const world = await createGameWorld();
  document.body.prepend(world.renderer.domElement);

  // Input manager
  const input = new InputManager(world.renderer.domElement);

  // Camera controller
  const cameraController = new CameraController(world.camera, input);

  // Create Arena v2 (issue #207). `createArenaV2` adds the lighting rig, the
  // variable-height terrain (heightfield collider + vertex-colored mesh), the
  // 4 boundary walls, AND registers the 10 arena spawn points into
  // `world/SpawnPoints.ts`. The returned ArenaSpec carries the spawn list, the
  // terrain handle (ground-height sampler), the shopkeep stall, and the
  // weapon-pickup safe volume — stored on `world.arena` so other systems can
  // query ground height via `getGroundHeightAt(world.arena, x, z)`.
  const arena = createArenaV2(world);
  world.arena = arena;

  // Create player at the first arena spawn point (S1 — Arena v2's south side,
  // at (12, 37) on the radius-39 ring). The createPlayer factory falls back to
  // the registry
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
  // Point the camera along the spawn facing too. MovementSystem overwrites
  // Rotation.y from the camera yaw every tick, so without this the component
  // value above is clobbered on tick 1 and the player looks down -Z regardless
  // of spawn point (#211/#212).
  cameraController.setYaw(spawn0.facing);
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
      // Look along the new spawn facing. Must set the camera (not just
      // Rotation.y) because MovementSystem re-derives Rotation.y from camera
      // yaw each tick (#211/#212).
      cameraController.setYaw(payload.yaw);
      viewmodel.snap(world.camera);
    }
  });

  // Award gold on kill. The kill-attribution pipeline lives in
  // DamageSystem → processDeaths (#130/#134): every successful unblocked hit
  // records `{ attackerEid, weaponId, bodyRegion, tick }` into a per-victim
  // attribution map with a 5 s (300 tick) window, and `processDeaths` then
  // resolves the killer and emits `DeathEvent { victimEid, killerEid, ... }`.
  // We just subscribe — no parallel attribution path in HealthSystem.
  //
  // `killerEid === 0` is the documented sentinel for environmental / suicide;
  // pass `undefined` to keep `awardGoldOnKill`'s 4-rule body (env / self /
  // non-Player / missing-Gold) unchanged.
  EventBus.on('DeathEvent', (payload) => {
    awardGoldOnKill(
      world.ecs,
      payload.victimEid,
      payload.killerEid === 0 ? undefined : payload.killerEid,
    );
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

  // ── Game modes (multiplayer era) ──
  // Practice NPCs (training dummy + shopkeep) are spawned lazily when the
  // player first enters PRACTICE BOTS — a multiplayer match must not
  // contain local-only combat targets.
  let gameMode: 'none' | 'practice' | 'multiplayer' = 'none';
  let practiceNpcsSpawned = false;

  // Supabase auth (guest-mode no-op when env is missing).
  initAuth();

  // Multiplayer plumbing. NetworkSystem mutates the world from server
  // messages; MatchHUD renders its matchState (timer / Tab scoreboard /
  // match-end standings).
  const netClient = new NetClient();

  function spawnPracticeNpcs(): void {
    if (practiceNpcsSpawned) return;
    practiceNpcsSpawned = true;
    // Spawn the first practice dummy at the first open-grass practice position
    // (Arena v2's plateau makes the old hardcoded (0,-4) land on the raised
    // castle foundation — see getDummySpawnPositions).
    const firstDummyPos = getDummySpawnPositions(world)[0];
    createTrainingDummy(world, { spawnPos: firstDummyPos, color: 0xcc4444 });
    dummySpawnIdx = 1;
    const npc = arena.shopkeepStall.npcAnchor;
    createShopkeep(world, npc.x, npc.y, npc.z, { name: 'Shopkeep' });
  }

  function removePracticeNpcs(): void {
    // Warmup bots are practice-only local combatants — despawn regardless
    // of the lazy-spawn flag (the player may have toggled one with B).
    for (const beid of getWarmupBotEids(world)) {
      removeWarmupBot(world, beid);
    }
    if (!practiceNpcsSpawned) return;
    practiceNpcsSpawned = false;
    for (const eid of getTrainingDummyEids(world)) {
      removeTrainingDummy(world, eid);
    }
    // Shopkeep is static + non-combat; leaving it out of MP matters less,
    // but remove for a clean arena. (createShopkeep has no query — track
    // via interaction registry not needed at this scale; skipped v1.)
  }

  function enterPractice(): void {
    if (gameMode === 'multiplayer') {
      netClient.disconnect();
      removeAllRemotePlayers(world);
      matchHUD.setActive(false);
    }
    spawnPracticeNpcs();
    gameMode = 'practice';
  }

  function enterMultiplayerFFA(): void {
    removePracticeNpcs();
    const auth = getAuthState();
    netClient.connect({
      name: auth.profile?.username,
      token: auth.accessToken ?? undefined,
    });
    matchHUD.setActive(true);
    gameMode = 'multiplayer';
  }

  // Input + movement systems (input writes MovementIntent; movement consumes it)
  const inputSystem = createInputSystem(world, input, cameraController);
  const movementSystem = createMovementSystem(world, cameraController);

  // Warmup-bot AI (#119) — writes MovementIntent + FSM Attack inputs for
  // Bot-tagged entities. Must run after inputSystem (same seam) and before
  // combat/movement so they consume this tick's decisions.
  const botAISystem = createBotAISystem(world);

  // Create combat system (reads input, drives per-entity FSMs)
  const combatSystem = createCombatSystem(world.ecs, input, cameraController);

  // Multiplayer: server-message application + state sends + claim
  // interception (see src/net/NetworkSystem.ts for the trust model).
  const network = new NetworkSystem(world, netClient, playerEid, cameraController);
  const matchHUD = new MatchHUD(() =>
    gameMode === 'multiplayer' ? network.matchState : null,
  );

  // Menu → mode hooks (called synchronously inside button click handlers).
  // Assigned after mainMenu construction below.

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
  // GameStateManager defaults to MAIN_MENU. As of issue #106 the page now
  // loads into the main menu and the player must click Play to transition
  // into PLAYING — no eager state flip here. See `MainMenu.ts` for the
  // entry-overlay implementation.
  const gameStateManager = new GameStateManager();

  // MenuManager owns the ESC listener, pointer-lock release, input pause, and
  // click-to-play suppression for any modal that registers with it. Its ctor
  // sets `input._suppressClickToPlay = () => menuManager.isAnyOpen()` — we
  // override that below to also account for ShopPanel (which doesn't yet
  // register with MenuManager — its modal kind isn't part of #101's contract).
  const menuManager = new MenuManager(input, gameStateManager);

  // Main menu (#106). The MenuManager registration covers the click-to-play
  // suppression composition (`menuManager.isAnyOpen()`) so the legacy
  // `#click-to-play` text overlay stays hidden behind us on initial load.
  // The eventual override below (`|| shopPanel.isOpen`) doesn't touch our
  // path — we're already accounted for by `isAnyOpen()`.
  const mainMenu = new MainMenu(input, gameStateManager, menuManager);
  mainMenu.onPractice = () => enterPractice();
  mainMenu.onMultiplayerFFA = () => enterMultiplayerFFA();

  // Leaving to the main menu (pause → Quit) tears down a live match.
  gameStateManager.subscribe((state) => {
    if (state === GameState.MAIN_MENU && gameMode === 'multiplayer') {
      netClient.disconnect();
      removeAllRemotePlayers(world);
      matchHUD.setActive(false);
      gameMode = 'none';
    }
  });

  // Pause menu (#111). Opens on ESC during PLAYING — MenuManager owns the ESC
  // listener and dispatches to the registered `pause` handler. Resume button
  // closes; Quit transitions GameState back to MAIN_MENU; Controls opens the
  // ControlsOverlay on top (via MenuManager's one-deep back-stack).
  const pauseMenu = new PauseMenu(gameStateManager, menuManager);

  // Read-only Controls overlay (#111). Reachable from PauseMenu's "Controls"
  // button (and from MainMenu once that flow is wired). MenuManager's back-
  // stack ensures Back/ESC restores whichever modal opened it.
  const controlsOverlay = new ControlsOverlay(menuManager);

  // Link the two panels so PauseMenu's "Controls" button can call into
  // ControlsOverlay.show() without depending on construction order.
  pauseMenu.setControlsOverlay(controlsOverlay);
  // Reference both so unused-variable lint stays quiet — the MenuManager
  // registrations keep them reactive for the lifetime of the page.
  void pauseMenu;
  void controlsOverlay;

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
  const dummyHealthBar = new DummyHealthBar(world.camera, world);
  const dummyDamageObserver = createNpcDamageObserver(world, floatingDamage);

  // Shopkeep nameplate + "Press [E] to shop" prompt
  const worldLabel = new WorldLabel(world.camera);

  // ─── Keybind handler (T, Y, J, K, number keys) ───
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Issue #172: Debug dummy controls (T/Y/J/K) must be inert when the
    // game is paused (overlay open, focus lost) or when no pointer lock
    // is held. Without this gate, pressing K while typing in DevTools or
    // with the inventory open would reset all dummies, and T/Y/J would
    // similarly side-effect from outside the play surface. Predicate
    // lives in `input/debugKeyGate.ts` so it has a unit-test seam.
    if (
      !shouldDispatchDebugKey(
        e.code,
        input.paused,
        document.pointerLockElement,
        world.renderer.domElement,
      )
    ) {
      return;
    }

    // Dummy/bot debug keys are practice-mode tools — in a multiplayer
    // match they'd spawn local-only combatants nobody else can see.
    if (
      gameMode !== 'practice' &&
      (e.code === 'KeyT' || e.code === 'KeyY' || e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'KeyB')
    ) {
      return;
    }

    switch (e.code) {
      case 'KeyT': {
        const state = toggleTrainingDummyBlock(world);
        showNotification(`Dummy: ${state}`);
        break;
      }
      case 'KeyY': {
        const dir = cycleTrainingDummyBlockDirection(world);
        showNotification(`Dummy Block Dir: ${dir}`);
        break;
      }
      case 'KeyJ':
        spawnDummyAtNextPosition(world);
        break;
      case 'KeyK':
        resetAllTrainingDummies(world);
        showNotification('All dummies reset');
        break;
      case 'KeyB': {
        const active = toggleWarmupBot(world, playerEid);
        showNotification(active ? 'Warmup bot: ON' : 'Warmup bot: OFF');
        break;
      }
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
  // Dev helper: self-provisions the weapon into inventory so testers can
  // try any registered weapon without walking to the shop.
  (window as any).setWeapon = (name: string): void => {
    const config = weaponConfigs[name];
    if (!config) {
      console.warn(
        `Weapon "${name}" not found. Available: ${Object.keys(weaponConfigs).join(', ')}`,
      );
      return;
    }
    addWeaponToInventory(world.playerEntity, name);
    const success = equipWeapon(world.playerEntity, name);
    if (success) {
      console.log(`Weapon set to: ${config.name}`);
    } else {
      console.warn(`Could not equip "${name}" — player may not be idle`);
    }
  };

  // ─── Automated-verification helpers (headless browser drivers) ───
  // Read-only ECS state snapshots. The browser-automation harness aims and
  // asserts against these; they're also handy for manual console poking.
  (window as any).__getPlayerState = () => ({
    pos: {
      x: Position.x[playerEid],
      y: Position.y[playerEid],
      z: Position.z[playerEid],
    },
    yaw: Rotation.y[playerEid],
    hp: Health.current[playerEid],
    combatState: COMBAT_STATE_NAMES[CombatStateComp.state[playerEid]],
    dead: hasComponent(world.ecs, DeadTag, playerEid),
    pointerLocked: document.pointerLockElement != null,
  });
  // Multiplayer verification helpers (headless browser drivers).
  (window as any).__getMatchState = () => ({ ...network.matchState, mode: gameMode });
  (window as any).__getRemotes = () =>
    getRemotePlayerEids(world).map((eid) => ({
      eid,
      hp: Health.current[eid],
      pos: { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
    }));
  (window as any).__getBots = () =>
    getWarmupBotEids(world).map((eid) => ({
      eid,
      hp: Health.current[eid],
      pos: { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
      dead: hasComponent(world.ecs, DeadTag, eid),
      intent: { x: MovementIntent.moveX[eid], z: MovementIntent.moveZ[eid] },
      mode: BotBrain.mode[eid],
      targetEid: BotBrain.targetEid[eid],
      grounded: MovementState.grounded[eid],
      yaw: Rotation.y[eid],
    }));
  (window as any).__getNpcs = () =>
    getTrainingDummyEids(world).map((eid) => ({
      eid,
      hp: Health.current[eid],
      pos: { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
      kb: {
        vx: KnockbackState.vx[eid],
        vy: KnockbackState.vy[eid],
        vz: KnockbackState.vz[eid],
        ticks: KnockbackState.ticksRemaining[eid],
      },
    }));

  // ─── Expose inventory query for debugging ───
  (window as any).getInventory = () => getInventory(world.playerEntity);

  // ─── Dev gold faucet ───
  // Testing seam for the shop flow: with no bots/players to kill yet, gold
  // income is zero (dummies are excluded from the death pipeline), so the
  // 200-gold starting balance is otherwise a hard cap. Routes through
  // `awardGold` — the single economy chokepoint — so the Wallet the shop
  // reads, the HUD counter, the ECS `Gold` slot, and localStorage
  // persistence all update exactly like a real kill reward. `reason:
  // 'admin'` is the metadata label goldEconomy defines for this (it is a
  // label, not an authorization — same trust level as `setWeapon`, which
  // already bypasses the shop entirely). Remove both together when a
  // server-authoritative economy lands (#92).
  (window as any).addGold = (amount = 500): number => {
    const balance = awardGold(world.playerEntity, amount, 'admin');
    console.log(`Gold +${amount} → ${balance}`);
    return balance;
  };

  // ─── Diagnostic helpers (FP-weapon-visibility investigation, post-#181) ───
  // Track removal via a new GitHub issue when the FP weapon bug is resolved.
  (window as any).__getViewmodelState = () => ({
    visible: viewmodel.visible,
    currentWeapon: viewmodel.getCurrentWeaponName(),
    groupChildren: viewmodel.group.children.length,
    groupVisible: viewmodel.group.visible,
    cameraLayer: viewmodel.camera.layers.mask,
    sceneHasGroup: world.scene.children.includes(viewmodel.group),
    mode: cameraController.getMode(),
  });
  // Flat, paste-friendly viewmodel-scene dump. One newline-separated line
  // per descendant: name | world=(x,y,z) | rel=(dx,dy,dz from camera) | vis/layer.
  (window as any).__viewmodelSummary = () => {
    const cam = viewmodel.camera;
    const camPos = cam.position;
    const worldPos = new THREE.Vector3();
    const lines: string[] = [];
    lines.push(
      `CAMERA pos=(${camPos.x.toFixed(2)},${camPos.y.toFixed(2)},${camPos.z.toFixed(2)}) fov=${cam.fov} near=${cam.near} far=${cam.far} layer=${cam.layers.mask}`,
    );
    viewmodel.group.traverse((obj: any) => {
      obj.getWorldPosition(worldPos);
      const dx = worldPos.x - camPos.x;
      const dy = worldPos.y - camPos.y;
      const dz = worldPos.z - camPos.z;
      const name = (obj.name || obj.type).padEnd(30);
      lines.push(
        `${name} world=(${worldPos.x.toFixed(2)},${worldPos.y.toFixed(2)},${worldPos.z.toFixed(2)}) rel=(${dx.toFixed(2)},${dy.toFixed(2)},${dz.toFixed(2)}) vis=${obj.visible} layer=${obj.layers?.mask}`,
      );
    });
    return lines.join('\n');
  };
  // Live arm-anchor tuner. Mutates the shared ARM_OFFSET Vector3 in place
  // so `syncWithCamera` picks up the new value next frame. Call with no
  // args to read the current value; call with (x, y, z) numbers to write.
  //   Examples: __setArmOffset()              → {x: 0.32, y: -0.30, z: -0.40}
  //             __setArmOffset(0.35, -0.35)   → only x, y change; z held
  //             __setArmOffset(0.4, -0.4, -0.5)
  (window as any).__setArmOffset = (x?: number, y?: number, z?: number) => {
    const a = getArmOffset();
    if (typeof x === 'number') a.x = x;
    if (typeof y === 'number') a.y = y;
    if (typeof z === 'number') a.z = z;
    return { x: a.x, y: a.y, z: a.z };
  };

  // Count layer-1 lights actually in the scene — verifies the viewmodel
  // lighting fix actually compiled & ran without depending on memory.
  (window as any).__getViewmodelLights = () => {
    const lights: any[] = [];
    world.scene.traverse((obj: any) => {
      if (obj.isLight) {
        lights.push({
          type: obj.type,
          intensity: obj.intensity,
          layerMask: obj.layers.mask,
          position: obj.position ? `(${obj.position.x.toFixed(2)},${obj.position.y.toFixed(2)},${obj.position.z.toFixed(2)})` : 'n/a',
        });
      }
    });
    return lights;
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
    // Advance the global fixed-tick counter ONCE per fixedUpdate so
    // tick-stamped events (e.g. HitReactComp.spawnedAtTick) are consistent
    // for everything that runs this tick.
    advanceFixedTick();

    // Translate raw input → MovementIntent for the player. Must run before
    // combat/movement so they see this tick's intent.
    inputSystem(FIXED_TIMESTEP);

    // Bot decisions — MovementIntent + swing inputs for warmup bots (#119).
    botAISystem();

    // Combat system (reads input, ticks FSMs, syncs ECS components)
    combatSystem();

    // Movement system — consumes MovementIntent, writes Position via Rapier
    movementSystem(FIXED_TIMESTEP);

    // Multiplayer: interpolate remote puppets toward the newest server
    // states (before hitboxSystem so their hitboxes track), and stream the
    // local player's state to the server at CLIENT_SEND_HZ.
    if (gameMode === 'multiplayer') {
      network.updateRemotes();
      network.sendLocalState();
    }

    // Stamina system (reads combat state, handles regen/costs)
    staminaSystemTick(world.ecs);

    // Health system + death/respawn pipeline — PRACTICE/local modes only.
    // In multiplayer the SERVER owns HP, deaths, and respawns: the hp/death/
    // respawn message handlers in NetworkSystem drive DeadTag/RespawnPending
    // on the local player, and remote puppets never enter the local
    // lifecycle at all (they'd get death-tagged and locally teleported,
    // fighting the server's position stream — QA blocker on PR #193).
    if (gameMode !== 'multiplayer') {
      const { died, respawned } = healthSystemTick(world.ecs);
      processDeaths(died, world);
      processRespawns(respawned, world);
    } else {
      // Display-only respawn countdown for the DeathScreen.
      network.tickLocalLifecycle();
    }

    // Step physics
    world.physicsWorld.step();

    // Sync hitbox positions to skeleton bones
    hitboxSystem(world);

    // Training-dummy auto-regen (3 s no-hit → restore HP). MUST run
    // BEFORE TracerSystem/DamageSystem: `recordNpcHit` fires from the
    // DamageDealt handler at EventBus.flush (end of tick), so a regen
    // check placed after DamageSystem would still see the stale last-hit
    // tick on the very tick a hit lands and instantly heal the wound —
    // the "damage doesn't work" bug. Up here it only ever acts on fully
    // recorded state from previous ticks.
    tickTrainingDummyHealthReset(world);

    // NpcDamageObserver is EventBus-driven now (see its docstring); this
    // per-tick call is a no-op kept for call-site compatibility.
    dummyDamageObserver(FIXED_TIMESTEP);

    // Tracer hit detection + damage resolution. DamageSystem may stamp
    // HitReactComp on a target this tick; the hit-react clear pass runs
    // after so it doesn't immediately wipe a fresh entry.
    TracerSystem(world, FIXED_TIMESTEP);
    // Multiplayer: convert DamageEvents on remote players into server
    // claims (and judge blocks attacker-side) BEFORE DamageSystem — a
    // server-owned entity must never take local HP writes.
    if (gameMode === 'multiplayer') {
      network.interceptClaims();
    }
    DamageSystem(world, FIXED_TIMESTEP);
    hitReactSystemTick(world.ecs);

    // Ballistic knockback for non-player entities (dummies/bots go flying
    // when hit by heavy weapons). Player knockback is folded into
    // MovementSystem's character controller instead. Runs after
    // DamageSystem so a same-tick impulse starts moving the victim now.
    knockbackSystem(world);

    // Update nearest-interactable cache (for KeyE handler + WorldLabel prompt)
    interactionSystem(playerEid);

    // Weapon pickup + despawn loop (#121). Reads `KeyE` edge-press, calls
    // `tryClaimPickup` against the closest in-range `WeaponPickup`, swaps
    // inventory + equipment on success (dropping the previously-equipped
    // weapon at the player's feet with a claim cooldown), and sweeps any
    // pickup past its `despawnTick` from the scene. Drop-on-death is NOT
    // here — that goes through `dropEquippedWeapon` called from
    // `processDeaths` above. Emits `WeaponPickup` / `WeaponDespawn` on
    // EventBus; the returned arrays are for in-test assertions.
    weaponPickupSystem(world, getCurrentFixedTick(), input, playerEid);

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
    matchHUD.update();

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

  // Scratch for the local player's extrapolated render position (no
  // per-frame allocation).
  const _localRenderPos = { x: 0, y: 0, z: 0 };

  loop.render = (alpha: number) => {
    // Sync skeletal mesh groups by interpolating between the previous tick
    // and current tick's positions. This prevents visible 60Hz snapping at
    // higher render framerates (e.g. 144Hz vsync). Runs in render — NOT
    // fixedUpdate — so the mesh interpolates smoothly between physics ticks.
    const playerModelData = meshRegistry.get(playerEid);
    if (playerModelData) {
      // Local player EXTRAPOLATES (renders "now" instead of one tick ago) —
      // see renderExtrapolation.ts. Must stay in lockstep with
      // cameraController.updateCamera, which uses the same helper, or the
      // third-person camera would visibly lead its own body.
      extrapolateRenderPosition(playerEid, alpha, _localRenderPos);
      playerModelData.group.position.set(
        _localRenderPos.x,
        _localRenderPos.y,
        _localRenderPos.z,
      );
      // Body yaw follows aim. Plain lerp is safe (no wrap handling) because
      // CameraController yaw accumulates continuously — consecutive tick
      // values are always close. hitboxSystem writes the un-lerped value at
      // fixed rate for physics; this is the smooth visual counterpart.
      playerModelData.group.rotation.y = lerp(
        PreviousRotation.y[playerEid],
        Rotation.y[playerEid],
        alpha,
      );
    }
    // Remote players (multiplayer): lerp position + take yaw directly
    // (already interpolated at fixed rate by remotePlayerSystem).
    for (const reid of getRemotePlayerEids(world)) {
      const modelData = meshRegistry.get(reid);
      if (modelData) {
        modelData.group.position.set(
          lerp(PreviousPosition.x[reid], Position.x[reid], alpha),
          lerp(PreviousPosition.y[reid], Position.y[reid], alpha),
          lerp(PreviousPosition.z[reid], Position.z[reid], alpha),
        );
        modelData.group.rotation.y = Rotation.y[reid];
      }
    }

    // Warmup bots move every tick — interpolate position AND yaw so they
    // glide instead of snapping at 60 Hz (#119).
    for (const beid of getWarmupBotEids(world)) {
      const modelData = meshRegistry.get(beid);
      if (modelData) {
        modelData.group.position.set(
          lerp(PreviousPosition.x[beid], Position.x[beid], alpha),
          lerp(PreviousPosition.y[beid], Position.y[beid], alpha),
          lerp(PreviousPosition.z[beid], Position.z[beid], alpha),
        );
        modelData.group.rotation.y = Rotation.y[beid];
      }
    }
    // Iterate every training dummy via the IsTrainingDummy tag query (the
    // legacy `activeDummies` array is gone — issue #114). Bots and other
    // future moving NPCs that need lerp-sync should join this loop via the
    // same query (they'll get IsNPC + IsBot — see the spec doc).
    for (const deid of getTrainingDummyEids(world)) {
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

  // Persist any pending gold-balance writes before the page unloads.
  // `saveGold` is debounced (100ms trailing-edge), so the most recent
  // award is normally still in-flight when the user closes the tab or
  // refreshes — without this flush, that last award is lost. Per MDN's
  // guidance, we use `beforeunload` rather than the deprecated `unload`
  // (unload is unreliable on mobile). The handler is synchronous, calls
  // `flushGoldWrites()` which never throws, and does not call
  // `event.preventDefault()` — so it cannot block the unload.
  window.addEventListener('beforeunload', () => {
    flushGoldWrites();
  });

  loop.start();
}

main().catch(console.error);
