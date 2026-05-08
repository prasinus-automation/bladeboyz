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
│   │   │   ├── InputSystem.ts   # Raw input → MovementIntent (the AI/network seam — #104)
│   │   │   ├── MovementSystem.ts # Consumes MovementIntent, drives Rapier kinematic character controller
│   │   │   ├── CombatSystem.ts
│   │   │   ├── InventorySystem.ts
│   │   │   ├── TracerSystem.ts
│   │   │   ├── HitboxSystem.ts
│   │   │   ├── StaminaSystem.ts
│   │   │   ├── HealthSystem.ts  # Damage application, death detection, respawn timer (#93)
│   │   │   ├── InteractionSystem.ts # Per-tick proximity check; caches nearest in-range interactable per player (#113)
│   │   │   ├── AnimationSystem.ts
│   │   │   └── ...
│   │   ├── entities/            # Entity factory/spawner functions
│   │   │   ├── createPlayer.ts  # Player factory: kinematic body + capsule (offset upward), MovementIntent component, Y resolved by spawnAtGround
│   │   │   ├── createDummy.ts   # Training dummy factory: fixed body + capsule (same offset as player), Y resolved by spawnAtGround
│   │   │   ├── createShopkeep.ts # Static non-combatant NPC (Position/Rotation/CharacterModel only) + shopkeepRegistry side-table (#113)
│   │   │   ├── createWeaponPickup.ts # Ground weapon pickup factory + remover (#109, foundation for #94)
│   │   │   └── ...
│   │   └── utils/
│   │       └── spawnAtGround.ts # Raycast-down feet-Y resolver used by all entity factories (#104)
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
│   │   ├── InputManager.ts      # Raw input capture, pointer lock, mouse delta tracking
│   │   ├── InputManager.types.ts # Target interface contract (issue #102 spec — see docs/input-pipeline.md)
│   │   └── keybinds.ts          # DEFAULT_KEYBINDS table (action → KeyboardEvent.code mapping)
│   ├── rendering/
│   │   ├── CameraController.ts  # FPS + debug third-person camera
│   │   ├── CharacterModel.ts    # Procedural low-poly character mesh + skeleton
│   │   ├── WeaponModels.ts      # Procedural weapon models (Mace, Dagger, Battleaxe) + factory registry
│   │   ├── ViewmodelRenderer.ts # First-person viewmodel (right arm + weapon, Layer 1, separate camera)
│   │   ├── ViewmodelAnimationSystem.ts # Viewmodel bone animation (reads CombatStateComp, per-weapon poses)
│   │   └── DebugRenderer.ts     # Wireframe, hitbox, physics debug drawing
│   ├── inventory/
│   │   ├── InventoryData.ts     # Legacy UI-only side-table (DEAD CODE — see "Two Disconnected Inventory Modules" below)
│   │   └── PickupRegistry.ts    # Side-table for ground weapon pickups: pickupRegistry Map<eid, PickupData> (#109)
│   ├── economy/
│   │   ├── Wallet.ts            # In-memory player gold balance + onGoldChange pubsub (#107)
│   │   └── Prices.ts            # weaponPrices side-table + getWeaponPrice() (#107)
│   ├── hud/
│   │   ├── HUD.ts               # HUD manager
│   │   ├── HealthBar.ts
│   │   ├── StaminaBar.ts
│   │   ├── DirectionIndicator.ts # Mordhau-style compass-rose crosshair overlay (attack/block direction)
│   │   ├── InventoryPanel.ts    # Tab inventory UI overlay (HTML/CSS, pointer lock toggle)
│   │   ├── DeathScreen.ts       # Full-screen death overlay + respawn countdown (#93)
│   │   ├── Killfeed.ts          # Top-right kill log, fades after 5s (#93)
│   │   ├── Scoreboard.ts        # Persistent K/D/Gold display (#93)
│   │   ├── GoldCounter.ts       # Top-right gold balance HUD, subscribes to Wallet (#107)
│   │   ├── WorldLabel.ts        # World-anchored HTML overlay — shopkeep nameplate + "Press [E] to shop" prompt (#113)
│   │   ├── DebugOverlay.ts      # FSM state, FPS counter
│   │   └── shop/                # Shop overlay scaffold (#100)
│   │       ├── ShopPanel.ts     # Tab-switcher overlay (mirrors InventoryPanel; backdrop, Escape, click-outside, pointer-lock release via input.paused)
│   │       ├── PremiumShopTab.ts # USD tab — empty-state by default; Buy buttons disabled when provider.isAvailable() === false
│   │       └── types.ts         # Currency, ShopItem, ShopTab, PurchaseResult, PaymentProvider, MockPaymentProvider (always reports unavailable)
│   └── utils/
│       └── math.ts              # Vector utilities, interpolation helpers
├── docs/
│   ├── MVP.md                                # Foundation rebuild roadmap (issue #85)
│   ├── animation-architecture.md             # Third-person animation rebuild spec (issue #110, parent #89)
│   ├── arena-v1.md                           # Arena v1 layout, spawns, lighting (issue #91)
│   ├── combat-fsm-v2.md                      # Combat FSM v2 architecture spec (issue #88)
│   ├── gold-currency.md                      # Gold currency design doc (issue #95)
│   ├── input-pipeline.md                     # Input pipeline architecture spec (issue #102)
│   ├── networking/                           # Multiplayer architecture spec set (parent #92)
│   │   ├── README.md                         # Index + read-order for the four-doc set
│   │   └── 01-transport-and-authority.md     # Transport, topology, tickrate, authority model (#116)
│   ├── spawn-death-respawn.md                # Spawn/death/respawn loop design (issue #93)
│   └── training-dummies-and-bots-spec.md     # Training dummies + warmup bots (issue #99)
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

