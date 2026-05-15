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
│   │   ├── GameState.ts         # `GameState` const enum (MAIN_MENU/PLAYING/PAUSED) + `GameStateManager` pub/sub. ECS systems do NOT consult this — only InputManager.paused flips (#101)
│   │   ├── version.ts           # `APP_VERSION` string constant mirrored from `package.json#version` — keep in lockstep when bumping versions (#106)
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
│   │   │   ├── AnimationSystem.ts # Layered procedural animator: snapshot phase-t slerp + arc swings + hit-react overlay; defensive vs missing MovementState (#128)
│   │   │   ├── WeaponPickupSystem.ts # KeyE edge-detect pickup + despawn sweep; owns `DESPAWN_TICKS`/`BLINK_TICKS`/`PICKUP_RADIUS`/`PICKUP_COOLDOWN_TICKS`; pure `tryClaimPickup` is the networking seam (#121)
│   │   │   └── ...
│   │   ├── entities/            # Entity factory/spawner functions
│   │   │   ├── createPlayer.ts  # Player factory: kinematic body + capsule (offset upward), MovementIntent component, Y resolved by spawnAtGround
│   │   │   ├── createDummy.ts   # Training dummy factory: fixed body + capsule (same offset as player), Y resolved by spawnAtGround
│   │   │   ├── createShopkeep.ts # Static non-combatant NPC (Position/Rotation/CharacterModel only) + shopkeepRegistry side-table (#113)
│   │   │   ├── createWeaponPickup.ts # Ground weapon pickup factory + remover (#109, foundation for #94; behavior lives in `WeaponPickupSystem.ts` per #121)
│   │   │   └── ...
│   │   └── utils/
│   │       └── spawnAtGround.ts # Raycast-down feet-Y resolver used by all entity factories (#104)
│   ├── events/
│   │   ├── EventBus.ts          # In-process pub/sub: queue + flush for DamageDealt/DeathEvent/RespawnEvent/WeaponEquipped/WeaponDrop/WeaponPickup/WeaponDespawn — flushed once per fixedUpdate (#130, #121)
│   │   └── types.ts             # Event payload types matching docs/spawn-death-respawn.md (#130); WeaponDrop/WeaponPickup/WeaponDespawn payloads added by #121
│   ├── world/
│   │   └── SpawnPoints.ts       # Spawn-point registry + selectSpawnPoint() weighted-random selector. Arena owns ground truth (createArena clears + registers); seedPlaceholderSpawnPoints() retained for unit tests only (#93, #134, #112)
│   ├── animation/
│   │   ├── AnimationData.ts     # Third-person combat animation poses (per-direction, per-phase) — `UPPER_BODY_BONES_EXCEPT_SPINE` added by #128; `SHARED_BONES` deprecated
│   │   ├── ViewmodelAnimationData.ts # First-person viewmodel poses — per-weapon × per-direction × per-phase
│   │   ├── poseBlending.ts      # Shared `applyPoseLayer(snapshot → target, easedT)` slerp pipeline + `smoothstepEase` + `CROSSFADE_DURATION_SEC` (#128)
│   │   ├── arcSwing.ts          # Per-direction `ARC_SWING_PARAMS` + `computeArcSwingPose(direction, t)` for the Release phase (#128)
│   │   └── hitReact.ts          # `applyHitReactLean` overlay during HitStun — peaks at t=0.3, decays to 0 by t=1, ~30° tilt cap (#128)
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
│   │   ├── InputManager.ts      # Raw input capture, pointer lock, mouse delta tracking; pointer-lock-loss / blur cleanup (#172); listener tracking + working dispose() (#172)
│   │   ├── InputManager.types.ts # Target interface contract (issue #102 spec — see docs/input-pipeline.md)
│   │   ├── debugKeyGate.ts      # `shouldDispatchDebugKey` predicate gating T/Y/J/K behind paused + pointer-lock checks (#172)
│   │   └── keybinds.ts          # DUAL surface: (a) `DEFAULT_KEYBINDS` `Record<InputAction, …>` for the InputManager rebuild (#102) and (b) UI-facing `keybinds` array + `Keybind`/`KeybindGroup` types + `getKeybind`/`keybindsByGroup` for the Controls overlay (#3, scaffolded by #101). Tables coexist until #87 unifies; **keep both in sync when adding bindings**.
│   ├── rendering/
│   │   ├── CameraController.ts  # FPS + debug third-person camera
│   │   ├── CharacterModel.ts    # Procedural low-poly character mesh + skeleton
│   │   ├── WeaponModels.ts      # Procedural weapon models (Mace, Dagger, Battleaxe) + factory registry; `createGroundPickupModel` per-weapon flat-orientation map (#127); `WeaponModelFactory` type alias documenting the post-cache immutability contract that `ViewmodelRenderer`'s cache + #173 layer guard depend on
│   │   ├── ViewmodelRenderer.ts # First-person viewmodel (right arm + weapon, Layer 1, separate camera)
│   │   ├── ViewmodelAnimationSystem.ts # Viewmodel bone animation (reads CombatStateComp, per-weapon poses)
│   │   ├── PickupRenderer.ts    # Variable-rate spin/bob/blink+fade for ground weapon pickups (#127); re-exports `DESPAWN_TICKS`/`BLINK_TICKS`/`PICKUP_RADIUS` from `WeaponPickupSystem.ts` (canonical home as of #121)
│   │   └── DebugRenderer.ts     # Wireframe, hitbox, physics debug drawing
│   ├── inventory/
│   │   ├── InventoryData.ts     # Legacy UI-only side-table (DEAD CODE — see "Two Disconnected Inventory Modules" below)
│   │   └── PickupRegistry.ts    # Side-table for ground weapon pickups: pickupRegistry Map<eid, PickupData> (#109; consumed by `WeaponPickupSystem.ts` and `dropEquippedWeapon` per #121)
│   ├── economy/
│   │   ├── Wallet.ts            # Legacy in-memory player gold balance + onGoldChange pubsub (#107) — being migrated to `Gold` ECS component (#103); `awardGold` double-writes here as a transitional bridge
│   │   ├── Prices.ts            # weaponPrices side-table + getWeaponPrice() (#107)
│   │   ├── PurchaseFlow.ts      # Atomic validate-then-mutate purchaseWeapon API (#123)
│   │   ├── goldEconomy.ts       # Single chokepoint for gold mutations: `awardGold(eid, amount, reason)` + `awardGoldOnKill(world, victim, attacker)` + `onGoldAwarded` pubsub + `GOLD_PER_KILL = 25` (#103); `awardGold` persists via `saveGold(playerId, newBalance)` when an identity is attached (#105)
│   │   ├── playerIdentity.ts   # Browser-scoped stable player id: `crypto.randomUUID` on first launch under `bb_player_id`, side-table `playerIdentityRegistry: Map<eid, string>`, `attachPlayerIdentity(eid)` / `getPlayerId(eid)`, defensive `Math.random` UUID fallback + single-warning gates for storage-disabled paths (#105)
│   │   └── goldPersistence.ts  # localStorage-backed save/load for `bb_gold_<playerId>`: `loadGold(id)` (validates: missing/NaN/non-integer/negative → 0 with single warn), `saveGold(id, n)` (trailing-edge debounce 100ms — coalesces kill flurries to one `setItem`), `flushGoldWrites()` synchronous escape hatch for `beforeunload` + tests, `hasPersistedGold(id)` distinguishes first-launch from explicit-0 (#105)
│   ├── hud/
│   │   ├── HUD.ts               # HUD manager — uses `theme.ts` constants; ctor takes optional `world` for DeathScreen/Killfeed/Scoreboard (#101, #137)
│   │   ├── theme.ts             # Shared visual constants (font, bg, border, text, status, z-index tiers); mirrored as CSS custom properties on `:root` in index.html (#101)
│   │   ├── MenuManager.ts       # Single owner of modal-overlay lifecycle (open/close, ESC routing, pointer-lock release, input.paused, click-to-play suppression). Modals register `{close, open?}` callbacks (#101)
│   │   ├── MainMenu.ts          # Entry overlay shown at boot — `BLADEBOYZ` title + PLAY button + controls hint + version label. Registers as `'main'` with MenuManager; pointer-lock acquired synchronously inside Play-button click handler BEFORE GameState flip (#106)
│   │   ├── HealthBar.ts
│   │   ├── StaminaBar.ts
│   │   ├── DirectionIndicator.ts # Mordhau-style compass-rose crosshair overlay (attack/block direction)
│   │   ├── InventoryPanel.ts    # Tab inventory UI overlay (HTML/CSS, pointer lock toggle); 3rd ctor arg is optional `MenuManager` — when present, panel registers + delegates ESC + pointer-lock + input.paused (#101)
│   │   ├── ShopPanel.ts         # Shopkeep overlay — weapon list + Buy buttons + live gold (#123)
│   │   ├── DeathScreen.ts       # Full-screen death overlay + respawn countdown — DeadTag-driven visibility, DeathEvent for killer line (#137)
│   │   ├── Killfeed.ts          # Top-right kill log, capped at 5 visible, fades 5s after creation, pure event-driven (#137)
│   │   ├── Scoreboard.ts        # Persistent top-left K/D/Gold for the local player; reads `Score` each frame with caching (#137)
│   │   ├── GoldCounter.ts       # Top-right gold balance HUD, subscribes to Wallet (#107)
│   │   ├── WorldLabel.ts        # World-anchored HTML overlay — shopkeep nameplate + "Press [E] to shop" prompt (#113)
│   │   ├── PickupPrompt.ts      # Centred "Press [E] to pick up {Weapon}" overlay; FSM-Idle + pointer-lock gates, closest-of-many (#127)
│   │   ├── DebugOverlay.ts      # FSM state, FPS counter
│   │   └── ViewmodelDebugOverlay.ts # Bottom-left bone/state readout for --debug-viewmodel toggle (#122)
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
│   │   ├── 03-sequences-and-anticheat.md     # End-to-end sequence diagrams (join/move/swing/block/reconnect) + per-message anti-cheat rules + log levels (#133)
│   │   └── 04-server-packaging.md            # Headless server packaging + CoreWorld/RenderWorld/ServerWorld split + per-world side-tables + Dockerfile/deploy + 11-PR migration plan (#138)
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

