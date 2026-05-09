# AGENTS.md — BladeBoyz Project Context

## Overview
BladeBoyz is a browser-based multiplayer melee combat game built with Three.js. Ultra-low-poly BattleBit-style aesthetic with Mordhau/Chivalry directional combat mechanics. Currently in scaffolding phase — single player, **Arena v1** test environment, no networking yet.

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
│   │   ├── tickCounter.ts       # Module-level fixed-tick counter (advanceFixedTick / getCurrentFixedTick) — used for tick-stamped events like HitReactComp.spawnedAtTick (#120)
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
│   │   │   ├── HitReactSystem.ts # Clears expired HitReactComp entries (active=1 → 0 once tick >= spawnedAtTick + durationTicks) (#120)
│   │   │   ├── processDeaths.ts # Death-cleanup hook: emits DeathEvent, increments Score, resets FSM, zeros Velocity, calls dropEquippedWeapon stub (#130)
│   │   │   ├── processRespawns.ts # Respawn-cleanup hook: picks spawn point, teleports Position/PreviousPosition/Rotation + Rapier body, restores HP/Stamina, equips default starter, removes DeadTag/RespawnPending, emits RespawnEvent (#134)
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
│   │   ├── EventBus.ts          # In-process pub/sub: queue + flush for DamageDealt/DeathEvent/RespawnEvent/WeaponEquipped — flushed once per fixedUpdate (#130)
│   │   └── types.ts             # Event payload types matching docs/spawn-death-respawn.md (#130)
│   ├── world/
│   │   └── SpawnPoints.ts       # Spawn-point registry + selectSpawnPoint() weighted-random selector. Arena owns ground truth (createArena clears + registers); seedPlaceholderSpawnPoints() retained for unit tests only (#93, #134, #112)
│   ├── animation/
│   │   ├── AnimationData.ts     # Third-person combat animation poses (per-direction, per-phase)
│   │   └── ViewmodelAnimationData.ts # First-person viewmodel poses — per-weapon × per-direction × per-phase
│   ├── arena/
│   │   ├── types.ts             # ArenaSpec, SpawnPoint, ShopkeepStallSpec, Volume3D interfaces
│   │   └── createArena.ts       # Code-authored Arena v1: lights (#117) + 9 static props + 6 spawn points + ArenaSpec (#112)
│   ├── combat/
│   │   ├── CombatFSM.ts         # Combat state machine definition
│   │   ├── states.ts            # State enum and transition logic
│   │   └── directions.ts        # Unified `Direction` enum + `detectDirection()` (rolling-buffer sampling, #139)
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
│   │   ├── Prices.ts            # weaponPrices side-table + getWeaponPrice() (#107)
│   │   └── PurchaseFlow.ts      # Atomic validate-then-mutate purchaseWeapon API (#123)
│   ├── hud/
│   │   ├── HUD.ts               # HUD manager
│   │   ├── HealthBar.ts
│   │   ├── StaminaBar.ts
│   │   ├── DirectionIndicator.ts # Mordhau-style compass-rose crosshair overlay (attack/block direction)
│   │   ├── InventoryPanel.ts    # Tab inventory UI overlay (HTML/CSS, pointer lock toggle)
│   │   ├── ShopPanel.ts         # Shopkeep overlay — weapon list + Buy buttons + live gold (#123)
│   │   ├── DeathScreen.ts       # Full-screen death overlay + respawn countdown (#93)
│   │   ├── Killfeed.ts          # Top-right kill log, fades after 5s (#93)
│   │   ├── Scoreboard.ts        # Persistent K/D/Gold display (#93)
│   │   ├── GoldCounter.ts       # Top-right gold balance HUD, subscribes to Wallet (#107)
│   │   ├── WorldLabel.ts        # World-anchored HTML overlay — shopkeep nameplate + "Press [E] to shop" prompt (#113)
│   │   ├── DebugOverlay.ts      # FSM state, FPS counter
│   │   ├── ViewmodelDebugOverlay.ts # Bottom-left bone/state readout for --debug-viewmodel toggle (#122)
│   │   └── shop/                # Forward-compat USD payment scaffolding (#100, currently unwired)
│   │       ├── ShopPanel.ts     # Legacy tab-switcher (orphaned by #123 — see Shop UI section)
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
│   │   ├── 01-transport-and-authority.md     # Transport, topology, tickrate, authority model (#116)
│   │   ├── 02-replication-and-protocol.md    # Replication model, snapshot/delta encoding, full message catalog, msgpackr (#126)
│   │   └── 03-sequences-and-anticheat.md     # End-to-end sequence diagrams (join/move/swing/block/reconnect) + per-message anti-cheat rules + log levels (#133)
│   ├── spawn-death-respawn.md                # Spawn/death/respawn loop design (issue #93)
│   ├── training-dummies-and-bots-spec.md     # Training dummies + warmup bots (issue #99)
│   └── viewmodel-architecture.md             # FP viewmodel rebuild spec (issue #115, parent #90)
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
Each combatant has a per-entity FSM. **FSM v2 is now shipped** — 7 states: `Idle (0)`, `Windup (1)`, `Release (2)`, `Recovery (3)`, `Blocking (4)`, `Parry (5)`, `HitStun (6)`. Transitions are data-driven from weapon config. **Turncap wiring** (PR #78): `CombatSystem` syncs `CameraController.maxTurnRate` from `FSM.getCurrentTurncap()` every fixed tick. Camera turn rate is capped during Windup/Release/Recovery per weapon config turncap values and during HitStun per `weapon.turncap.hitStun` (0.005 rad/tick ≈ 17°/s — added in #131); uncapped (Infinity) during Idle/Blocking/Parry.

**FSM v2 — Schema migration LANDED (#131 / PR #157)**: data + types only, no FSM logic changes yet. `WeaponConfig` gained three new fields — `parryRecovery: number` (ticks the Parry pose locks before returning to Blocking), `blockBreakStunTicks: number` (stagger when block breaks from stamina ≤ 0; per-weapon replacement for the v1 module-level `BLOCK_BREAK_STUN_TICKS = 30` constant — that constant was DROPPED entirely by #135), `turncap.hitStun: number` (cap during HitStun, 0.005 rad/tick ≈ 17°/s for all weapons). `staminaCost.feint` is now **optional** — FSM v2 removes the Feint state but the field stays optional so a future re-add doesn't need another migration. `AttackDirection` enum trimmed: `Underhand = 3` removed, `Stab` renumbered 4 → 3 so values stay contiguous (0..3). `detectAttackDirection` folds vertical-down mouse swipes into `Stab`. **Wire-format note** (relevant when networking lands per `docs/networking/02-replication-and-protocol.md`): re-adding `Underhand` post-MVP MUST give it a new numeric slot (e.g. 4) — never reuse 3, since 3 now means `Stab` on the wire. Cascading cleanups in this PR: `AnimationData` and `ViewmodelAnimationData` lost their `Underhand` pose entries; `DamageSystem.doesBlockCounter` lost the unreachable `Underhand → Bottom` branch (`BlockDirection.Bottom` was preserved as a defensive choice at the time; #139 dropped both `BlockDirection.Bottom` and `BlockDirection` itself); `DirectionIndicator`/`HUD` used a renamed `ATK_STAB = 3` constant (since superseded by `Direction.Stab` in #139); `StaminaSystem` has a `?? 0` fallback for the now-optional `staminaCost.feint`. Per-weapon FSM v2 values: Longsword (parryRecovery=12, blockBreak=30), Mace (14, 36), Dagger (8, 24), Battleaxe (16, 42); all four share `turncap.hitStun = 0.005`. **Note**: the `AttackDirection` enum referenced above was retired entirely in #139 in favor of the unified `Direction` enum — see "FSM v2 — Direction unification LANDED" below.

**FSM v2 — Core LANDED (#135 / PR #160)**: the 11-state v1 FSM has been rewritten to the 7-state v2 model in `docs/combat-fsm-v2.md`. State enum collapsed: `Block → Blocking`; `ParryWindow` folded into `Blocking` and exposed via the new **`CombatFSM.parryActive` getter** (true while `phaseElapsed ≤ weapon.parryWindow` AND the entry was an RMB just-press, not held-from-Parry — that's the cheese-prevention from §3 of the spec); `Riposte`, `Feint`, `Clash`, `Stunned` dropped entirely. `HitStun` absorbs `Stunned` with three internal modes (Normal / Parried / BlockBreak) picking `hitStunTicks` / `parryStunTicks` / `blockBreakStunTicks` from #131's per-weapon schema. Numeric values 0..6 are the wire format — never repurpose them when re-adding cut states. **Funneled-writes invariant (the big correctness fix)**: every external state change goes through `transition(input, payload?)` and `_state` is only ever written inside the central `_transitionTo()` helper — enforced by a static-analysis test that grep-checks the source file via Vite `?raw` import. New `CombatInput` surface: `Attack`, `Block`, `ReleaseBlock`, `HitReceived`, `BlockedHit`, `ParryTriggered`, `WasParried`, `BlockBreak`. RMB-during-Windup is no longer a Feint — it's just rejected by `canTransition(Block)`. Funneled-write fixes in this PR: `StaminaSystem`'s direct `CombatStateComponent.state = Stunned` write at lines 99-100 now dispatches `CombatInput.BlockBreak` to the FSM (with no-FSM fallback reading `weapon.blockBreakStunTicks` for entities that lack a registered FSM); `DamageSystem`'s parry-vs-block branch reads `fsm.parryActive` instead of comparing against the deleted `ParryWindow` state. New FSM getters published on `CombatStateComp` for animation: `parryActive`, `isComboRecovery`, `blockingEntryWasJustPress`, unified `direction`. `BLOCK_BREAK_STUN_TICKS` constant was deleted from `combat/states.ts` (per-weapon now); README's Parry section was rewritten to reflect that Riposte is gone and the agility advantage is the uncapped Parry turncap. **Still deferred** to follow-up issues: route the remaining `DamageSystem` direct writes (`WasParried → HitStun` on attacker, `BlockedHit → Recovery` on attacker) through FSM input dispatch (issue E); unify `CombatStateComponent` + `CombatStateComp` into a single `CombatState` component (issue C / #136).

**FSM v2 — Direction unification LANDED (#139 / PR #163)**: the v1 split `AttackDirection` (5 values) and `BlockDirection` (4 values) collapsed into a single shared `Direction` enum with **4 values: `Overhead = 0`, `Left = 1`, `Right = 2`, `Stab = 3`**. These numeric values are the wire format for the future networking protocol (#92) — re-adding `Underhand` post-MVP MUST give it a new slot (e.g. 4); never reuse 3 (now `Stab`) and never reorder the existing four. Behavioural changes per `docs/combat-fsm-v2.md` §4: (1) `Block(dir)` defends an incoming attack with the **same** `dir` (v1's opposed-pair scheme — Left attack countered by Right block — is gone); (2) `Stab` is blocked **only** by `Block(Stab)` (v1's "any direction blocks Stab" rule is gone); (3) `BlockDirection.Bottom` is dropped — the Bottom wedge is gone from `DirectionIndicator`; the v1 Bottom block-pose data is reused as the new `Direction.Stab` block pose (forward-thrust parry stance); (4) no-movement detection now returns `Stab` for both attacks and blocks (v1 had a Top fallback for blocks). New `src/combat/directions.ts`: `detectDirection(inputManager, config?)` collapses `detectAttackDirection` + `detectBlockDirection` (the algorithms were already identical), pure helper `detectDirectionFromDeltas(dx, dy)` is the unit-test seam, `forceStab()` returns the no-input default. **Direction sampling switched from single-frame `getMouseDelta()` to the rolling 100ms `getAverageDelta()` buffer** — quick post-click flicks no longer steal the swing direction. `CombatFSM`'s `_attackDirection` + `_blockDirection` collapsed to `_direction` (default `Direction.Overhead`); `attackDirection`/`blockDirection` getters kept as backward-compat aliases of the unified `direction` (both ECS components retain their separate `attackDirection`/`blockDirection` slots for now — issue C / #136 finishes that). `CombatSystem` calls `detectDirection(input)` directly (the old `getMouseDeltasForDirection` adapter is gone) and writes the same value to both ECS direction slots and `CombatStateComp.direction`. `DamageSystem.doesBlockCounter(a, b) = a === b`. `DirectionIndicator` reads from `CombatStateComp.direction`, renders 3 wedges (Overhead/Left/Right) + a center ring (Stab); the unified enum's numeric values no longer line up with the arrow-array indices, so a new `arrowIndexForDirection` lookup bridges them. `HUD` collapsed `ATTACK_DIR_NAMES` + `BLOCK_DIR_NAMES` into a single `DIR_NAMES` table. `events/types.ts` `DamageDealtPayload.attackDirection: Direction`. `createDummy` cycle order is `[Overhead, Stab, Left, Right]` (preserves v1 cycle visual ordering — Top→Overhead, Bottom→Stab). Animation data + viewmodel data keys swapped to `Direction.X`; the block-pose `Bottom` slot is reused for `Direction.Stab` (1:1 visual, no new pose authoring). `main.ts` cleanup: removed the broken `CombatState.Block || CombatState.ParryWindow` references left behind by #122/#161 after #135/#160 renamed those states — the unified Direction enum naturally retires the dual-table direction lookup, so the comparison was deleted along with the now-unused `CombatState` import. **Still deferred**: continuous direction sampling during Windup beyond the morph re-sample (post-MVP); issue C / #136's `CombatStateComp` + `CombatStateComponent` unification; issue E's remaining DamageSystem direct writes.

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
- See `docs/viewmodel-architecture.md` for the full FP viewmodel design (two-pass render, anchor convention, bone write-permissions, per-weapon grip data, idle sway / locomotion bob / aim-sway-lag math, weapon-cache pattern). Sub-issues #122 / #125 / #129 implement against it.

### Spatial Conventions (SHIPPED — #104 / PR #150)
- **ECS `Position` = entity feet position** (point of contact with ground). The character mesh's root bone is at the feet (`y=0` in local space), so `meshGroup.position = (Position.x, Position.y, Position.z)` is a direct copy with NO offset.
- **Capsule collider** is offset upward inside the rigid body via `ColliderDesc.capsule(...).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0)` so the capsule's bottom hemisphere sits at the body origin (= feet). With `R=0.3, H=0.7` the offset is `(0, 1.0, 0)`. This is enforced by tests in `createPlayer.test.ts` and `createDummy.test.ts`.
- **Forward = -Z** (Three.js convention). Yaw=0 looks down -Z. `moveX = strafe*cos(yaw) - forward*sin(yaw); moveZ = -strafe*sin(yaw) - forward*cos(yaw)`. The yaw rotation lives in `InputSystem`, not `MovementSystem`.
- **Spawn**: always use `spawnAtGround(world, x, z)` from `src/ecs/utils/spawnAtGround.ts`. It raycasts down from `(x, 50, z)` and returns `hit.toi + CHARACTER_CONTROLLER_OFFSET`, falling back to `GROUND_TOP_Y + offset` when the raycast misses or the host environment lacks Rapier (tests). Never hard-code Y in spawn-position arrays. `createPlayer` and `createDummy` both use it; `createShopkeep` still uses the deprecated `SPAWN_HEIGHT` default and is a follow-up cleanup.
- **Ground**: arena ground is a fixed cuboid centered at y=0 with half-height 0.1, so its top surface is at **y = 0.1 = `GROUND_TOP_Y`** (exported from `core/types.ts`). Visual ground plane sits at y=0 (mid-cuboid).
- **Constants**: `GROUND_TOP_Y` (0.1), `CHARACTER_CONTROLLER_OFFSET` (0.02), `CAPSULE_HALF_HEIGHT` (0.7), `CAPSULE_RADIUS` (0.3) all live in `core/types.ts`. `SPAWN_HEIGHT` is a **deprecated alias of `GROUND_TOP_Y`** kept for one cycle — its semantics changed from capsule-center (1.1) to feet (0.1). New code should use `spawnAtGround()` or `GROUND_TOP_Y` directly.
- This convention applies to **all** characters (player, dummies, shopkeep, future NPCs). Entity factories must not invent their own offset.

## Known Issues / Architectural Debt

### Two Combat State Components (SYNCED — issue C / #136 unifies them)
Two ECS components track combat state: `CombatStateComponent` (authoritative — synced from FSM by CombatSystem, used by HUD/StaminaSystem/DamageSystem) and `CombatStateComp` (animation mirror — has `phaseElapsed`/`phaseTotal`/`phaseT`, used by AnimationSystem). **Both are synced by CombatSystem** after FSM tick (fixed in PR #36). Phase math (`getPhaseTotal()` / `getPhaseT()`) lives on `CombatFSM` — `CombatSystem` mirrors those values onto `CombatStateComp` each tick. **Issue C / #136 collapses these into a single `CombatState` component** — see `docs/combat-fsm-v2.md` §9.

### Direct State Writes Bypass the FSM (PARTIALLY RESOLVED by #135 — issue E finishes it)
`StaminaSystem`'s direct `CombatStateComponent.state = Stunned` write was fixed by #135 — it now dispatches `CombatInput.BlockBreak` to the FSM. `DamageSystem` still has direct writes for two branches (`WasParried → HitStun` on attacker, `BlockedHit → Recovery` on attacker) — these are issue E's territory. The funneled-writes invariant (only `_transitionTo()` writes `_state`) is enforced by a static-analysis test on `CombatFSM.ts`, but consumers can still bypass by writing to the ECS component directly; issue E closes the last two bypasses.

### Two Disconnected Inventory Modules (PARTIALLY RESOLVED — `InventoryData.ts` is dead code)
`src/inventory/InventoryData.ts` is a lightweight UI-only side-table that was originally consumed by `InventoryPanel.ts`. `src/ecs/systems/InventorySystem.ts` is the real system with full equip logic (3D model swap, FSM update, ECS sync). **`InventoryPanel.ts` now correctly imports from `InventorySystem.ts`** (line 11 — `getInventory`, `equipWeapon`). `InventoryData.ts` is unused dead code referenced only by its own tests; remove in a cleanup PR.

### Damage Pipeline (WIRED — PR #60)
The tracer-based hit detection pipeline (`TracerSystem` → `DamageSystem` → `HealthSystem`) is now fully connected. All 5 wiring points fixed: `TracerTag` added to player and dummies, `weaponBoneMap` populated in entity factories, `weaponConfigMap` populated in main.ts from `weaponConfigs` registry, `colliderToHitbox` populated in `createHitboxes()`, and player entity now has hitbox sensor colliders. Note: `weaponBoneMap` and `weaponConfigMap` must also be updated when weapons are swapped at runtime (handled by `InventorySystem.equipWeapon()`).

### First-Person Viewmodel (IMPLEMENTED — PR #57, skeletal PR #68, animation PR #70, anchor fix #81, grip data + cache #125)
`ViewmodelRenderer` (`src/rendering/ViewmodelRenderer.ts`) renders a procedural right arm + weapon in FPS mode using Two-pass Layer architecture: Layer 0 = world, Layer 1 = viewmodel. Separate `PerspectiveCamera` (FOV 70, near 0.01). Weapon swaps automatically via `onEquip` listener. `CameraController.setViewmodel()` toggles visibility on F5 camera mode switch. **Bone-driven skeletal arm** (PR #68): arm is built from a `THREE.Bone` hierarchy (`vm_upper_arm_R → vm_forearm_R → vm_hand_R → vm_weapon_attach`) with `THREE.SkinnedMesh` parts. `bones` record exposed with canonical names (without `vm_` prefix) for animation system use — keys match AnimationData.ts bone names. **Per-weapon grip data** (#125): `vm_weapon_attach` is no longer pre-rotated at construction. Each `WeaponModelResult` (in `src/rendering/CharacterModel.ts`) optionally carries `gripOffset: Vector3` and `gripRotation: Euler` fields; `swapWeapon(name)` copies those onto `vm_weapon_attach.position` / `.rotation`, so each weapon sits in the hand at its own tuned angle (Longsword `(π·0.85, 0, 0)` preserves the legacy value, Mace `(π·0.75, 0, -0.15)`, Dagger `(π·0.90, 0, 0)` + Z offset `-0.02`, Battleaxe `(π·0.80, 0, 0.1)` + Y offset `-0.05`). Weapons that omit grip fields fall back to `(0, 0, 0)` position and the legacy `(π·0.85, 0, 0)` rotation. **Pre-warmed model cache** (#125): the constructor calls each registered factory exactly once and stashes the `WeaponModelResult` in a `weaponModelCache: Map<string, WeaponModelResult>`. After init, `swapWeapon` is a re-parent + grip apply with **zero allocations** — the same cached `THREE.Group` instance is reused across an arbitrary number of A→B→A→B swaps. `dispose()` walks the cache and disposes every cached weapon's geometries + materials. **Single-source-of-truth registry** (#125 cleanup): `weaponFactories` defaults to importing `weaponModelFactories` from `src/rendering/WeaponModels.ts`, so `main.ts` no longer inlines the factory list. The same registry feeds InventorySystem (3rd-person model swap on equip) via a single `Object.entries(weaponModelFactories)` loop. **Anchor convention** (#81): the shoulder bone (`vm_upper_arm_R`) is positioned at the group origin `(0, 0, 0)`, so the entire visible arm hangs DOWN into the viewport via negative-Y child offsets (forearm at `-UPPER_ARM_H`, hand at `-FOREARM_H` from forearm, etc.). `ARM_OFFSET = (0.25, -0.10, -0.4)` places the group origin (= shoulder anchor) slightly below the camera, so the arm enters the screen from the lower-right corner. Do NOT raise the shoulder above the group origin — that's the bug fixed in #81 (upper-arm box clipped into the top-third of the viewport). **Viewmodel animation** (PR #70): `ViewmodelAnimationSystem` (`src/rendering/ViewmodelAnimationSystem.ts`) drives bone poses based on `CombatStateComp` — per-weapon pose lookup via `getViewmodelPose()`, quaternion slerp crossfade blending (~80ms, matching AnimationSystem), `effectiveBlend = max(phaseBlend, crossfadeBlend)` pattern, idle sway (sinusoidal bob on hand_R + forearm_R z-axis). Runs in `update(dt)` after `animationSystem()`. Zero per-frame allocations. **Animation write-permissions** (doc §3): `ViewmodelAnimationSystem` may write `quaternion` (and read/write `position` for breathing) on `upper_arm_R`/`forearm_R`/`hand_R`. It MUST NOT touch `weapon_attach` — that bone's transform is owned by per-weapon grip data, and any animation write would override the grip and visibly swing the weapon relative to the hand.

### Viewmodel Debug Toggle (#122 — PR #161)
The ship gate for the FP viewmodel rebuild per #90's acceptance criteria. Boot-time activation via `?debug-viewmodel=1` URL param (silent — no toast); runtime toggle via **F7** keydown (fires `showNotification` toast). Two pieces: (1) `ViewmodelRenderer.setDebugMode(enabled)` parents one `THREE.AxesHelper(0.05)` per animatable bone (`vm_upper_arm_R`, `vm_forearm_R`, `vm_hand_R`, `vm_weapon_attach`) on Layer 1 so they render in the viewmodel pass; helpers are **lazy-allocated on first enable** and `.visible`-toggled thereafter (no re-alloc on subsequent toggles). New public accessors: `getCurrentWeaponName(): string | null` (renderer's reality, not FSM weaponId — they share an id but live on different paths) and module-level `getArmOffset()` returning the read-only `ARM_OFFSET` Vector3. (2) `src/hud/ViewmodelDebugOverlay.ts` — bottom-left monospace HTML overlay mirroring `DebugOverlay.ts` style, rendered from a per-frame `ViewmodelDebugState` snapshot (weaponName, combatState, direction, phaseElapsed/phaseTotal/%, per-bone Eulers in degrees with 1-decimal padding, ARM_OFFSET to 3 decimals, FOV to 1 decimal, aim-sway placeholder rendering `n/a` until #129 lands). `update()` short-circuits when hidden — caller pays only the boolean check. **Zero-cost-when-disabled is contract-tested**: `setDebugMode` defaults off + traversal-asserts zero `AxesHelper`s in the scene before first enable. Direction-label table is now a single unified `['Overhead','Left','Right','Stab'][dirNum]` lookup inlined in `main.ts` (post-#139) — no longer state-dependent since attack and block share the same `Direction` enum and the same numeric values. The pre-#139 dual-table approach (`['Left','Right','Top','Bottom']` for Block vs `['Left','Right','Overhead','Stab']` otherwise) was removed when #139 unified the enums.

### Character Controller / Hover Bug (RESOLVED — #104 / PR #150)
The two architectural drifts (player capsule origin = center vs. mesh root = feet, dummy with no rigid body) are fixed in PR #150. Player and dummy capsule colliders are now offset upward inside their bodies (`setTranslation(0, R+H, 0)`) so body origin = feet; dummies have a `RigidBodyType.Fixed` capsule body so the player can collide with them; `spawnAtGround(world, x, z)` resolves Y by raycasting down from y=50; mesh sync moved from `fixedUpdate` to `render(alpha)` with `lerp(PreviousPosition, Position, alpha)` so motion stays smooth at high framerates. Tests in `createPlayer.test.ts`, `createDummy.test.ts`, and `spawnAtGround.test.ts` pin all of these invariants. Follow-up: `createShopkeep` should also call `spawnAtGround` rather than defaulting to the deprecated `SPAWN_HEIGHT` alias.

### Arena Authoring (Arena v1 LANDED — #112 / PR #164, after #117 lighting / #91 parent)
Arenas are **code-authored** — pure TypeScript, no glTF or JSON map files. `createArena(world: GameWorld): ArenaSpec` builds Three.js meshes + matching Rapier static colliders (`RigidBodyType.Fixed` + `cuboid`) 1:1 with mesh extents. Lights live inside `createArena()` (not `World.ts`) — they're map data, not engine data. The returned `ArenaSpec` is stored on **`GameWorld.arena?: ArenaSpec`** (new optional field on the `GameWorld` interface in `core/types.ts`) for systems (spawn, weapon-pickup, shopkeep AI, dummy spawn) to query without re-importing.

**v1 inventory** — 9 static props built in design-doc order (ground → 4 walls → 2 pillars → counter → back wall) so collider/body indices are predictable for tests:
- **Ground** — 30 × 0.2 × 30 olive cuboid centered at origin; top surface at **`y = 0.1 = GROUND_TOP_Y`** (the feet-origin invariant — both `spawnAtGround`'s fallback and `core/types.ts` math depend on this; do not change without updating the constant).
- **4 perimeter walls** — 2 m tall warm-grey, slight overlap at corners (no seams), at `x = ±15.25` and `z = ±15.25` (centerline).
- **2 cover pillars** — 2 × 3 × 2 light-grey at `(±5, 1.5, 0)`, mirror-symmetric across `z = 0`.
- **Shop counter** — 3 × 1 × 0.5 wood-brown at `(-12, 0.5, 12)`; **shop back wall** — 0.5 × 3 × 4 at `(-13.25, 1.5, 12)`. SW corner.

A small `addStaticBox(center, size, color)` helper inside `createArena` enforces the **mesh-full vs collider-half-extent** translation: Three.js `BoxGeometry(w, h, d)` takes full extents, Rapier `cuboid(hx, hy, hz)` takes half-extents, and the helper does `(size.x/2, size.y/2, size.z/2)` automatically. New props belong inside this helper to keep the 1:1 invariant intact (asserted by `createArena.test.ts`'s `mesh and collider extents are 1:1` test).

**Spawn-point ground truth** — the arena is now the sole producer of `spawnPointRegistry` entries. `createArena` calls `clearSpawnPoints()` first (wipes any test-leftover or prior-call entries), then registers the 6 design-doc spawn points S1..S6. The `arena/types.ts` `SpawnPoint` shape uses `{id: string, position, facing}`; the `world/SpawnPoints.ts` registry uses `{id: number, position, yaw}` — the two schemas coexist by design and `createArena` translates once (string `s1..s6` → numeric `1..6`; `facing → yaw`). **1-based numeric ids** keep `id=0` as the "no spawn point" sentinel for `RespawnEvent.spawnPointId`.

**ArenaSpec fields** — `name: 'arena_v1'`, `groundHeight: 0.1`, `bounds` (inside-walls AABB at `x/z ∈ [-15, 15]`, `y ∈ [0, 10]`), `spawnPoints` (6 entries with string ids), `shopkeepStall` (counter AABB, `npcAnchor: (-12, 0.1, 13)`, `facing: 0` = -Z = north into arena), `weaponPickupSafeVolume` (bounds shrunk by 0.5 m margin so dropped weapons don't clip wall colliders).

**main.ts wiring**: `const arena = createArena(world); world.arena = arena;` — happens BEFORE `createPlayer`. The player spawns deterministically at `arena.spawnPoints[0]` (S1, west side) — `createPlayer(world, spawn0.position)` is called explicitly with S1's coords, then `Rotation.y[playerEid] = spawn0.facing` is written manually because the explicit-position path leaves yaw at 0. The shopkeep moves to `arena.shopkeepStall.npcAnchor = (-12, 0.1, 13)` (was the v0 arbitrary `(8, _, 8)`) so the NPC actually stands behind the SW counter. `DUMMY_SPAWN_POSITIONS` is replaced by `getDummySpawnPositions(world)` which reads the four interior spawns S2/S3/S5/S6 (indices 1/2/4/5) from `world.arena.spawnPoints`, with a small inline fallback for tests that build a world without an arena.

**No shadows.** `castShadow` / `receiveShadow` / `renderer.shadowMap` are deliberately not enabled in v1 — they require shadow-camera tuning, biases, and a perf budget the low-poly aesthetic doesn't warrant. The lighting rig (ambient + hemisphere + sun directional, all from #117) is preserved verbatim by #112.

**Cleanup**: the v0 `src/ecs/entities/createArena.ts` (procedural box obstacles + GridHelper) is deleted — no consumers had imported it since `main.ts` switched to `./arena/createArena`.

See `docs/arena-v1.md` for the full layout / coordinate / lighting tables.

### Shop Panel Scaffold (#100 — PR #140) — superseded by #123
The original `src/hud/shop/ShopPanel.ts` was a tab-switcher overlay (default tabs: stub `Weapons (Gold)` + `PremiumShopTab`/USD). #123 replaces the wired panel with a flat overlay at `src/hud/ShopPanel.ts` — see "Shop UI + Purchase Flow" below. The `src/hud/shop/` directory is **left intact** as forward-compat scaffolding for real-money cosmetics: `PremiumShopTab.ts`, `types.ts`, and the legacy `ShopPanel.ts` remain in the tree but are no longer imported by `main.ts`. When Stripe (or another provider) lands, the `PaymentProvider` interface + `PremiumShopTab` can be revived as a sub-overlay or re-introduced as a tab.

### Shop UI + Purchase Flow (#123)
Two pieces ship the shippable shop UX:
- **`src/hud/ShopPanel.ts`** — flat HTML overlay cloning `InventoryPanel`'s structure (backdrop, container, ESC + click-outside close, pointer-lock release on open, `input.paused` gating). Header shows `Shopkeep — Wares` + a live gold balance subscribed to `Wallet.onGoldChange`. Body iterates `weaponConfigs` and renders one row per weapon (name, stats summary [avg head/torso/limb damage, range in m, mean swing time in ms, attack stamina cost], price, Buy button). Button states: `Owned` (disabled, grey) for in-inventory weapons, `Not enough gold` (disabled, red-ish) when balance < price, `Buy` (enabled, gold) when affordable, `—` (disabled) for `getWeaponPrice() === undefined`. The currently equipped weapon is visually marked with a green border + `(equipped)` tag. On purchase failure the row gets an inline red message that auto-clears after `ROW_MESSAGE_TIMEOUT_MS` (2.5s).
- **`src/economy/PurchaseFlow.ts`** — `purchaseWeapon(entityId, weaponName): { ok: true, weaponName, pricePaid } | { ok: false, reason }`. **Validate-then-mutate atomicity contract**: validates *every* precondition (price exists, inventory exists, not already owned, sufficient gold, FSM is `Idle`) before any mutation. On failure, **nothing changes** — gold balance, inventory, and equip state are untouched. On success: `spendGold(price)` → `addWeaponToInventory()` → `equipWeapon()`, in that order. Architect's "option A": gate on FSM busy *up front*, so we never spend gold and then bail on equip. Failure reasons: `unknown_weapon | already_owned | insufficient_gold | fsm_busy | no_inventory`. **This is the surface that becomes server-authoritative when networking lands (#92)** — keep validation order identical between client and server so the migration is mechanical.
- **Wiring**: `main.ts` constructs `new ShopPanel(input, playerEid)` (no payment provider needed) and the existing KeyE handler now calls `shopPanel.open(target)` instead of the placeholder `openShop()` log. `_suppressClickToPlay` is composed as `() => inventoryPanel.isOpen || shopPanel.isOpen` (unchanged from #100). Defensive `KeyI`/`KeyE` cross-close logic ensures inventory and shop are never simultaneously open.

### Economy Foundation (#107 — PR #142)
Minimal scaffolding for the shop feature, deliberately scoped narrower than the full Gold currency design (#95). Three pieces:
- **`src/economy/Wallet.ts`** — module-level gold balance (default `200`). API: `getGold()`, `addGold(amount)` (ignores ≤0), `spendGold(amount)` (returns `false` and does NOT deduct on insufficient funds; no subscriber notify on failure), `setGold(amount)` (clamps negatives to 0), `onGoldChange(cb): () => void` (returns unsubscribe fn — pattern matches `InventorySystem.onEquip` but with cleanup ergonomics for HUD `dispose()`), `resetWallet()` (test helper). Pure data + pubsub, no DOM/Three.js/ECS.
- **`src/economy/Prices.ts`** — `weaponPrices` side-table (`Dagger 0, Mace 100, Longsword 150, Battleaxe 200`) + `getWeaponPrice(name)` returning `undefined` for unknown weapons. Kept separate from `WeaponConfig` so weapon configs stay pure-combat data. **When adding a new weapon, also add a price entry** — missing entries treat the weapon as not-for-sale.
- **`src/hud/GoldCounter.ts`** — top-right HUD div (`top: 48px right: 16px`, z-index 10) stacking below camera-mode/FPS labels and below modal overlays (200+). Subscribes to `Wallet` in constructor, unsubscribes in `dispose()`, brief color pulse on change. Owned by `HUD.ts`.
- **Starter inventory** is now `['Dagger']` only (was all four weapons). Mace/Longsword/Battleaxe must be acquired through the shopkeep — `initInventory(playerEid, ['Dagger'], 'Dagger', 'Dagger')` in `main.ts`. The 4th arg is the **permanent `starterWeapon`** (added in #109 / PR #151) — the weapon that won't be dropped on death (#94). When omitted it defaults to `equippedWeapon`; pass `null` explicitly for "no protected starter". Note: this still contradicts the "default starter weapon is **Longsword**" line in the Spawn/Death/Respawn section above; the respawn-default behavior should be reconciled with the starter inventory in a future PR (the player can't currently respawn with a weapon they don't own).
- Out of scope here (belongs to #95): earning gold from kills/time, persistence (localStorage/server), negative balance/debt.

### Shopkeep NPC + Interaction Pipeline (#113 — PR #147)
Three pieces ship the proximity-interact loop:
- **`createShopkeep(world, x, y, z, opts?)`** — non-combatant entity factory. Adds **only** `Position`, `Rotation`, `CharacterModel` (no `Velocity`, `Health`, `Stamina`, `Hitboxes`, `CombatStateComp`, no Rapier body). Verified via `hasComponent` in tests — shopkeeps are deliberately not hittable. Body color `0xddaa44` (gold) distinguishes from dummies (red) / player (blue). Faces toward origin via `Rotation.y = atan2(-x, -z)`. String `name` lives in module-level **`shopkeepRegistry: Map<eid, {name, interactRadius}>`** side-table (bitECS components are TypedArrays). One spawned at `arena.shopkeepStall.npcAnchor = (-12, 0.1, 13)` on game start (was the v0 arbitrary `(8, SPAWN_HEIGHT, 8)` until #112 / PR #164 wired the arena's stall coords).
- **`InteractionSystem`** — ticks per fixedUpdate (called from main loop after `tickDummyHealthReset`), iterates `shopkeepRegistry` and computes 3D Euclidean distance from player Position. Caches the nearest in-range eid in module-level `nearbyByPlayer: Map<eid, eid|null>`. API: `interactionSystem(playerEid)` to tick, `getNearbyInteractable(playerEid)` for consumers, `clearInteractionCache(eid?)` for tests/cleanup. **Distance check, not a Rapier sensor** — single shopkeep makes per-tick distance ~5ns; switch to a sensor approach if interactable count grows beyond ~10.
- **`WorldLabel` HUD class** — world-anchored HTML overlay (`#world-label-container`, fixed/pointer-events:none/z-index 14), updated each render frame. Mirrors `DummyHealthBar.ts`'s projection pattern: `Vector3.project(camera)` → NDC → pixel coords; hides when `proj.z > 1` (behind camera). Renders **two divs per shopkeep**: persistent gold nameplate at head height (`+1.6m`) and a conditional "Press [E] to shop" prompt at `+1.2m` shown only when `nearbyInteractableEid === eid`. Single reused `Vector3` — zero per-frame allocations. Auto-removes labels for shopkeeps deleted from `shopkeepRegistry`.
- **KeyE wiring**: `main.ts` `keydown` switch dispatches `KeyE` → bails on `input.paused` (so E during inventory/shop overlay is a no-op) → calls `getNearbyInteractable(playerEid)` → if non-null, defensively closes any open inventory and calls `shopPanel.open(target)`. (Originally landed as a placeholder log in #113; rewired to the real overlay in #123.)

### Weapon Pickup Foundation (#109 — PR #151)
First slice of parent #94 (drop-on-death / pickup / despawn). Foundation only — no behavior yet. Three pieces:
- **`WeaponPickup` component** (`src/ecs/components.ts`) — numeric-only per bitECS constraint: `weaponId: ui8` (index into `weaponIdToName`, used for networking-friendly serialization once that lands), `spawnTick: ui32`, `despawnTick: ui32`. The string `weaponName` and Three.js refs live in the side-table.
- **`pickupRegistry`** (`src/inventory/PickupRegistry.ts`) — module-level `Map<eid, PickupData>` mirroring `meshRegistry` / `fsmRegistry` / `shopkeepRegistry`. `PickupData = { weaponName: string, group: THREE.Group, materials: THREE.Material[] }`. **Materials are cached at spawn time** so #B's blink/fade pass in the last 5s of life doesn't re-traverse every frame. `resetPickupRegistry()` is a test helper, not for game code.
- **`createWeaponPickup(world, args)` / `removeWeaponPickup(world, eid)`** (`src/ecs/entities/createWeaponPickup.ts`) — factory + remover, mirror of `removeDummy` / `removeShopkeep`. Resolves `weaponId` via `weaponIdToName.indexOf` (falls back to `0` when name is unknown — `pickupRegistry.weaponName` is the source of truth). Mesh is built via a local `createGroundPickupModel` stub that calls `weaponModelFactories[name]()` and lays the group flat (`rotation.x = -π/2`); **#B replaces this stub with a real implementation in `WeaponModels.ts`** with weapon-specific orientation tuning + spin animation hooks. `removeWeaponPickup` traverses the group disposing geometries/materials, removes from scene, deletes from registry, then `removeEntity`. Safe to call with unknown eid.
- **`InventoryData.starterWeapon`** — new `string | null` field on the runtime `InventoryData` (`src/ecs/systems/InventorySystem.ts`, **NOT** the dead-code `src/inventory/InventoryData.ts`). `initInventory(eid, weapons, equippedWeapon, starterWeapon?)` — when omitted defaults to `equippedWeapon` (backward compat with all existing callsites), pass `null` explicitly for "no protected starter". `#A2`'s drop-on-death system reads this to skip dropping the starter (otherwise the floor floods with daggers).
- **Death-event seam**: `main.ts` now destructures `{ died, respawned }` from `healthSystemTick(world.ecs)` and leaves a `TODO(#A2): weaponPickupSystem(world, currentTick, died, ...)` placeholder. Foundation only — no system call wired.
- **Out of scope** (#A2): drop-on-death logic, proximity pickup check, KeyE wiring, despawn-timer system. **Out of scope** (#B): ground-flat orientation polish per weapon, spin animation, blink/fade rendering, HUD prompt, README controls update.

### Animation Foundation (#120 — PR #152)
Backend groundwork for the animation rebuild (#89, #110). Five pieces, all additive:
- **`CombatFSM.getPhaseTotal()` / `getPhaseT()`** — phase math is now the FSM's responsibility (was a `computePhaseTotal` heuristic in `CombatSystem.ts`). `getPhaseTotal()` returns the total ticks for the current state (`windup[dir]`, `release[dir]`, `recovery[dir]` or `comboRecovery[dir]` for combo Recovery, `parryWindow`, `hitStunTicks`, `parryStunTicks`, `3` for Feint, `0` for Idle/Block). `getPhaseT()` returns normalized progress in `[0, 1]`, clamped. **Single source of truth** — call these rather than re-deriving from weapon config.
- **`CombatStateComp.phaseT: f32`** — synced each fixed tick from `fsm.getPhaseT()` alongside the existing `phaseElapsed`/`phaseTotal` (ui16). AnimationSystem reads `phaseT` to drive pose interpolation. Per the FSM v2 spec, this field will move onto the unified `CombatState` component when #88 lands.
- **`HitReactComp` + `HitReactSystem`** (`src/ecs/components.ts`, `src/ecs/systems/HitReactSystem.ts`) — `{dirX, dirY, dirZ: f32, magnitude: f32, spawnedAtTick: ui32, durationTicks: ui16, active: ui8}`. `DamageSystem.handleHit` populates it on every successful unblocked hit, rotating the world-space attacker→target delta into the target's body-local frame via `-yaw` around Y; magnitude is `damage / max-direction-damage` clamped to `[0, 1]`; duration is **12 ticks (~200ms)**. Successful blocks/parries do NOT touch the component (sentinel test in `HitReactSystem.test.ts`). `HitReactSystem` runs **after** `DamageSystem` in `main.ts` so a fresh stamp doesn't get cleared the same tick it's written.
- **`src/core/tickCounter.ts`** — module-level fixed-tick counter (`currentFixedTick`). `advanceFixedTick()` is called **once at the top of `fixedUpdate`** in `main.ts` before any system that stamps events. Read via `getCurrentFixedTick()`; reset via `resetFixedTick()` (test helper). NOT incremented from variable-rate update/render — must advance in lockstep with the fixed timestep so consumers can compare `currentTick` to a previously-stamped `spawnedAtTick + durationTicks` with tick-precise semantics.
- **Dummies have a CombatFSM** — `createDummy` now registers a `CombatFSM` in `fsmRegistry` so `CombatSystem`'s existing all-entities loop ticks dummies and populates `phaseElapsed`/`phaseTotal`/`phaseT` for them just like the player. `toggleDummyBlock`, `cycleDummyBlockDirection`, and `resetAllDummies` all route through the FSM transition API (Idle → Block now goes through `ParryWindow` first, exactly like the player). New `CombatFSM.setBlockDirection()` setter lets the cycle helper update direction without re-entering ParryWindow.
- **Bonus — combo recovery now actually works**: a latent bug where `_isComboRecovery` was never set to `true` was papered over by the old `computePhaseTotal` heuristic (`ticksRemaining <= comboRecovery → comboRecovery`). Fixed via a new `_currentSwingIsCombo` flag set on `_enterWindup(dir, fromCombo=true)` (combo path only) and consumed at Release expiry → `_enterRecovery(this._currentSwingIsCombo)`. Weapon configs' `comboRecovery` values are now actually applied as designed.

### Death Event Pipeline (#130 — first slice of #93)
First slice of the spawn/death/respawn loop (parent #93 — design doc `docs/spawn-death-respawn.md`). Wires the `HealthSystem` death scaffolding into a real event pipeline. Five pieces:
- **`DeadTag` / `RespawnPending` / `Score` / `Bot` components** (`src/ecs/components.ts`). `DeadTag` is a marker added on death and removed on respawn; `RespawnPending.ticksRemaining` (ui16) replaces the legacy `respawnTimers` Map side-table so the timer survives an ECS query. `Score` carries `kills/deaths/goldThisLife` (ui16/ui16/ui32) — `kills` and `deaths` persist across the respawn loop, `goldThisLife` resets on death. `Bot` is a stub tag for #99's warmup bots so `processDeaths` already includes them in the kill-credit pipeline; no fields, no behavior here.
- **`src/events/EventBus.ts` + `src/events/types.ts`** — minimal pub/sub. `emit(type, payload)` queues; `flush()` drains. Flushed once per `fixedUpdate` AFTER all systems run so handlers see a consistent snapshot. Re-emits during dispatch land on the next flush (avoids feedback loops). Four event types match the design doc: `DamageDealt`, `DeathEvent`, `RespawnEvent`, `WeaponEquipped`. Generic on/emit signatures give type-safe payloads via `EventPayloadMap`.
- **`HealthSystem` refactor** — removed the `respawnTimers: Map`. `healthSystemTick` now adds `DeadTag`+`RespawnPending` on first HP→0 and ticks `RespawnPending.ticksRemaining` down each fixedUpdate; HP/stamina/position restore is now `processRespawns`' job (issue B). `RESPAWN_DELAY_TICKS` bumped 120 → **180 (3.0 s)** per the design doc. `isDead(world, eid)` is now a `hasComponent(DeadTag)` check.
- **`DamageSystem` attribution + DamageDealt event** — every successful (unblocked, unparried) hit now records `{attackerEid, weaponId, bodyRegion, tick}` into a per-victim attribution map and emits a `DamageDealt` payload (lethal or not). `getDamageAttribution(victim, currentTick)` returns null past the **300-tick (5 s)** window — that's how `processDeaths` decides whether to credit a killer or use `killerEid = 0` (suicide / environmental).
- **`processDeaths(died, world)`** (`src/ecs/systems/processDeaths.ts`) runs immediately after `healthSystemTick`. For each entity in `died` that's tagged `Player` OR `Bot` (dummies opt out — they regen via `tickDummyHealthReset`), it: (1) resolves the killer via `getDamageAttribution`, (2) emits a `DeathEvent`, (3) increments `Score.deaths[victim]` and (if attributed and not self-kill) `Score.kills[killer]`, (4) resets `Score.goldThisLife[victim] = 0`, (5) calls `fsm.reset()` and forces both `CombatStateComponent` + `CombatStateComp` to Idle, (6) zeroes `Velocity`, (7) calls a no-op `dropEquippedWeapon(victim, world)` stub from `InventorySystem`. **CRITICAL: dummies are excluded by the `Player|Bot` gate** — without it a dummy's HP=0 would emit a DeathEvent and double-count via `tickDummyHealthReset`.
- **CombatSystem + MovementSystem early-outs** — both systems now start their per-entity loop with `if (hasComponent(DeadTag, eid)) continue;` so dead entities don't read input, don't tick the FSM, and don't move. This pairs with `processDeaths`'s FSM reset to ensure dead players freeze cleanly mid-windup.
- **createPlayer default starter weapon: `'Longsword'`** (was `'Dagger'`) per the design doc decision. `main.ts` `initInventory(eid, ['Longsword'], 'Longsword', 'Longsword')` matches; the viewmodel `initialWeapon` is also Longsword. Dagger is now the cheapest weapon in the shop, not the starter.
- **`dropEquippedWeapon(eid, world)` stub** in `src/ecs/systems/InventorySystem.ts` — wired through `processDeaths` so the death pipeline is complete on its own timeline. The actual implementation (spawn `WeaponPickup` at feet, skip protected `starterWeapon`) is owned by #94 / #A2.
- **main.ts `fixedUpdate` ordering**: `inputSystem → combatSystem → movementSystem → staminaSystemTick → const {died, respawned} = healthSystemTick → processDeaths(died, world) → physics.step → hitboxSystem → dummyDamageObserver → TracerSystem → DamageSystem → hitReactSystemTick → tickDummyHealthReset → interactionSystem → EventBus.flush()`. EventBus.flush is the LAST thing each tick.
- **Out of scope** (deferred to issue B / #131): position/HP/stamina reset on respawn, spawn-point selection, RespawnEvent emission. **Out of scope** (deferred to issue C): DeathScreen, Killfeed, Scoreboard HUDs — those subscribe to the EventBus that ships here. **Out of scope** (deferred to #94 / #A2): real `dropEquippedWeapon` body. **Out of scope** (FSM v2 / #88): unifying `CombatStateComponent` + `CombatStateComp` into a single `CombatState` component — `processDeaths` writes both today.

### Spawn-Point Registry + Respawn Flow (#134 — PR #159, second half of #93)
Closes the spawn/death/respawn loop end-to-end. Death side landed in #130; this slice picks where you respawn and actually puts you back on the map. Six pieces:
- **`src/world/SpawnPoints.ts`** — `SpawnPoint { id, position: {x,y,z}, yaw }` interface (feet-position + facing-radians, matches the feet-origin convention from #104) + module-level `spawnPointRegistry: Map<id, SpawnPoint>` + `registerSpawnPoint` / `clearSpawnPoints` helpers + `selectSpawnPoint({ enemies, minEnemyDistance?, random? }): SpawnPoint | null`. The selector is the design doc's 4-step weighted-away-from-enemies algorithm: empty registry → null; no enemies → uniform random; otherwise filter to candidates with distance-to-nearest-enemy ≥ `minEnemyDistance` (default **8.0**) and uniform-random over the safe set; if no candidate is safe, **max-min fallback** picks the candidate furthest from its nearest enemy (so a packed arena still respawns the player). `random` is the deterministic-test seam; defaults to `Math.random`. Distance is 3D Euclidean — Y matters. `seedPlaceholderSpawnPoints()` registers four corners at `(±10, SPAWN_HEIGHT, ±10)` with `yaw = atan2(-x, -z)` (facing origin) — **kept around for unit tests that don't spin up an arena, but no longer wired in production** since #112 / PR #164 made `createArena` register the real 6-point arena spawn list. **1-based ids so `id=0` stays the "no spawn point" sentinel** for `RespawnEvent.spawnPointId`.
- **`src/ecs/systems/processRespawns.ts`** — runs in `fixedUpdate` immediately after `processDeaths(died, world)`. For each eid in `respawned`: builds the live-combatant snapshot **once per tick** (two queries `[Position, Player]` + `[Position, Bot]` deduped via Set since bitECS queries are conjunctive — no built-in OR), filters out self defensively, calls `selectSpawnPoint({ enemies })`. On null → `console.warn` + skip (entity stays `DeadTag`'d on the floor; empty registry is treated as a config error, not runtime concern). On hit: writes `Position` + **`PreviousPosition`** + `Rotation.y`, drives the Rapier kinematic body via `setNextKinematicTranslation`, restores `Health.current = Health.max` and `Stamina.current = Stamina.max`, calls `resetEntityStaminaTracking(eid)`, calls `equipDefaultStarter(eid)`, removes `DeadTag` + `RespawnPending`, emits `RespawnEvent { eid, spawnPointId, tick }`. **CRITICAL: `PreviousPosition` write** prevents the render-tick `lerp(PreviousPosition, Position, alpha)` from tweening the model from death-location to spawn-point over one frame — without it you see a visible glide artifact at high framerates.
- **`getPhysicsBody(eid)` accessor on `MovementSystem`** — exposes the existing `bodyByEid` Map. Documented choice over `world.physicsWorld.getRigidBody(PhysicsBody.bodyHandle[eid])`: Rapier handles are composite floats that get truncated by the bitECS `ui32` `bodyHandle` slot, so the handle round-trip is **lossy**. Future systems that need to teleport / impulse an entity should use this accessor; `bodyHandle` stays as an audit value only.
- **`equipDefaultStarter(eid)` + `DEFAULT_STARTER_WEAPON = 'Longsword'`** on `InventorySystem` — single source of truth for "what does a freshly-spawned combatant equip". Both `createPlayer` (initial spawn) and `processRespawns` (every subsequent life) consult it so the two paths can't drift. Adds the starter to inventory if missing — covers the future world after #94 / #A2 lands `dropEquippedWeapon` and clears the prior life's weapon. Returns false if the entity has no inventory or `equipWeapon` rejects (FSM not Idle — shouldn't happen on respawn since `processDeaths` resets the FSM).
- **`resetEntityStaminaTracking(eid)` on `StaminaSystem`** — drops the per-entity regen-delay counter for one eid (vs. `resetStaminaTracking()` which clears every entity for test isolation). Without this the regen-delay window from the previous life carries over and the first post-spawn tick either regens immediately or sits idle for a full second. Per-entity, safe to call in production, no-op when the eid has no entry.
- **`createPlayer` initial-spawn registry path** — when the caller doesn't pass `spawnPos`, `createPlayer` consults `selectSpawnPoint({ enemies: [] })` (no live combatants exist yet at world-load time) and uses the chosen point's position + yaw. Falls back to `(0, raycast, 0)` if the registry is empty (unit tests that don't seed spawn points). Tests pass explicit `spawnPos` to keep deterministic positioning. **Update post-#112 / PR #164**: `main.ts` now passes `arena.spawnPoints[0].position` explicitly so the dev-path initial spawn pins to S1 deterministically (was non-deterministic-by-design under the placeholder regime); the registry-driven random-pick path still exists and is exercised by tests + by `processRespawns` for every subsequent life.
- **main.ts wiring** (post-#112 / PR #164): `createArena(world)` registers the 6 arena spawn points and is called BEFORE `createPlayer(world, arena.spawnPoints[0].position)` — `seedPlaceholderSpawnPoints()` is no longer wired in production. `processRespawns(respawned, world)` runs in `fixedUpdate` immediately after `processDeaths(died, world)`. Updated `fixedUpdate` ordering: `inputSystem → combatSystem → movementSystem → staminaSystemTick → const {died, respawned} = healthSystemTick → processDeaths(died, world) → processRespawns(respawned, world) → physics.step → hitboxSystem → dummyDamageObserver → TracerSystem → DamageSystem → hitReactSystemTick → tickDummyHealthReset → interactionSystem → EventBus.flush()`.
- **`Lifecycle.test.ts`** integration test — drives the real `healthSystemTick → processDeaths → processRespawns → EventBus.flush` chain. Pins `RESPAWN_DELAY_TICKS = 180` exactly (off-by-one regression check — counter starts at 180, decrements 179 times to 1, the final tick takes it to 0 and surfaces in `respawned`). Verifies `Score.deaths` persists across respawn, `Score.goldThisLife` stays 0 through respawn, second damage post-respawn doesn't immediately re-kill, non-fatal damage emits no `DeathEvent`.
- **Out of scope**: HUD subscribers (`DeathScreen` / `Killfeed` / `Scoreboard` — issue C, `RespawnEvent` is now emitted on the EventBus and ready to consume); real `dropEquippedWeapon` body (#94 / #A2 — still a no-op stub from #130). **Resolved**: real arena geometry — landed in #112 / PR #164; the placeholder seam paid off mechanically with no `processRespawns` / `selectSpawnPoint` changes needed.

### Module-Level Singletons
`fsmRegistry`, `meshRegistry`, `hitboxColliderRegistry`, `weaponIdToName`, `inventoryRegistry`, `weaponModelFactories`, `Wallet.goldBalance`, `shopkeepRegistry`, `InteractionSystem.nearbyByPlayer`, `pickupRegistry`, `MovementSystem.bodyByEid` / `colliderByEid` / `movementTick`, `InputSystem.prevJumpKeyDown`, `tickCounter.currentFixedTick`, `EventBus.handlers` / `EventBus.queue` (#130), `DamageSystem.attributionByVictim` (#130), `spawnPointRegistry` (#134) are all module-level Maps/arrays/scalars. Works for single-world but won't scale to multiple worlds. The `prevJumpKeyDown` edge-trigger state is the one that will need to become per-controller when multiplayer lands; `currentFixedTick`, the EventBus state, the attribution map, and `spawnPointRegistry` will likely need to live on `GameWorld` once a server runs multiple worlds in one process.

## Gotchas
- **Rapier3D WASM must be initialized async** before creating the physics world — use `import RAPIER from '@dimforge/rapier3d-compat'` then `await RAPIER.init()`
- **bitECS uses ArrayBuffer-backed components** — component values are numbers only (no strings, no objects). Use lookup tables/maps for complex data.
- **Three.js `Clock.getDelta()`** should NOT be used for the fixed timestep — implement a custom accumulator pattern
- **Pointer Lock API** can only be requested from a user gesture (click) — cannot auto-lock on page load
- **Vite HMR** with Three.js requires careful disposal of scenes/renderers to avoid memory leaks on hot reload
- **Rapier debug renderer** needs `@dimforge/rapier3d-compat` not `@dimforge/rapier3d` for browser compatibility
- The deploy workflow (`.github/workflows/deploy-staging.yml`) expects a `Dockerfile` and maps port 3000 internally → 3010 externally
- **CombatSystem syncs both `CombatStateComponent` and `CombatStateComp`** — phase math (`getPhaseTotal` / `getPhaseT`) lives on the FSM. AnimationSystem reads from `CombatStateComp` (`phaseElapsed`, `phaseTotal`, `phaseT`, `state`, `direction`).
- **`weaponIdToName` in CombatSystem.ts (line 28) is a hardcoded array** — when adding new weapons, update this array AND ensure the weapon's numeric index matches `CombatStateComponent.weaponId[eid]`
- **Pointer Lock must be released** when showing any UI overlay (inventory, menus) — call `document.exitPointerLock()`. Re-request on close via user gesture (click on canvas).
- **Side-table pattern** for non-numeric data: `meshRegistry` (Map<number, CharacterModelData>), `fsmRegistry` (Map<number, CombatFSM>), `hitboxColliderRegistry` — use the same pattern for inventory/equipment data
- **`SPAWN_HEIGHT` is now a deprecated alias of `GROUND_TOP_Y` (= 0.1)** — semantics changed from capsule-center (1.1) to feet (0.1) in PR #150. Existing call sites still compile but new code should use `spawnAtGround()` for spawn Y or `GROUND_TOP_Y` for the literal.
- **`MovementIntent` is the AI/network seam** — `MovementSystem` no longer reads `InputManager`. To make an entity move, write to `MovementIntent { moveX, moveZ, sprint, crouch, jumpRequested }`. `jumpRequested` is edge-triggered (cleared by `MovementSystem` after consumption). For player input, `InputSystem` does this each fixed tick. AI controllers / network deserializers will use the same component.
