# BladeBoyz MVP — Foundation Doc

> **Purpose:** This is the architectural baseline for the total-rework effort tracked in #85. All subsequent architect issues should reference this doc when scoping work. It defines what the smallest playable game looks like, what existing code survives the rework, and the order in which the rebuild should happen.
>
> Current-state engineering conventions (versions, build commands, ECS patterns, gotchas) live in `AGENTS.md`. This doc is the *target-state* roadmap. The two are intentionally separate: AGENTS.md describes "what is", MVP.md describes "what we're building toward".

---

## 1. MVP definition

> Two players join an arena, swing weapons in directional combat, kill each other, pick up the dropped weapon, and visit a shopkeep to buy a different weapon.

Decomposed into shippable behaviours:

| # | Behaviour                                              | Status today                       |
| - | ------------------------------------------------------ | ---------------------------------- |
| 1 | Two clients connect to one shared arena                | **Missing** — no networking exists |
| 2 | Each player controls a character (WASD, mouse-look)    | Partial — WASD just refixed in #82 |
| 3 | Directional attack & block (Mordhau-style)             | Works in single-player             |
| 4 | Hits land on the other player and reduce their health  | Single-player tracer pipeline works (#60) |
| 5 | Death → respawn loop, ephemeral score                  | Missing                            |
| 6 | Killed player drops their currently-held weapon as a world item | Missing                    |
| 7 | A player can walk over a dropped weapon and pick it up | Missing                            |
| 8 | A static shopkeep NPC stands somewhere in the arena    | Missing                            |
| 9 | Approaching the shopkeep opens a buy menu              | Missing — but `InventoryPanel` UI is reusable |
| 10| Currency is awarded for kills and spent at the shop    | Missing                            |

**One** map. **One** shopkeep. **No** accounts, matchmaking, ranked, progression, payments. Session state is ephemeral — disconnect = forfeit.

### Anti-goals (cut from MVP, even if tempting)
- Spectator mode, replays, kill cam.
- More than one map / arena.
- Lag compensation beyond a basic prediction-rollback layer (or even that — see §5).
- Cosmetic skins, kill streaks, achievements.
- Any kind of bot AI other than the placeholder for solo dev testing.
- More than the four existing weapons (Longsword / Mace / Dagger / Battleaxe).

---

## 2. Keep / Rewrite / Delete

The current scaffolding is roughly half useful. Decisions below are anchored in code review, not vibes — see notes for the specific reason. "**Keep**" means "import unchanged into the rework". "**Rewrite**" means "the responsibility stays, the code does not". "**Delete**" means "remove from the tree".

### 2.1 `src/core/`

| File | Decision | Why |
| --- | --- | --- |
| `GameLoop.ts` | **Keep** | 68 LOC, clean accumulator-pattern fixed timestep with `onFrameStart` / `fixedUpdate` / `update` / `render` / `onFrameEnd` hooks. Solid. |
| `World.ts` | **Keep, lightly edit** | 65 LOC, just initializes ECS+Three+Rapier+camera+lights+resize. The `playerEntity = -1` placeholder will be replaced when networking lands (player entity becomes per-connection). |
| `types.ts` | **Keep** | Pure constants. |

### 2.2 `src/ecs/components.ts` and the entity layer

| Item | Decision | Why |
| --- | --- | --- |
| `Position`, `PreviousPosition`, `Rotation`, `PreviousRotation`, `Velocity`, `PhysicsBody`, `MovementState`, `CharacterModel`, `Hitboxes`, `Hitbox`, `Health`, `Stamina`, `TracerTag`, `DamageEvent`, `AnimationComp` | **Keep** | All earn their place. |
| `Player` (tag) | **Keep** | Will be split per-entity rather than per-instance once 2-player lands; tag itself is fine. |
| `IsPlayer` alias | **Delete** | Dead noise. `Player` is the canonical name. |
| `CombatStateComponent` (HUD/Stamina/Damage) **vs** `CombatStateComp` (animation mirror) | **Rewrite as one** | Two components hold the same FSM state, kept in sync by `CombatSystem.computePhaseTotal()`. Unify into a single `CombatState` component with `state`, `direction`, `phaseElapsed`, `phaseTotal`, `weaponId`, `ticksRemaining`. Migrate all readers in one shot. |
| `meshRegistry`, `hitboxColliderRegistry` side-tables | **Keep** | Standard bitECS workaround for non-numeric data. |

#### `src/ecs/entities/`

| File | Decision | Why |
| --- | --- | --- |
| `createPlayer.ts` | **Keep, extend** | Becomes the spawn factory for *every* connected player, not just `world.playerEntity`. Add a `network ownership` flag so renderers know which entity is locally controlled. |
| `createArena.ts` | **Keep** | Will be extended with shopkeep + weapon-pickup spawn anchors, but the shape is right. |
| `createDummy.ts` | **Delete** (with a temporary keep) | 212-LOC god-factory exporting `activeDummies`, dummy block toggles, color cycling, health-reset timers. Replaced by real opponents. **Keep on a feature flag** for solo-test-mode until networking lands so devs can still hit something. |

#### `src/ecs/systems/`

| File | Decision | Why |
| --- | --- | --- |
| `MovementSystem.ts` | **Keep** | WASD bug just got fixed in #82. Leave it. |
| `CombatSystem.ts` | **Keep, edit** | Drop the hardcoded `weaponIdToName: string[]` array (line 28) — replace with a registry-derived lookup so adding weapons doesn't break it. The rest is solid (it's the FSM-to-ECS bridge). |
| `StaminaSystem.ts`, `HealthSystem.ts`, `HitboxSystem.ts`, `TracerSystem.ts`, `DamageSystem.ts` | **Keep** | All earn their place. The damage pipeline (#60) finally works end-to-end and is well-tested. |
| `AnimationSystem.ts` | **Keep, retune data** | The system itself is fine. The *poses* in `AnimationData.ts` produce mismatched / wrong-looking animations. Treat as a data tuning task, not a system rewrite. |
| `InventorySystem.ts` | **Keep, extend** | Already has `equipWeapon`, FSM-update, 3D-model swap, `EquipEvent`. Add `dropWeapon(eid) → worldItemEid`, `pickupWeapon(eid, worldItemEid)`, `addCurrency(eid, n)`, `spendCurrency(eid, n)`. |
| `PhysicsSystem.ts` | **Delete** | 31-LOC stub, no-op loop, marked TODO. Physics actually steps inline in `main.ts:245`. The stub is misleading — kill it, or make it real (see §3). |
| `DummyDamageObserver.ts` | **Delete** with the dummy | Couples ECS to the `FloatingDamage` HUD. Floating damage logic moves to a generic damage-event observer keyed on `Player`-tagged targets. |

### 2.3 `src/animation/`

| File | Decision | Why |
| --- | --- | --- |
| `AnimationData.ts` (416 LOC, third-person) | **Rewrite as data** | Pure pose data. Retune to fix mismatched animations. Keep the schema (`Pose`, `BoneRotation`, `CombatAnimation`). |
| `ViewmodelAnimationData.ts` (684 LOC, first-person) | **Delete for MVP, restore later** | First-person viewmodel is cut from MVP (see §2.6). When FP returns, regenerate this from third-person data with a per-weapon offset table — 684 LOC of hand-tuned per-weapon poses is not maintainable. |

### 2.4 `src/combat/`

| File | Decision | Why |
| --- | --- | --- |
| `CombatFSM.ts` | **Keep** | 448 LOC, pure TypeScript, no Three/Rapier/DOM imports, well-tested. The cleanest module in the repo. |
| `states.ts` | **Keep** | Const enums + label table. |
| `directions.ts` | **Keep** | Mouse-delta direction detection. Untested today — add a test file as part of the rewrite. |

### 2.5 `src/weapons/`

| File | Decision | Why |
| --- | --- | --- |
| `WeaponConfig.ts` registry | **Keep** | Auto-registration on import works. |
| Four weapon configs | **Keep** | Just retuned in #79. |
| Hardcoded `weaponIdToName` array in `CombatSystem.ts` | **Delete** | See §2.2. Replace with `Object.keys(weaponConfigs)` (stable insertion order) or an explicit registry-emitted ID table. |

### 2.6 `src/rendering/`

| File | Decision | Why |
| --- | --- | --- |
| `CameraController.ts` | **Keep** | FPS + debug third-person; turncap wired in #78. |
| `CharacterModel.ts` | **Rewrite, split** | 401 LOC, also contains `createLongswordModel` which conceptually belongs in `WeaponModels.ts`. Split: skeletal humanoid stays here, all weapon-mesh factories move to `WeaponModels.ts`. Also: investigate the **ground-hover bug** here (or in spawn `SPAWN_HEIGHT`) before rewrite — likely an off-by-one between collider half-height and mesh root. |
| `WeaponModels.ts` | **Keep, absorb longsword** | Becomes the single home for all weapon meshes. |
| `ViewmodelRenderer.ts` | **Delete for MVP** | 352 LOC, four corrective PRs (#57, #68, #70, #81), still listed as broken in #80. **Cut first-person from MVP and ship third-person only.** Reintroduce later as a separate slice once the rest of the game is stable. |
| `ViewmodelAnimationSystem.ts` | **Delete for MVP** | Pairs with `ViewmodelRenderer`. Removed together. |
| `DebugRenderer.ts`, `TracerDebugRenderer.ts` | **Keep** | Useful for the rebuild. |

### 2.7 `src/inventory/`

| File | Decision | Why |
| --- | --- | --- |
| `InventoryData.ts` + its test | **Delete** | Confirmed dead code. `InventoryPanel.ts` already imports from `ecs/systems/InventorySystem.ts`, not from this module. The whole `src/inventory/` directory can be removed. |

### 2.8 `src/input/`

| File | Decision | Why |
| --- | --- | --- |
| `InputManager.ts` | **Keep, edit** | The `_suppressClickToPlay` backdoor wired from `main.ts:160` is a code smell. Replace with a first-class `addPointerLockGate(predicate)` API so HUD overlays can register cleanly. |

### 2.9 `src/hud/`

| File | Decision | Why |
| --- | --- | --- |
| `HUD.ts`, `HealthBar.ts`, `StaminaBar.ts`, `DirectionIndicator.ts`, `DebugOverlay.ts`, `DebugNotification.ts`, `FloatingDamage.ts` | **Keep** | All small, focused, tested. |
| `InventoryPanel.ts` | **Keep, repurpose** | 389 LOC HTML/CSS overlay. Use it as the basis for the **shop UI** — it already does pointer-lock release, weapon-grid layout, equip flow. |
| `DummyHealthBar.ts` | **Delete** | Replaced by a generic enemy-health-overhead bar that reads `Health` for any non-local-player entity. |

### 2.10 `src/utils/`

| File | Decision | Why |
| --- | --- | --- |
| `math.ts` | **Keep** | Vector helpers. |

### 2.11 `src/main.ts` (god-wiring)

**Rewrite, split into bootstrap modules.** 323 LOC of imperative wiring is unmaintainable as the project grows, and impossible to share between client and server when networking lands. Suggested split:

```
src/bootstrap/
  client.ts        # Browser entry point — replaces main.ts
  game.ts          # Initializes World, all systems, the ECS pipeline
  loop.ts          # GameLoop wiring (fixedUpdate / update / render lambdas)
  debugBindings.ts # T/Y/J/K/console-window keybinds (dev-mode only)
```

The dev-only console hooks (`window.setWeapon`, `window.getInventory`) and the dummy keybinds gate behind a `import.meta.env.DEV` flag.

---

## 3. Proposed directory layout (post-rework)

```
src/
├── bootstrap/        # NEW — entry points + game-loop wiring (replaces main.ts)
├── core/             # GameLoop, World, types         (mostly unchanged)
├── ecs/
│   ├── components.ts # Unified CombatState component
│   ├── systems/      # All current keepers, minus PhysicsSystem stub
│   └── entities/     # createPlayer, createArena, NEW: createWeaponPickup, createShopkeep
├── animation/        # AnimationData.ts only (viewmodel data deleted for MVP)
├── combat/           # FSM, states, directions        (unchanged)
├── weapons/          # WeaponConfig + 4 configs       (unchanged)
├── input/            # InputManager with pointer-lock-gate API
├── rendering/        # CameraController, CharacterModel, WeaponModels, debug renderers
│                     # NO ViewmodelRenderer for MVP
├── world/            # NEW — non-combatant world entities
│   ├── pickups.ts    # weapon-drop / weapon-pickup logic
│   └── shopkeep.ts   # shopkeep entity + interaction radius
├── economy/          # NEW — currency component + shop transactions
│   ├── Currency.ts
│   └── ShopTransaction.ts
├── net/              # NEW — networking layer (see §5)
│   ├── client.ts
│   ├── protocol.ts   # Message schema (shared with server)
│   └── replication.ts
├── hud/              # All current HUD bars + repurposed shop UI (was InventoryPanel)
└── utils/            # math.ts
```

**Server**, when it lands, lives in `server/` at the repo root and shares `src/combat/`, `src/weapons/`, `src/ecs/components.ts`, and `src/net/protocol.ts` with the client. Everything that affects gameplay decisions runs on the server; clients run prediction copies.

---

## 4. Architectural decisions worth flagging

### 4.1 Cut first-person viewmodel from MVP
The viewmodel has been rewritten or patched four times (#57, #68, #70, #81) and is still in the "doesn't move right" bug list (#80). **Ship third-person only for MVP.** Reintroduce FP as a post-MVP slice once everything else is stable. This frees ~1,200 LOC of fragile code (`ViewmodelRenderer.ts` + `ViewmodelAnimationSystem.ts` + `ViewmodelAnimationData.ts`) plus its test surface.

### 4.2 Unify the two combat-state components
`CombatStateComponent` and `CombatStateComp` carry the same FSM state in two different shapes, kept in sync by `CombatSystem.computePhaseTotal()`. Pick the superset (`state`, `direction`, `phaseElapsed`, `phaseTotal`, `weaponId`, `ticksRemaining`) and migrate all readers. AGENTS.md has flagged this as debt for two PRs running.

### 4.3 Drop the hardcoded `weaponIdToName` array
`CombatSystem.ts:29` declares `weaponIdToName: string[] = ['Longsword','Mace','Dagger','Battleaxe']` as the source of truth for numeric weapon IDs. The weapons-registry insertion order in `weaponConfigs` is the *real* source of truth. Make that explicit — the array becomes a derived view, or the registry emits IDs.

### 4.4 Authoritative-server networking, not P2P
For 2-player melee where hits matter to centimeters and milliseconds, an **authoritative dedicated server** is the only model that produces fair outcomes. WebRTC P2P with one client as authority is cheaper to host but introduces host-advantage that will be visible in directional-block reads. Recommend Node + `ws` (raw WebSocket) for the MVP server, with the same fixed-timestep loop as the client. Wire format: binary (msgpack or hand-rolled) for hot path, JSON for shop/lobby. **Open question for the next architect issue:** whether to ship rollback prediction on day one or accept simple input-replay-with-snap-back. For 60Hz ticks and ~50ms round-trip, snap-back is acceptable; rollback is post-MVP.

### 4.5 Currency model
Simplest viable: each kill drops `N` coins as a world pickup (separate from the weapon drop). Coins go to whoever picks them up. Shop prices in the same coin unit. No currency component needed on entities — coins live as world entities until pickup, then increment a `Wallet` component on the player. Drop on death too, so dying drains your wallet.

### 4.6 Pickup interaction model
**Auto-pickup on collision** (Mordhau / shooter convention) for MVP. Saves us from designing an interaction system and "press E to pick up" prompt. Shopkeep interaction is the *only* button-prompted interaction.

### 4.7 Animation: data tuning, not system rewrite
Reports of "wrong / mismatched animations" are pose-data problems in `AnimationData.ts`, not bugs in `AnimationSystem.ts`. Treat the rebuild as an animator/designer task: re-tune the pose tables. Optionally introduce a hot-reload dev tool so iteration doesn't require a build cycle.

### 4.8 Ground-hover bug
Player and dummy hover above the floor. The likely cause is a half-height mismatch between the Rapier capsule collider and the mesh root, or `SPAWN_HEIGHT` not accounting for collider radius. Fix as part of the `CharacterModel.ts` split — they're related.

---

## 5. Sequencing across the architect issues

This issue (#85) is the umbrella. Future architect-filed issues should land roughly in this order. Each row is one architect issue (which then fans out into dev sub-issues).

| Order | Theme                                            | Blocks                          | Why now                                                     |
| ----- | ------------------------------------------------ | ------------------------------- | ----------------------------------------------------------- |
| **1** | **Cleanup pass** — delete dead code, unify combat-state components, kill the hardcoded weapon-id array, kill `PhysicsSystem` stub, kill `src/inventory/`, kill `IsPlayer` alias, refactor `main.ts` into `bootstrap/` | Everything below | Each subsequent slice is cheaper if the baseline is sane. No new behaviour, no risk to gameplay. |
| **2** | **Cut first-person viewmodel** — delete `ViewmodelRenderer.ts`, `ViewmodelAnimationSystem.ts`, `ViewmodelAnimationData.ts` and the related render passes in `bootstrap/loop.ts` | Animation work, networking | Removes 1,200 LOC of fragile code. Has to happen before animation retuning so we're not tuning two systems at once. |
| **3** | **Fix grounding & retune third-person animations** — solve the ground-hover bug, retune `AnimationData.ts` pose tables | Visible polish for everything else | Until the player looks right standing still and walking, animation regressions in combat states are impossible to spot. |
| **4** | **Inventory loop primitives** — `dropWeapon`, `pickupWeapon`, `Wallet` component, `createWeaponPickup`, `createShopkeep`, shop UI from repurposed `InventoryPanel` | Networking (the things to replicate) | Build the singleplayer loop first: kill the dummy, weapon drops, walk over it, pick it up, walk to shopkeep, buy a weapon. Once this works locally, networking has a clear surface to replicate. |
| **5** | **Networking foundation** — Node WebSocket server, shared protocol module, snapshot replication, lobby & arena join flow, spawn/respawn, scoreboard | MVP ship | Last because every prior slice tightens the surface that has to be replicated. |
| **6** | **MVP polish & ship** — match flow (round end, reset), edge cases (disconnect mid-trade, dropped-weapon GC), smoke testing | — | Final pass. |

### Critical path
The shortest valid path from today to MVP is **1 → 2 → 4 → 5 → 6**. Step 3 (animation retuning) is parallelizable with steps 4 and 5 — it's polish, not a blocker for the gameplay loop. The architect filing the next issue should choose whether to launch step 3 in parallel with step 4 or hold it until later.

### What this doc deliberately does not specify
- Exact wire format for net messages (decided in step 5's planning).
- Server hosting topology (single dedicated process? per-match instance? Decided when networking is scoped).
- Exact prices / coin drop amounts (data tuning, not architecture).
- Whether to keep Rapier on the server (likely yes, but worth re-examining when the server is scoped — the FSM and tracer tests don't all need physics).

These belong in their respective architect issues, not here.

---

## 6. References to current code (line-anchored)

For the next architect to find things quickly:

- God-wiring entry point: `src/main.ts` (323 LOC).
- Hardcoded weapon-id array: `src/ecs/systems/CombatSystem.ts:29`.
- Pointer-lock backdoor: `src/main.ts:160` reading `inventoryPanel.isOpen` via `input._suppressClickToPlay`.
- `PhysicsSystem` stub: `src/ecs/systems/PhysicsSystem.ts` (31 LOC, no-op).
- Dead inventory module: `src/inventory/InventoryData.ts` + its test.
- `IsPlayer` alias: `src/ecs/components.ts:45`.
- The two combat-state components: `src/ecs/components.ts:92` (`CombatStateComponent`) and `:167` (`CombatStateComp`).
- Multi-pass render workaround: `src/main.ts:299–313` (the `scene.background = null` dance — goes away when viewmodel is cut).
- Spawn-height constant: `src/core/types.ts` (`SPAWN_HEIGHT`) — likely related to the ground-hover bug.

---

*Authored 2026-05-08 in response to #85. Update this doc only via a follow-up architect issue, not in passing.*
