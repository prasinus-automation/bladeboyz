# AGENTS.md — BladeBoyz Project Context

## Overview
BladeBoyz is a browser-based multiplayer melee combat game built with Three.js. Ultra-low-poly BattleBit-style aesthetic with Mordhau/Chivalry directional combat mechanics. Currently in scaffolding phase — single player, test arena, no networking yet.

## Tech Stack
- **Runtime**: Modern browsers (Chrome/Firefox/Edge)
- **Language**: TypeScript (strict mode)
- **Renderer**: Three.js (latest stable, ^0.170.x)
- **Build Tool**: Vite (^6.x)
- **Physics**: Rapier3D WASM (`@dimforge/rapier3d-compat`)
- **ECS**: bitECS (lightweight, performant ECS for JS/TS)
- **State Machine**: Custom minimal FSM (data-driven, tick-based)
- **Input**: Raw browser `KeyboardEvent` / `MouseEvent` / `PointerLockAPI` — no abstraction libraries

## Project Structure
```
bladeboyz/
├── src/
│   ├── main.ts                  # Entry point, initializes World and starts game loop
│   ├── core/
│   │   ├── GameLoop.ts          # Fixed-timestep game loop (60Hz fixed + variable render)
│   │   ├── World.ts             # Singleton owning ECS world, Three.js scene, Rapier world
│   │   └── types.ts             # Shared type definitions
│   ├── ecs/
│   │   ├── components.ts        # bitECS component definitions
│   │   ├── systems/             # ECS systems (one file per system)
│   │   │   ├── MovementSystem.ts
│   │   │   ├── CombatSystem.ts
│   │   │   ├── InventorySystem.ts
│   │   │   ├── TracerSystem.ts
│   │   │   ├── HitboxSystem.ts
│   │   │   ├── StaminaSystem.ts
│   │   │   ├── HealthSystem.ts  # Damage application, death detection, respawn timer (#93)
│   │   │   ├── AnimationSystem.ts
│   │   │   └── ...
│   │   └── entities/            # Entity factory/spawner functions
│   │       ├── createPlayer.ts
│   │       ├── createDummy.ts
│   │       └── ...
│   ├── events/
│   │   └── EventBus.ts          # In-process event bus for DeathEvent, RespawnEvent, DamageDealt (#93)
│   ├── world/
│   │   └── SpawnPoints.ts       # Spawn-point registry + selectSpawnPoint() weighted-random selector (#93)
│   ├── animation/
│   │   ├── AnimationData.ts     # Third-person combat animation poses (per-direction, per-phase)
│   │   └── ViewmodelAnimationData.ts # First-person viewmodel poses — per-weapon × per-direction × per-phase
│   ├── arena/
│   │   ├── types.ts             # ArenaSpec, SpawnPoint, ShopkeepStallSpec, Volume3D interfaces
│   │   └── createArena.ts       # Code-authored arena geometry + Rapier static colliders + lights (returns ArenaSpec)
│   ├── combat/
│   │   ├── CombatFSM.ts         # Combat state machine definition
│   │   ├── states.ts            # State enum and transition logic
│   │   └── directions.ts        # Attack/block direction detection from mouse input
│   ├── weapons/
│   │   ├── WeaponConfig.ts      # WeaponConfig type + registry (weaponConfigs, registerWeapon)
│   │   ├── longsword.ts         # Longsword weapon data (auto-registers on import)
│   │   ├── mace.ts              # Mace weapon data (auto-registers on import)
│   │   ├── dagger.ts            # Dagger weapon data (auto-registers on import)
│   │   └── battleaxe.ts         # Battleaxe weapon data (auto-registers on import)
│   ├── input/
│   │   └── InputManager.ts      # Raw input capture, pointer lock, mouse delta tracking
│   ├── rendering/
│   │   ├── CameraController.ts  # FPS + debug third-person camera
│   │   ├── CharacterModel.ts    # Procedural low-poly character mesh + skeleton
│   │   ├── WeaponModels.ts      # Procedural weapon models (Mace, Dagger, Battleaxe) + factory registry
│   │   ├── ViewmodelRenderer.ts # First-person viewmodel (right arm + weapon, Layer 1, separate camera)
│   │   ├── ViewmodelAnimationSystem.ts # Viewmodel bone animation (reads CombatStateComp, per-weapon poses)
│   │   └── DebugRenderer.ts     # Wireframe, hitbox, physics debug drawing
│   ├── inventory/
│   │   └── InventoryData.ts     # Inventory side-table (inventoryRegistry Map<eid, InventoryData>)
│   ├── hud/
│   │   ├── HUD.ts               # HUD manager
│   │   ├── HealthBar.ts
│   │   ├── StaminaBar.ts
│   │   ├── DirectionIndicator.ts # Mordhau-style compass-rose crosshair overlay (attack/block direction)
│   │   ├── InventoryPanel.ts    # Tab inventory UI overlay (HTML/CSS, pointer lock toggle)
│   │   ├── DeathScreen.ts       # Full-screen death overlay + respawn countdown (#93)
│   │   ├── Killfeed.ts          # Top-right kill log, fades after 5s (#93)
│   │   ├── Scoreboard.ts        # Persistent K/D/Gold display (#93)
│   │   ├── DebugOverlay.ts      # FSM state, FPS counter
│   │   └── shop/                # Shop overlay scaffold (#100)
│   │       ├── ShopPanel.ts     # Tab-switcher overlay (mirrors InventoryPanel; backdrop, Escape, click-outside, pointer-lock release via input.paused)
│   │       ├── PremiumShopTab.ts # USD tab — empty-state by default; Buy buttons disabled when provider.isAvailable() === false
│   │       └── types.ts         # Currency, ShopItem, ShopTab, PurchaseResult, PaymentProvider, MockPaymentProvider (always reports unavailable)
│   └── utils/
│       └── math.ts              # Vector utilities, interpolation helpers
├── docs/
│   ├── combat-fsm-v2.md                      # Combat FSM v2 architecture spec (issue #88)
│   └── training-dummies-and-bots-spec.md     # Architect spec for issue #99 (training dummies + warmup bots)
├── public/
│   └── (static assets if any)
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Dockerfile
├── .gitignore
├── AGENTS.md
└── README.md
```