### Input Pipeline
All keyboard / mouse / pointer-lock signals are owned by `InputManager`; gameplay systems read via a typed action-based API (`isActionDown`, `isActionJustPressed`, `getMouseDelta`). A three-state mode FSM (`Menu` / `Playing` / `OverlayOpen`) gates whether gameplay polls return live state — outside `Playing` they return false / 0. No system attaches its own raw `addEventListener('keydown')` (target state — current code still has scattered listeners that downstream tickets will migrate). Default keymap lives in `src/input/keybinds.ts`. Full spec: [`docs/input-pipeline.md`](docs/input-pipeline.md).

### Character Controller (SHIPPED — #104 / PR #150)
Movement is a Rapier `KinematicCharacterController` driven by `MovementSystem` in `fixedUpdate` at 60Hz. Player uses a `kinematicPositionBased` rigid body with a capsule collider; dummies use a `fixed` body with a capsule collider (static obstacle the player collides with). The controller provides slope handling (≤45° climb / ≥30° slide), autostep (max height 0.3m), and snap-to-ground (0.3m). Tuning constants live in `src/core/types.ts` (`MAX_SLOPE_CLIMB_ANGLE`, `MIN_SLOPE_SLIDE_ANGLE`, `AUTOSTEP_MAX_HEIGHT`, `AUTOSTEP_MIN_WIDTH`, `SNAP_TO_GROUND_DISTANCE`). Gravity is applied manually in MovementSystem (`MovementState.verticalVelocity`) because Rapier's solver does not apply forces to kinematic/fixed bodies.

**Input → MovementIntent → MovementSystem split** (the AI/network seam): raw input is no longer read inside `MovementSystem`. `InputSystem` (one fixed tick before MovementSystem) translates raw `InputManager` queries + camera yaw into a normalized world-space `MovementIntent { moveX, moveZ, sprint, crouch, jumpRequested }` component on each `Player` entity. `MovementSystem` only consumes `MovementIntent`. This is the seam where future AI controllers and network input deserializers plug in — they write `MovementIntent` directly without ever touching the keyboard. Sprint is policy-gated in `InputSystem` (Shift + W + !Crouch only); jump is edge-triggered on Space rising edge and cleared by `MovementSystem` after consumption.