**Pointer-lock loss invariant (#172)**: when pointer lock transitions locked → unlocked (user pressed ESC, browser revoked, alt-tab fired blur, lock request errored), `InputManager` MUST clear `keysDown` + `mouseButtons` and set `paused = true`. The user-facing bug it prevents: hold W → ESC out of lock → browser stops sending keyup → next pointer-lock acquire walks the player forward involuntarily because the keysDown Set still has `KeyW`. Three handlers enforce the invariant: `pointerlockchange` (transition watcher), `pointerlockerror` (failed lock request), and `window.blur` (defense-in-depth — some browsers don't fire pointerlockchange on alt-tab). Lock acquired flips `paused` back off and auto-focuses the canvas. Debug-only keys (T/Y/J/K) MUST consult `shouldDispatchDebugKey` (`src/input/debugKeyGate.ts`) at the call site so they stay inert while paused or while pointer lock is held by something other than the canvas. `InputManager.dispose()` reverses every (target, type, fn) tuple it attached — required for Vite HMR teardown and test isolation; listener bodies short-circuit on `_disposed` so any in-flight queued events post-dispose are no-ops.

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

### Weapon Pickup Pipeline (SHIPPED — #121 / parent #94)
Ground weapon pickups have a full death → drop → pickup → despawn pipeline as of #121. Three architectural pieces:

1. **Foundation (#109)** — `WeaponPickup` component + `createWeaponPickup`/`removeWeaponPickup` factory + `pickupRegistry` side-table + `InventoryData.starterWeapon` field. Numeric data lives on the ECS component; the Three.js Group + cached `Material[]` live in `pickupRegistry`.

2. **Visuals (#127)** — `PickupRenderer` (variable-rate spin/bob/blink+fade in last 5s), `PickupPrompt` HUD overlay ("Press [E] to pick up X"), per-weapon flat-orientation map in `createGroundPickupModel`. Pure rendering — no gameplay state change.

3. **Behavior (#121)** — split across two homes:
   - `dropEquippedWeapon(eid, world)` in `InventorySystem.ts` is called by `processDeaths` for every dying Player/Bot. Spawns a `WeaponPickup` at the corpse's feet (Position.x/y/z), removes the dropped weapon from inventory, re-equips the protected `starterWeapon` if it's still in inventory, emits `WeaponDrop` on EventBus. **Starters are never dropped** — `equippedWeapon === starterWeapon` is a no-op early-out. Dummies opt out (filtered by `processDeaths`'s Player|Bot gate).
   - `weaponPickupSystem(world, currentTick, input, playerEid)` in `WeaponPickupSystem.ts` runs once per fixed tick. Edge-detects KeyE press (module-level `prevKeyEDown` latch — held-down doesn't re-fire), finds closest in-range pickup, validates via the **pure** `tryClaimPickup` helper (the networking seam — same predicate the server will run in #92), then mutates inventory + scene. If the player has a non-starter equipped, that weapon is dropped at their feet with `spawnTick = currentTick + PICKUP_COOLDOWN_TICKS` (30 ticks, 0.5s) so the just-dropped weapon is invisible to claim until the cooldown elapses. Also runs the despawn sweep: any pickup whose `despawnTick <= currentTick` is removed + `WeaponDespawn` emitted.

**Constants** (single source of truth in `WeaponPickupSystem.ts`): `DESPAWN_TICKS = 1800` (30s lifetime), `BLINK_TICKS = 300` (5s blink/fade warning), `PICKUP_RADIUS = 1.5` (meters, 3D Euclidean), `PICKUP_COOLDOWN_TICKS = 30` (0.5s post-drop). `PickupRenderer.ts` and `PickupPrompt.ts` re-import these. The renderer's blink-fade window can never drift from the system's despawn timer.

**Events** (all on `EventBus`):
- `WeaponDrop { sourceEid, weaponName, position, tick }` — fired both by `dropEquippedWeapon` on death and by `weaponPickupSystem` when a player swaps a non-starter at pickup time.
- `WeaponPickup { pickupEid, playerEid, weaponName, tick }` — fired on successful KeyE claim.
- `WeaponDespawn { pickupEid, tick }` — fired when a pickup times out.

**Prompt / pickup parity**: `PickupPrompt.update` runs the same proximity + Idle + pointer-lock predicate as `tryClaimPickup`. The acceptance contract is "when the prompt is showing, KeyE must always succeed; when hidden, KeyE must always fail". `PickupPrompt` still does its own closest-in-range scan (it needs the name to render), but the visibility predicate matches the claim predicate 1:1.

**Networking seam**: `tryClaimPickup` is pure — calling it twice with the same args returns equal events and mutates nothing. The mutating side (`claimPickup` / drop logic) lives in the calling system. When #92 lands, `tryClaimPickup` moves server-side verbatim; the client just sends "tried to pick up pickup eid X" and waits for the server's authoritative `WeaponPickup` event echo.

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
- **Forbidden patterns lint** (G7 in `src/__tests__/no-forbidden-patterns.test.ts`, #175 / PR #177): a vitest-based grep lint pins four rules across `src/`. (1) `setTimeout(` — allowed only in `economy/goldPersistence.ts` (intentional 100ms debounce) + 3 HUD fade/pulse callers (`DebugNotification.ts`, `GoldCounter.ts`, `ShopPanel.ts`); adding it elsewhere fails CI. (2) `setInterval(` — forbidden anywhere (tick-driven gameplay has no business with wall-clock intervals). (3) `new Promise(` — forbidden inside `src/ecs/systems/` or `src/combat/` (synchronous-by-design — async breaks determinism for networked replay per #92). (4) `event.key` — forbidden anywhere (locale-dependent; use `event.code` for physical key position). When legitimately adding a setTimeout, append the file path to `SETTIMEOUT_ALLOWLIST` in the test header and document why. The lint is the in-test substitute for an ESLint plugin and freezes today's policy.
- **Test infrastructure** (PR #177): `tsconfig.json` carries `"types": ["node"]` and `@types/node ^20.0.0` is a devDependency. Required by `src/__tests__/no-forbidden-patterns.test.ts` for `node:fs` / `node:path` / `node:url` imports. The `"types"` array explicitly opts INTO `@types/node`; if you add another `@types/*` package that should be picked up globally (e.g. test utilities), append it to that array — TS only auto-includes types when `"types"` is unset, and we've set it.

### Spatial Conventions (SHIPPED — #104 / PR #150)
- **ECS `Position` = entity feet position** (point of contact with ground). The character mesh's root bone is at the feet (`y=0` in local space), so `meshGroup.position = (Position.x, Position.y, Position.z)` is a direct copy with NO offset.
- **Capsule collider** is offset upward inside the rigid body via `ColliderDesc.capsule(...).setTranslation(0, CAPSULE_RADIUS + CAPSULE_HALF_HEIGHT, 0)` so the capsule's bottom hemisphere sits at the body origin (= feet). With `R=0.3, H=0.7` the offset is `(0, 1.0, 0)`. This is enforced by tests in `createPlayer.test.ts` and `createDummy.test.ts`.
- **Forward = -Z** (Three.js convention). Yaw=0 looks down -Z. `moveX = strafe*cos(yaw) - forward*sin(yaw); moveZ = -strafe*sin(yaw) - forward*cos(yaw)`. The yaw rotation lives in `InputSystem`, not `MovementSystem`.
- **Spawn**: always use `spawnAtGround(world, x, z)` from `src/ecs/utils/spawnAtGround.ts`. It raycasts down from `(x, 50, z)` and returns `hit.toi + CHARACTER_CONTROLLER_OFFSET`, falling back to `GROUND_TOP_Y + offset` when the raycast misses or the host environment lacks Rapier (tests). Never hard-code Y in spawn-position arrays. `createPlayer` and `createDummy` both use it; `createShopkeep` still uses the deprecated `SPAWN_HEIGHT` default and is a follow-up cleanup.
- **Ground**: arena ground is a fixed cuboid centered at y=0 with half-height 0.1, so its top surface is at **y = 0.1 = `GROUND_TOP_Y`** (exported from `core/types.ts`). Visual ground plane sits at y=0 (mid-cuboid).
- **Constants**: `GROUND_TOP_Y` (0.1), `CHARACTER_CONTROLLER_OFFSET` (0.02), `CAPSULE_HALF_HEIGHT` (0.7), `CAPSULE_RADIUS` (0.3) all live in `core/types.ts`. `SPAWN_HEIGHT` is a **deprecated alias of `GROUND_TOP_Y`** kept for one cycle — its semantics changed from capsule-center (1.1) to feet (0.1). New code should use `spawnAtGround()` or `GROUND_TOP_Y` directly.
- This convention applies to **all** characters (player, dummies, shopkeep, future NPCs). Entity factories must not invent their own offset.

## Known Issues / Architectural Debt

Detailed entries moved to [`docs/AGENTS-DEBT.md`](docs/AGENTS-DEBT.md) on 2026-05-15 — `AGENTS.md` had grown past the 128KB Linux `execve()` per-argument limit, causing dev/architect spawns to fail with `Argument list too long`.

**New debt entries belong in `docs/AGENTS-DEBT.md`, not here.** Dev agents read AGENTS.md as system prompt context on every spawn; the debt log only needs to be read on demand.

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