## Architecture Principles

### ECS-First
Everything is an entity with composable components. No god-objects. Systems operate on component queries. This is critical for future networking.

### Fixed Timestep Game Loop
- `fixedUpdate(dt)` at **60Hz** for physics, combat, and game logic
- `update(dt)` for variable-rate work (animation blending)
- `render(alpha)` for interpolated rendering
- All combat timing is in **fixed-update ticks**, not wall-clock time

### Combat State Machine
Each combatant has a per-entity FSM. **Currently shipped** (v1, 11 states): `Idle`, `Windup`, `Release`, `Recovery`, `Block`, `ParryWindow`, `Riposte`, `Feint`, `Clash`, `Stunned`, `HitStun`. Transitions are data-driven from weapon config. **Turncap wiring** (PR #78): `CombatSystem` syncs `CameraController.maxTurnRate` from `FSM.getCurrentTurncap()` every fixed tick. Camera turn rate is capped during Windup/Release/Recovery/Feint per weapon config turncap values; uncapped (Infinity) during Idle/Block/ParryWindow/HitStun/Stunned.

**FSM v2 (in flight, see `docs/combat-fsm-v2.md` and issue #88)**: trims to 7 states (`Idle, Windup, Release, Recovery, Blocking, Parry, HitStun`), 4 directions (`Overhead, Left, Right, Stab` — `Underhand` removed), unified `CombatState` component (replaces dual `CombatStateComponent`/`CombatStateComp`), all state writes funnel through the FSM (no more direct writes from `DamageSystem`/`StaminaSystem`). Implementation gated on #85.

### Data-Driven Weapons
Weapon behavior comes entirely from `WeaponConfig` objects — no hardcoded weapon logic in systems.

### Tracer-Based Hit Detection
No simple raycasts. Weapons have tracer points along the blade. During Release phase, swept-volume collision checks between tick positions against enemy hitbox sensor colliders.

### Character Controller (planned — issue #86)
Movement is a Rapier `KinematicCharacterController` driven by `MovementSystem` in `fixedUpdate` at 60Hz. Player uses a `kinematicPositionBased` rigid body with a capsule collider; dummies use a `fixed` body with a capsule collider (static obstacle). The controller provides slope handling, autostep, and snap-to-ground. Gravity is applied manually in MovementSystem because Rapier's solver does not apply forces to kinematic/fixed bodies.

**Tick contract**:
1. `combatSystem()` → ticks FSMs, syncs combat state (and `CameraController.maxTurnRate`)
2. `movementSystem(dt)` → reads input + camera yaw, computes desired movement, calls `characterController.computeColliderMovement()`, calls `body.setNextKinematicTranslation()`, writes ECS `Position`
3. `world.physicsWorld.step()` → Rapier integrates kinematic translations and runs sensor queries
4. Mesh sync runs in `render(alpha)` with `lerp(PreviousPosition, Position, alpha)` — NOT in fixedUpdate (avoids 60Hz position snapping)

### Spawn / Death / Respawn Loop (designed in #93 — see [docs/spawn-death-respawn.md](docs/spawn-death-respawn.md))
Entity lifecycle is **separate from CombatFSM**: it's a higher-level state expressed via `DeadTag` + `RespawnPending` components plus `Health.current`. States: `Alive → Dying (1 tick) → Dead → Respawning (1 tick) → Alive`. Death fires a `DeathEvent` on the in-process `EventBus`; killfeed/scoreboard/death-screen consume it. Respawn timer is **180 ticks (3 s)**, default starter weapon is **Longsword**, spawn-point selection is **random weighted-away-from-enemies** (min distance 8.0, max-min fallback). `CombatSystem` and `MovementSystem` both early-out on `DeadTag` so dead entities don't read input or move. **Continuous deathmatch — no rounds for MVP.** See the design doc for full state diagram and event payloads.

## Build / Run / Test Commands
```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server with HMR
npm run build        # Production build
npm run preview      # Preview production build locally
npm run typecheck    # Run tsc --noEmit for type checking
npm run lint         # Run ESLint
```

## Styling / Rendering Approach
- **No CSS framework** — minimal HTML/CSS for HUD overlays only
- **No textures** — flat colored `MeshStandardMaterial` / `MeshBasicMaterial` only
- **Ultra-low-poly** — box heads, rectangular torsos, cylindrical limbs
- HUD elements are HTML overlays positioned with CSS, not Three.js sprites

## Key Conventions
- One ECS system per file in `src/ecs/systems/`
- Components defined centrally in `src/ecs/components.ts` using bitECS `defineComponent`
- Entity factories in `src/ecs/entities/` — each returns an entity ID
- Weapon configs are plain TypeScript objects (not JSON files) for type safety
- All physics/combat timing expressed in **ticks** (1 tick = 1/60th second)
- Use `const enum` for state enums where possible for zero-cost abstraction
- Rapier colliders for hitboxes are **sensors** (no physics response)
- Character skeletons use Three.js `Bone` / `Skeleton` — procedurally generated, not imported from glTF for scaffolding phase

### Spatial Conventions (issue #86 — under refactor)
- **ECS `Position` = entity feet position** (point of contact with ground). The character mesh's root bone is at the feet (`y=0`), so `meshGroup.position = (Position.x, Position.y, Position.z)` is a direct copy with NO offset.
- **Capsule collider** is offset upward inside the rigid body via `ColliderDesc.capsule(...).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0)` so the capsule's bottom hemisphere sits at the body origin (= feet).
- **Forward = -Z** (Three.js convention). Yaw=0 looks down -Z. `moveZ = -strafe*sin(yaw) - forward*cos(yaw)`.
- **Spawn**: always raycast down from `(x, 50, z)` and place feet at `hit.toi` (with a small `+CHARACTER_CONTROLLER_OFFSET` epsilon). Never hard-code Y in spawn-position arrays.
- **Ground**: arena ground is a fixed cuboid centered at y=0 with half-height 0.1, so its top surface is at **y = 0.1**. Visual ground plane sits at y=0 (mid-cuboid).
- This convention applies to **all** characters (player, dummies, future NPCs). Entity factories must not invent their own offset.

## Known Issues / Architectural Debt

### Two Combat State Components (SYNCED — slated for unification in FSM v2)
Two ECS components track combat state: `CombatStateComponent` (authoritative — synced from FSM by CombatSystem, used by HUD/StaminaSystem/DamageSystem) and `CombatStateComp` (animation mirror — has `phaseElapsed`/`phaseTotal`, used by AnimationSystem). **Both are now synced by CombatSystem** after FSM tick (fixed in PR #36). `computePhaseTotal()` in CombatSystem.ts derives phase duration from FSM state + weapon config. **FSM v2 collapses these into a single `CombatState` component** — see `docs/combat-fsm-v2.md` §9.

### Direct State Writes Bypass the FSM (FSM v2 will fix)
`DamageSystem.ts` (lines 109, 128, 146) and `StaminaSystem.ts` (lines 99-100) write `CombatStateComponent.state` directly without dispatching an FSM input. This desyncs the FSM in `fsmRegistry` from the ECS component. FSM v2 routes every state change through `FSM.transition(input)` — see `docs/combat-fsm-v2.md` §7.

### Two Disconnected Inventory Modules (PARTIALLY RESOLVED — `InventoryData.ts` is dead code)
`src/inventory/InventoryData.ts` is a lightweight UI-only side-table that was originally consumed by `InventoryPanel.ts`. `src/ecs/systems/InventorySystem.ts` is the real system with full equip logic (3D model swap, FSM update, ECS sync). **`InventoryPanel.ts` now correctly imports from `InventorySystem.ts`** (line 11 — `getInventory`, `equipWeapon`). `InventoryData.ts` is unused dead code referenced only by its own tests; remove in a cleanup PR.

### Damage Pipeline (WIRED — PR #60)
The tracer-based hit detection pipeline (`TracerSystem` → `DamageSystem` → `HealthSystem`) is now fully connected. All 5 wiring points fixed: `TracerTag` added to player and dummies, `weaponBoneMap` populated in entity factories, `weaponConfigMap` populated in main.ts from `weaponConfigs` registry, `colliderToHitbox` populated in `createHitboxes()`, and player entity now has hitbox sensor colliders. Note: `weaponBoneMap` and `weaponConfigMap` must also be updated when weapons are swapped at runtime (handled by `InventorySystem.equipWeapon()`).

### First-Person Viewmodel (IMPLEMENTED — PR #57, skeletal PR #68, animation PR #70, anchor fix #81)
`ViewmodelRenderer` (`src/rendering/ViewmodelRenderer.ts`) renders a procedural right arm + weapon in FPS mode using Two-pass Layer architecture: Layer 0 = world, Layer 1 = viewmodel. Separate `PerspectiveCamera` (FOV 70, near 0.01). Weapon swaps automatically via `onEquip` listener. `CameraController.setViewmodel()` toggles visibility on F5 camera mode switch. **Bone-driven skeletal arm** (PR #68): arm is built from a `THREE.Bone` hierarchy (`vm_upper_arm_R → vm_forearm_R → vm_hand_R → vm_weapon_attach`) with `THREE.SkinnedMesh` parts. `bones` record exposed with canonical names (without `vm_` prefix) for animation system use — keys match AnimationData.ts bone names. `weapon_attach` bone pre-rotated `Math.PI * 0.85` on X (angled slightly forward for natural grip). **Anchor convention** (#81): the shoulder bone (`vm_upper_arm_R`) is positioned at the group origin `(0, 0, 0)`, so the entire visible arm hangs DOWN into the viewport via negative-Y child offsets (forearm at `-UPPER_ARM_H`, hand at `-FOREARM_H` from forearm, etc.). `ARM_OFFSET = (0.25, -0.10, -0.4)` places the group origin (= shoulder anchor) slightly below the camera, so the arm enters the screen from the lower-right corner. Do NOT raise the shoulder above the group origin — that's the bug fixed in #81 (upper-arm box clipped into the top-third of the viewport). **Viewmodel animation** (PR #70): `ViewmodelAnimationSystem` (`src/rendering/ViewmodelAnimationSystem.ts`) drives bone poses based on `CombatStateComp` — per-weapon pose lookup via `getViewmodelPose()`, quaternion slerp crossfade blending (~80ms, matching AnimationSystem), `effectiveBlend = max(phaseBlend, crossfadeBlend)` pattern, idle sway (sinusoidal bob on hand_R + forearm_R z-axis). Runs in `update(dt)` after `animationSystem()`. Zero per-frame allocations.

### Character Controller / Hover Bug (BEING FIXED — issue #86)
Two architectural drifts cause characters to hover and WASD to feel broken:
1. **Origin convention drift**: `createPlayer.ts` creates a capsule whose origin is the **center**, but the mesh group's root bone is at the **feet**. `main.ts` syncs `meshGroup.position = ECS Position`, so the mesh's feet end up at the capsule's center → visible character floats by `CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS = 1.0m` above the ground. `SPAWN_HEIGHT = 1.1` is the capsule center, not the feet.
2. **Dummy has no rigid body**: `createDummy.ts` does not call `world.physicsWorld.createRigidBody()` — it only sets ECS `Position` and creates hitbox sensors. With no body and no ground contact, dummies float wherever `Position.y` is set (currently `SPAWN_HEIGHT = 1.1`).

**Resolution** (issue #86 plan): adopt feet-origin convention everywhere (see "Spatial Conventions" above), give dummies a fixed-body capsule collider, add a `spawnAtGround()` helper that raycasts down to place feet on terrain. Move mesh sync out of fixedUpdate into render with interpolation.

### Arena Authoring (Arena v1, #91)
Arenas are **code-authored** — pure TypeScript, no glTF or JSON map files. `createArena(world: GameWorld): ArenaSpec` builds Three.js meshes + matching Rapier static colliders (`RigidBodyType.Fixed` + `cuboid`) 1:1 with mesh extents. Lights live inside `createArena()` (not `World.ts`) — they're map data, not engine data. Returned `ArenaSpec` is stored on `GameWorld.arena` for systems (spawn, weapon-pickup, shopkeep AI) to query. See `docs/arena-v1.md` for v1 layout, spawn coordinates, lighting plan, and `weapon_pickup_safe_volume` rules. **Ground top surface MUST stay at `y = 0.1`** to keep `SPAWN_HEIGHT = 0.1 + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS` in `core/types.ts` correct.

### Shop Panel Scaffold (#100 — PR #140)
`ShopPanel` is a tab-switcher HTML overlay that mirrors `InventoryPanel` (backdrop, Escape, click-outside, pointer-lock release via `input.paused`). Two default tabs: a stub `Weapons (Gold)` tab (replaced by #96) and `PremiumShopTab` (USD). Tabs implement the `ShopTab` interface (`mount(container)` / `unmount()`) — the panel clears the body container before mounting the next tab; tab impls only need to clean up listeners. Real-money flows go through the **forward-compatible `PaymentProvider` interface** (`isAvailable()`, `start(item): Promise<PurchaseResult>`); the default `MockPaymentProvider` always reports unavailable, so Buy buttons render disabled with a "Coming soon" tooltip. When Stripe lands, replace `MockPaymentProvider` with `StripePaymentProvider` — `PremiumShopTab` works unchanged. No hotkey wired yet; #96 will hook this up to the shopkeep NPC. Dev console exposes `window.openShop()` / `window.closeShop()`. `_suppressClickToPlay` covers both `inventoryPanel.isOpen || shopPanel.isOpen`.

### Module-Level Singletons
`fsmRegistry`, `meshRegistry`, `hitboxColliderRegistry`, `weaponIdToName`, `inventoryRegistry`, `weaponModelFactories` are all module-level Maps/arrays/objects. Works for single-world but won't scale to multiple worlds.

## Gotchas
- **Rapier3D WASM must be initialized async** before creating the physics world — use `import RAPIER from '@dimforge/rapier3d-compat'` then `await RAPIER.init()`
- **bitECS uses ArrayBuffer-backed components** — component values are numbers only (no strings, no objects). Use lookup tables/maps for complex data.
- **Three.js `Clock.getDelta()`** should NOT be used for the fixed timestep — implement a custom accumulator pattern
- **Pointer Lock API** can only be requested from a user gesture (click) — cannot auto-lock on page load
- **Vite HMR** with Three.js requires careful disposal of scenes/renderers to avoid memory leaks on hot reload
- **Rapier debug renderer** needs `@dimforge/rapier3d-compat` not `@dimforge/rapier3d` for browser compatibility
- The deploy workflow (`.github/workflows/deploy-staging.yml`) expects a `Dockerfile` and maps port 3000 internally → 3010 externally
- **CombatSystem syncs both `CombatStateComponent` and `CombatStateComp`** — `computePhaseTotal()` derives phase duration. AnimationSystem reads from `CombatStateComp` (`phaseElapsed`, `phaseTotal`, `state`, `direction`).
- **`weaponIdToName` in CombatSystem.ts (line 28) is a hardcoded array** — when adding new weapons, update this array AND ensure the weapon's numeric index matches `CombatStateComponent.weaponId[eid]`
- **Pointer Lock must be released** when showing any UI overlay (inventory, menus) — call `document.exitPointerLock()`. Re-request on close via user gesture (click on canvas).
- **Side-table pattern** for non-numeric data: `meshRegistry` (Map<number, CharacterModelData>), `fsmRegistry` (Map<number, CombatFSM>), `hitboxColliderRegistry` — use the same pattern for inventory/equipment data