**Tick contract**:
1. `inputSystem(dt)` → translates raw input into `MovementIntent` for each `Player`
2. `combatSystem()` → ticks FSMs, syncs combat state (and `CameraController.maxTurnRate`)
3. `movementSystem(dt)` → reads `MovementIntent`, applies acceleration ramp + gravity, calls `characterController.computeColliderMovement()`, calls `body.setNextKinematicTranslation()`, **reads back `body.translation()` post-write** to write ECS `Position` (avoids divergence when Rapier clamps the kinematic step), clears `MovementIntent.jumpRequested`. Transitionally mirrors `verticalVelocity` to legacy `Velocity.y` so AnimationSystem's airborne-pose detection keeps working until that system migrates.
4. `world.physicsWorld.step()` → Rapier integrates kinematic translations and runs sensor queries
5. Mesh sync runs in `render(alpha)` with `lerp(PreviousPosition, Position, alpha)` — NOT in fixedUpdate (avoids 60Hz position snapping at 144Hz vsync)

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
- Third-person + viewmodel animation conventions (bone graph, rest-pose Euler XYZ, hybrid keyframe-slerp + arc-swing strategy, layer ownership, tick contract): see `docs/animation-architecture.md` (parent #89). Rebuild PRs implement against that spec — do NOT re-derive from the existing `AnimationSystem.ts` / `ViewmodelAnimationSystem.ts`, which §10 of the spec calls out as buggy.

### Spatial Conventions (SHIPPED — #104 / PR #150)
- **ECS `Position` = entity feet position** (point of contact with ground). The character mesh's root bone is at the feet (`y=0` in local space), so `meshGroup.position = (Position.x, Position.y, Position.z)` is a direct copy with NO offset.
- **Capsule collider** is offset upward inside the rigid body via `ColliderDesc.capsule(...).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0)` so the capsule's bottom hemisphere sits at the body origin (= feet). With `R=0.3, H=0.7` the offset is `(0, 1.0, 0)`. This is enforced by tests in `createPlayer.test.ts` and `createDummy.test.ts`.
- **Forward = -Z** (Three.js convention). Yaw=0 looks down -Z. `moveX = strafe*cos(yaw) - forward*sin(yaw); moveZ = -strafe*sin(yaw) - forward*cos(yaw)`. The yaw rotation lives in `InputSystem`, not `MovementSystem`.
- **Spawn**: always use `spawnAtGround(world, x, z)` from `src/ecs/utils/spawnAtGround.ts`. It raycasts down from `(x, 50, z)` and returns `hit.toi + CHARACTER_CONTROLLER_OFFSET`, falling back to `GROUND_TOP_Y + offset` when the raycast misses or the host environment lacks Rapier (tests). Never hard-code Y in spawn-position arrays. `createPlayer` and `createDummy` both use it; `createShopkeep` still uses the deprecated `SPAWN_HEIGHT` default and is a follow-up cleanup.
- **Ground**: arena ground is a fixed cuboid centered at y=0 with half-height 0.1, so its top surface is at **y = 0.1 = `GROUND_TOP_Y`** (exported from `core/types.ts`). Visual ground plane sits at y=0 (mid-cuboid).
- **Constants**: `GROUND_TOP_Y` (0.1), `CHARACTER_CONTROLLER_OFFSET` (0.02), `CAPSULE_HALF_HEIGHT` (0.7), `CAPSULE_RADIUS` (0.3) all live in `core/types.ts`. `SPAWN_HEIGHT` is a **deprecated alias of `GROUND_TOP_Y`** kept for one cycle — its semantics changed from capsule-center (1.1) to feet (0.1). New code should use `spawnAtGround()` or `GROUND_TOP_Y` directly.
- This convention applies to **all** characters (player, dummies, shopkeep, future NPCs). Entity factories must not invent their own offset.

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

### Character Controller / Hover Bug (RESOLVED — #104 / PR #150)
The two architectural drifts (player capsule origin = center vs. mesh root = feet, dummy with no rigid body) are fixed in PR #150. Player and dummy capsule colliders are now offset upward inside their bodies (`setTranslation(0, R+H, 0)`) so body origin = feet; dummies have a `RigidBodyType.Fixed` capsule body so the player can collide with them; `spawnAtGround(world, x, z)` resolves Y by raycasting down from y=50; mesh sync moved from `fixedUpdate` to `render(alpha)` with `lerp(PreviousPosition, Position, alpha)` so motion stays smooth at high framerates. Tests in `createPlayer.test.ts`, `createDummy.test.ts`, and `spawnAtGround.test.ts` pin all of these invariants. Follow-up: `createShopkeep` should also call `spawnAtGround` rather than defaulting to the deprecated `SPAWN_HEIGHT` alias.

### Arena Authoring (Arena v1, #91)
Arenas are **code-authored** — pure TypeScript, no glTF or JSON map files. `createArena(world: GameWorld): ArenaSpec` builds Three.js meshes + matching Rapier static colliders (`RigidBodyType.Fixed` + `cuboid`) 1:1 with mesh extents. Lights live inside `createArena()` (not `World.ts`) — they're map data, not engine data. Returned `ArenaSpec` is stored on `GameWorld.arena` for systems (spawn, weapon-pickup, shopkeep AI) to query. See `docs/arena-v1.md` for v1 layout, spawn coordinates, lighting plan, and `weapon_pickup_safe_volume` rules. **Ground top surface MUST stay at `y = 0.1`** because that's `GROUND_TOP_Y` in `core/types.ts` — both `spawnAtGround`'s fallback path and the feet-origin convention assume it.

### Shop Panel Scaffold (#100 — PR #140)
`ShopPanel` is a tab-switcher HTML overlay that mirrors `InventoryPanel` (backdrop, Escape, click-outside, pointer-lock release via `input.paused`). Two default tabs: a stub `Weapons (Gold)` tab (replaced by #96) and `PremiumShopTab` (USD). Tabs implement the `ShopTab` interface (`mount(container)` / `unmount()`) — the panel clears the body container before mounting the next tab; tab impls only need to clean up listeners. Real-money flows go through the **forward-compatible `PaymentProvider` interface** (`isAvailable()`, `start(item): Promise<PurchaseResult>`); the default `MockPaymentProvider` always reports unavailable, so Buy buttons render disabled with a "Coming soon" tooltip. When Stripe lands, replace `MockPaymentProvider` with `StripePaymentProvider` — `PremiumShopTab` works unchanged. No hotkey wired yet; #96 will hook this up to the shopkeep NPC. Dev console exposes `window.openShop()` / `window.closeShop()`. `_suppressClickToPlay` covers both `inventoryPanel.isOpen || shopPanel.isOpen`.

### Economy Foundation (#107 — PR #142)
Minimal scaffolding for the shop feature, deliberately scoped narrower than the full Gold currency design (#95). Three pieces:
- **`src/economy/Wallet.ts`** — module-level gold balance (default `200`). API: `getGold()`, `addGold(amount)` (ignores ≤0), `spendGold(amount)` (returns `false` and does NOT deduct on insufficient funds; no subscriber notify on failure), `setGold(amount)` (clamps negatives to 0), `onGoldChange(cb): () => void` (returns unsubscribe fn — pattern matches `InventorySystem.onEquip` but with cleanup ergonomics for HUD `dispose()`), `resetWallet()` (test helper). Pure data + pubsub, no DOM/Three.js/ECS.
- **`src/economy/Prices.ts`** — `weaponPrices` side-table (`Dagger 0, Mace 100, Longsword 150, Battleaxe 200`) + `getWeaponPrice(name)` returning `undefined` for unknown weapons. Kept separate from `WeaponConfig` so weapon configs stay pure-combat data. **When adding a new weapon, also add a price entry** — missing entries treat the weapon as not-for-sale.
- **`src/hud/GoldCounter.ts`** — top-right HUD div (`top: 48px right: 16px`, z-index 10) stacking below camera-mode/FPS labels and below modal overlays (200+). Subscribes to `Wallet` in constructor, unsubscribes in `dispose()`, brief color pulse on change. Owned by `HUD.ts`.
- **Starter inventory** is now `['Dagger']` only (was all four weapons). Mace/Longsword/Battleaxe must be acquired through the shopkeep — `initInventory(playerEid, ['Dagger'], 'Dagger', 'Dagger')` in `main.ts`. The 4th arg is the **permanent `starterWeapon`** (added in #109 / PR #151) — the weapon that won't be dropped on death (#94). When omitted it defaults to `equippedWeapon`; pass `null` explicitly for "no protected starter". Note: this still contradicts the "default starter weapon is **Longsword**" line in the Spawn/Death/Respawn section above; the respawn-default behavior should be reconciled with the starter inventory in a future PR (the player can't currently respawn with a weapon they don't own).
- Out of scope here (belongs to #95): earning gold from kills/time, persistence (localStorage/server), negative balance/debt.

### Shopkeep NPC + Interaction Pipeline (#113 — PR #147)
Three pieces ship the proximity-interact loop:
- **`createShopkeep(world, x, y, z, opts?)`** — non-combatant entity factory. Adds **only** `Position`, `Rotation`, `CharacterModel` (no `Velocity`, `Health`, `Stamina`, `Hitboxes`, `CombatStateComp`, no Rapier body). Verified via `hasComponent` in tests — shopkeeps are deliberately not hittable. Body color `0xddaa44` (gold) distinguishes from dummies (red) / player (blue). Faces toward origin via `Rotation.y = atan2(-x, -z)`. String `name` lives in module-level **`shopkeepRegistry: Map<eid, {name, interactRadius}>`** side-table (bitECS components are TypedArrays). One spawned at `(8, SPAWN_HEIGHT, 8)` on game start.
- **`InteractionSystem`** — ticks per fixedUpdate (called from main loop after `tickDummyHealthReset`), iterates `shopkeepRegistry` and computes 3D Euclidean distance from player Position. Caches the nearest in-range eid in module-level `nearbyByPlayer: Map<eid, eid|null>`. API: `interactionSystem(playerEid)` to tick, `getNearbyInteractable(playerEid)` for consumers, `clearInteractionCache(eid?)` for tests/cleanup. **Distance check, not a Rapier sensor** — single shopkeep makes per-tick distance ~5ns; switch to a sensor approach if interactable count grows beyond ~10.
- **`WorldLabel` HUD class** — world-anchored HTML overlay (`#world-label-container`, fixed/pointer-events:none/z-index 14), updated each render frame. Mirrors `DummyHealthBar.ts`'s projection pattern: `Vector3.project(camera)` → NDC → pixel coords; hides when `proj.z > 1` (behind camera). Renders **two divs per shopkeep**: persistent gold nameplate at head height (`+1.6m`) and a conditional "Press [E] to shop" prompt at `+1.2m` shown only when `nearbyInteractableEid === eid`. Single reused `Vector3` — zero per-frame allocations. Auto-removes labels for shopkeeps deleted from `shopkeepRegistry`.
- **KeyE wiring**: `main.ts` `keydown` switch dispatches `KeyE` → bails on `input.paused` (so E during inventory/shop overlay is a no-op) → calls `getNearbyInteractable(playerEid)` → if non-null, calls a local `openShop(eid)` stub (logs + `showNotification('Shop opened (UI placeholder)')`). **The stub deliberately does not call `shopPanel.open()`** — wiring this to the real shop overlay (already shipped in #100/#140) is a follow-up so #113 could land in parallel; the README "Interaction" section calls this out.

### Weapon Pickup Foundation (#109 — PR #151)
First slice of parent #94 (drop-on-death / pickup / despawn). Foundation only — no behavior yet. Three pieces:
- **`WeaponPickup` component** (`src/ecs/components.ts`) — numeric-only per bitECS constraint: `weaponId: ui8` (index into `weaponIdToName`, used for networking-friendly serialization once that lands), `spawnTick: ui32`, `despawnTick: ui32`. The string `weaponName` and Three.js refs live in the side-table.
- **`pickupRegistry`** (`src/inventory/PickupRegistry.ts`) — module-level `Map<eid, PickupData>` mirroring `meshRegistry` / `fsmRegistry` / `shopkeepRegistry`. `PickupData = { weaponName: string, group: THREE.Group, materials: THREE.Material[] }`. **Materials are cached at spawn time** so #B's blink/fade pass in the last 5s of life doesn't re-traverse every frame. `resetPickupRegistry()` is a test helper, not for game code.
- **`createWeaponPickup(world, args)` / `removeWeaponPickup(world, eid)`** (`src/ecs/entities/createWeaponPickup.ts`) — factory + remover, mirror of `removeDummy` / `removeShopkeep`. Resolves `weaponId` via `weaponIdToName.indexOf` (falls back to `0` when name is unknown — `pickupRegistry.weaponName` is the source of truth). Mesh is built via a local `createGroundPickupModel` stub that calls `weaponModelFactories[name]()` and lays the group flat (`rotation.x = -π/2`); **#B replaces this stub with a real implementation in `WeaponModels.ts`** with weapon-specific orientation tuning + spin animation hooks. `removeWeaponPickup` traverses the group disposing geometries/materials, removes from scene, deletes from registry, then `removeEntity`. Safe to call with unknown eid.
- **`InventoryData.starterWeapon`** — new `string | null` field on the runtime `InventoryData` (`src/ecs/systems/InventorySystem.ts`, **NOT** the dead-code `src/inventory/InventoryData.ts`). `initInventory(eid, weapons, equippedWeapon, starterWeapon?)` — when omitted defaults to `equippedWeapon` (backward compat with all existing callsites), pass `null` explicitly for "no protected starter". `#A2`'s drop-on-death system reads this to skip dropping the starter (otherwise the floor floods with daggers).
- **Death-event seam**: `main.ts` now destructures `{ died, respawned }` from `healthSystemTick(world.ecs)` and leaves a `TODO(#A2): weaponPickupSystem(world, currentTick, died, ...)` placeholder. Foundation only — no system call wired.
- **Out of scope** (#A2): drop-on-death logic, proximity pickup check, KeyE wiring, despawn-timer system. **Out of scope** (#B): ground-flat orientation polish per weapon, spin animation, blink/fade rendering, HUD prompt, README controls update.

### Module-Level Singletons
`fsmRegistry`, `meshRegistry`, `hitboxColliderRegistry`, `weaponIdToName`, `inventoryRegistry`, `weaponModelFactories`, `Wallet.goldBalance`, `shopkeepRegistry`, `InteractionSystem.nearbyByPlayer`, `pickupRegistry`, `MovementSystem.bodyByEid` / `colliderByEid` / `movementTick`, `InputSystem.prevJumpKeyDown` are all module-level Maps/arrays/scalars. Works for single-world but won't scale to multiple worlds. The `prevJumpKeyDown` edge-trigger state is the one that will need to become per-controller when multiplayer lands.

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
- **`SPAWN_HEIGHT` is now a deprecated alias of `GROUND_TOP_Y` (= 0.1)** — semantics changed from capsule-center (1.1) to feet (0.1) in PR #150. Existing call sites still compile but new code should use `spawnAtGround()` for spawn Y or `GROUND_TOP_Y` for the literal.
- **`MovementIntent` is the AI/network seam** — `MovementSystem` no longer reads `InputManager`. To make an entity move, write to `MovementIntent { moveX, moveZ, sprint, crouch, jumpRequested }`. `jumpRequested` is edge-triggered (cleared by `MovementSystem` after consumption). For player input, `InputSystem` does this each fixed tick. AI controllers / network deserializers will use the same component.
