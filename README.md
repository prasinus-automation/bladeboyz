# BladeBoyz

Browser-based multiplayer melee combat game with an ultra-low-poly BattleBit-style aesthetic and Mordhau/Chivalry-inspired directional combat mechanics. Built with Three.js, Rapier3D physics, and a bitECS entity-component-system architecture.

Currently in the scaffolding phase: single player, **Arena v1** with training dummies, no networking yet. The combat system features tracer-based hit detection (swept-volume collision along the blade), directional attacks and blocks, a parry/riposte system, and data-driven weapon configurations. Players can open an inventory overlay to swap between unlocked weapons mid-session.

## Getting Started

```bash
git clone <repo-url>
cd bladeboyz
npm install          # Install dependencies
npm run dev          # Start Vite dev server with HMR (http://localhost:5173)
```

## Build

```bash
npm run build        # Production build (type-checks first)
npm run preview      # Preview production build locally
```

## Controls

### Movement
| Key | Action |
|-----|--------|
| **W/A/S/D** | Move forward/left/back/right |
| **Mouse** | Look around (requires pointer lock) |
| **Shift** | Sprint |
| **Ctrl** | Crouch |
| **Space** | Jump |
| **Click** | Lock mouse pointer (required for mouse look) |

### Combat
| Input | Action |
|-------|--------|
| **LMB (Left Click)** | Attack — direction determined by mouse movement before click |
| **RMB (Right Click)** | Block — hold to block in current direction; tap during incoming attack for parry |
| **Mouse Movement** | Controls attack/block direction (left, right, overhead, underhand, stab) |

Attacks deal damage to enemies on hit. Floating damage numbers appear above the target showing the amount dealt. Damage varies by attack direction and which body part is struck (head, torso, or limbs).

A **directional crosshair indicator** surrounds the center of the screen, previewing your current attack/block direction in real time as you move the mouse. It turns **red** during attacks (Windup/Release) and **blue** while blocking. A center ring indicates a stab direction.

In first-person mode, a **viewmodel** renders your right arm and equipped weapon in front of the camera, giving visual feedback on your current weapon and combat state. The viewmodel arm is **bone-driven** (skeletal hierarchy: upper arm → forearm → hand → weapon attach) and animated by the **ViewmodelAnimationSystem**, which reads the player's `CombatStateComp` each frame. The shoulder anchor sits at-or-below the camera eye line so the arm hangs into the lower-right of the viewport (rebuilt in #81 — previously the shoulder sat above the camera and clipped into the top of the screen). Every weapon has unique first-person poses for all attack directions (left, right, overhead, underhand, stab × windup/release/recovery), all block directions, parry, stunned, and hit-stun states. Pose transitions use **quaternion slerp crossfade** (~80ms blend duration), matching the world animation system's blending approach. A subtle idle sway (sinusoidal bob on the hand bone) adds life when no combat action is active.

### Inventory
| Key | Action |
|-----|--------|
| **I** | Toggle inventory overlay (weapon selection & equipment) |

> While the inventory is open, mouse look and combat inputs are paused. Close with **I** or **Escape** to resume gameplay.

### Interaction
| Key | Action |
|-----|--------|
| **E** | Interact (when prompt shown) — open the shop near the shopkeep, or pick up a nearby weapon |

> A **shopkeep NPC** stands behind the wood counter in the SW corner of the arena (around `(-12, _, 13)`). Walk close enough and a "Press [E] to shop" prompt appears above their head; pressing **E** opens the shop overlay.

### Weapon pickups

Killed combatants drop their equipped weapon to the ground (the permanent **starter weapon** is never dropped — see #94). Pickups are visible from a distance: they lie flat, gently spin, and bob slightly above the ground.

| Behaviour | Detail |
|-----------|--------|
| **Pickup radius** | 1.5 m (3D Euclidean from player feet to pickup) |
| **Despawn timer** | 30 s after spawn |
| **Blink/fade warning** | Last 5 s before despawn — opacity ramps `1.0 → 0.3` and the model blinks at ~10 Hz |
| **Pickup gate** | Player FSM must be in **Idle** (you can't loot mid-swing) |
| **Effect** | Picking up a weapon adds it to the inventory and equips it in place of the current weapon |

When a pickup is in range, a centred prompt reads *"Press [E] to pick up `{Weapon}`"*. If multiple pickups are in range, the closest one is shown.

> The visual layer (orientation, spin, fade, prompt) is implemented in #127. The behaviour layer (drop on death, pickup consumption, despawn timer) lands in #121.

### Shop

A simple HTML overlay listing the four base weapons (Dagger, Mace, Longsword, Battleaxe) with their stats, gold price, and a Buy button. The header shows the **Shopkeep — Wares** title and the player's live gold balance.

| Key / Click | Action |
|-------------|--------|
| **E** (near shopkeep) | Open the shop overlay |
| **Escape** / **X** / click outside | Close the shop |
| **Click "Buy"** | Purchase the weapon — deducts gold, adds it to inventory, equips it |

Each row shows:

- **Name** — with an "(equipped)" tag and a green border on the currently equipped weapon
- **Stats** — average damage (head/torso/limb), reach in metres, mean swing time in ms, and stamina cost per attack
- **Price** — gold cost, `FREE` for the starter Dagger, or `Not for sale` if the weapon has no price entry
- **Buy** — the button is disabled and shows `Owned` if you already have it, `Not enough gold` if your balance is too low, otherwise the button reads `Buy`

#### Purchase atomicity

Purchases go through `purchaseWeapon()` in [`src/economy/PurchaseFlow.ts`](src/economy/PurchaseFlow.ts). The function validates **every** precondition first (price exists, not already owned, sufficient gold, FSM is `Idle`) and only then mutates wallet + inventory + equipped weapon as a single batch. On any failure (`{ ok: false, reason }`), nothing changes — gold balance unchanged, inventory unchanged. The result type is the surface that becomes server-authoritative when networking lands; the client `purchaseWeapon` and the future server `purchaseWeapon` will share identical validation order so the migration is mechanical.

Shop prices are temporary scaffolding — they live in `src/economy/Prices.ts` and will be tuned alongside the full gold-currency design (issue #95) when earning loops, persistence, and balancing land.

#### Dev console

```js
window.openShop()    // Open the shop without walking to the NPC
window.closeShop()   // Close it (Escape also works)
```

The shop releases pointer lock and pauses input on open, the same way the inventory does. The inventory and shop are mutually exclusive — opening one closes the other so neither fights over pointer-lock state.

### Training Dummy Controls
| Key | Action |
|-----|--------|
| **T** | Toggle dummy block (idle ↔ blocking) |
| **Y** | Cycle dummy block direction (Top → Bottom → Left → Right) |
| **J** | Spawn additional training dummy |
| **K** | Reset all dummies (full health, idle state) |

### Debug Controls
| Key | Action |
|-----|--------|
| **F1** | Toggle wireframe rendering |
| **F2** | Toggle Rapier physics debug lines |
| **F3** | Toggle hitbox wireframe visualization |
| **F4** | Toggle FSM state overlay (shows combat state, HP, stamina per entity) |
| **F5** | Toggle first-person / third-person camera |
| **F6** | Toggle tracer debug lines |
| **F7** | Toggle viewmodel diagnostic mode (per-bone axes + on-screen pose readout) |

You can also start the page with `?debug-viewmodel=1` in the URL to enable the
viewmodel diagnostic mode at boot — F7 still toggles it at runtime.

### Console Commands
Open the browser dev console (`F12`) and use:
```js
window.setWeapon('Longsword')    // Swap weapon by name
window.setWeapon('Dagger')
window.setWeapon('Mace')
window.setWeapon('Battleaxe')

window.openShop()                // Open the shopkeep overlay (also bound to E near the NPC)
window.closeShop()               // Close the shop panel

window.__debugInput = true       // Log every keydown/keyup with paused state
window.__debugInput = false      // Disable
```

### Troubleshooting Movement
If WASD doesn't seem to work:

1. **Click the canvas first** — pointer lock must be acquired for full input. The "Click to Play" overlay disappears once locked.
2. **Verify the canvas has focus** — the `InputManager` constructor sets `tabindex="0"` on the canvas and auto-focuses it on pointer lock so keyboard events route reliably even under pointer lock.
3. **Enable input logging** — set `window.__debugInput = true` in the console, then press WASD. You should see `[InputManager] keydown KeyW paused? false` for each key. If `paused?` is `true`, an inventory or other overlay is blocking input.
4. **Hard refresh** if Vite HMR seems to have left stale event listeners (`Ctrl+Shift+R`).

### Movement Architecture

WASD does not move the player directly. The flow is **InputManager → InputSystem → MovementIntent → MovementSystem → Rapier**:

- `InputSystem` (fixed tick) reads raw keys + camera yaw and writes a normalized world-space `MovementIntent` (moveX/moveZ + sprint/crouch/jumpRequested edge flag) to each `Player` entity.
- `MovementSystem` consumes `MovementIntent`, applies acceleration ramp + sprint/crouch multipliers, integrates `MovementState.verticalVelocity` for gravity/jump, and feeds the result through Rapier's **kinematic character controller** (capsule collider).
- The character controller handles slope climbing (≤45°), slope sliding (≥30°), autostep (max height 0.3m), and snap-to-ground (0.3m). See `src/core/types.ts` for tuning constants.

This split is the seam where future AI / network controllers plug in — they write `MovementIntent` directly without ever touching the keyboard.

### Spatial Conventions

All character ECS `Position` values represent the entity's **feet** (point of contact with ground). The character mesh's root bone is at y=0 in local space, so `meshGroup.position = ECS Position` with NO offset.

Capsule colliders are offset upward inside the body via `ColliderDesc.capsule(...).setTranslation(0, R+H, 0)` so the bottom hemisphere sits at the body origin (= feet). This applies uniformly to the player and to training dummies.

Spawn Y is resolved by `spawnAtGround(world, x, z)`, which raycasts down from `(x, 50, z)` and returns the surface hit + a small `CHARACTER_CONTROLLER_OFFSET` epsilon. Entity factories never hard-code Y. The arena ground top is at `y = GROUND_TOP_Y = 0.1` (a 30×0.2×30 cuboid centered at origin in Arena v1).

## Weapons

All weapons are data-driven via `WeaponConfig` objects — damage, timing, turncaps, and tracer geometry are defined in config, not hardcoded in systems. Swap weapons at runtime through the inventory overlay (**I** key) or the console.

| Weapon | Range | Speed | Damage (head/torso/limb) | Stamina | Parry rec. / Block-break stun (ticks) | Style |
|--------|-------|-------|--------------------------|---------|----------------------------------------|-------|
| **Longsword** | 1.4 | Fast | 45–55 / 35–40 / 20–25 | 15 | 12 / 30 | Balanced all-rounder. Good reach and moderate speed. Reliable across all directions. |
| **Dagger** | 0.35 | Very Fast | 22–25 / 16–18 / 10–12 | 8 | 8 / 24 | Lightning-fast but short range. Low stamina cost lets you combo freely. |
| **Mace** | 0.6 | Slow | 42–55 / 30–40 / 20–25 | 18 | 14 / 36 | Heavy blunt weapon. High stun duration (68 ticks) punishes failed parries. |
| **Battleaxe** | 1.2 | Very Slow | 55–75 / 40–55 / 28–35 | 24 | 16 / 42 | Devastating damage but long windups. Overheads deal up to 75 head damage. |

*Damage ranges show min–max across attack directions (overhead, left, right, stab — the FSM v2 unified `Direction` enum, #139, dropped the v1 `Underhand`). Actual damage depends on attack direction and body region hit.*

*`Parry rec.` is how long the Parry pose locks before returning to Blocking (ticks). `Block-break stun` is the stagger applied when a blocker's stamina hits zero mid-block. Both are per-weapon as of FSM v2 (issue #131); the v1 module-level `BLOCK_BREAK_STUN_TICKS = 30` constant is still used by `StaminaSystem` until the FSM v2 wiring lands. Every weapon also has a `turncap.hitStun` of 0.005 rad/tick — the stagger almost completely locks your aim.*

## Gold & Shop

The player starts with a small purse of **200 gold** and only the **Dagger** equipped. Other weapons (Mace, Longsword, Battleaxe) must be purchased from the shopkeep — the inventory no longer starts populated with every weapon. Gold prices live in `src/economy/Prices.ts` (Mace 100, Longsword 150, Battleaxe 200) and the balance lives in a small in-memory `Wallet` module at `src/economy/Wallet.ts`. A **gold counter HUD** appears at the top-right of the screen and updates whenever the balance changes; it pulses briefly on each change.

To shop, walk up to the shopkeep NPC and press **E** — see [Shop](#shop) above for the full UX. Purchases are atomic: gold is only deducted on success, and a successful purchase adds the weapon to inventory and equips it in one step.

The wallet is intentionally minimal scaffolding for the shop feature — earning gold from kills, persistence across sessions, and networked reconciliation belong to the full Gold currency design (issue #95) and are deliberately out of scope here.

## Combat System

BladeBoyz uses a **directional melee combat system** inspired by Mordhau and Chivalry:

### Directional Attacks & Blocks
Mouse movement before clicking determines your direction — sweep left for a left swing, sweep right for a right swing, push up for an overhead, or hold steady (or push down) for a stab. FSM v2 (issues #131 + #139) collapses the v1 split `AttackDirection` (5 values) and `BlockDirection` (4 values) into a single unified `Direction` enum with **four values** (`Overhead`, `Left`, `Right`, `Stab`) shared by attacks and blocks. The old `Underhand` swing folded into `Stab`, and `Block(dir)` now defends the **same** incoming `dir` (holding `Direction.Left` blocks an incoming `Direction.Left` slash — v1's opposed-pair scheme is gone). Direction is sampled at click time from a 100 ms rolling mouse buffer rather than the single-frame delta — quick post-click flicks no longer steal the swing direction.

### Parry
Tapping block just as an attack lands triggers a **parry**: the parry window is the first `weapon.parryWindow` ticks of `Blocking` (matching-direction only). A successful parry locks the parrier into a brief `Parry` pose for `weapon.parryRecovery` ticks, then drops back to `Blocking` if you keep holding RMB (or `Idle` if you release). The attacker is staggered into `HitStun` for `weapon.parryStunTicks` (40–75 ticks depending on weapon). FSM v2 (#135) cut the v1 `Riposte` state — there's no dedicated post-parry counter-swing; the agility advantage is the uncapped `Parry` turncap (free aim while the attacker is stunned).

### Stamina
Every action costs stamina: attacking, blocking, parrying. Blocking drains stamina based on the attacker's weapon weight (8–30 per block). Running out of stamina leaves you unable to block. (The legacy `Feint` action was removed in FSM v2, so weapon configs no longer specify a `staminaCost.feint` value — the field stays optional in the type for a future re-add.)

### Tracer-Based Hit Detection
Instead of simple raycasts, weapons define **tracer points** along the blade. During the Release phase, the system performs swept-volume collision tests between each tracer point's position on the current and previous ticks. This creates realistic hit detection that respects the actual arc of the weapon swing — edge alignment matters.

Hits are resolved against **hitbox sensor colliders** attached to the target's skeleton bones (head, torso, arms, legs). Damage scales by body region: headshots deal full damage, torso is reduced, limbs take the least.

## Spawn / Death / Respawn

BladeBoyz runs as a **continuous deathmatch** — there are no rounds. When a player's HP hits 0 they enter a `Dead` state for **3 seconds (180 ticks)**, during which input and movement are frozen and a death screen will be shown (HUD landing in a follow-up). After the timer expires the player respawns at a weighted-random spawn point and is auto-equipped with the default starter weapon (**Longsword**).

Death is implemented as two ECS components plus an event bus:
- `DeadTag` — added to the entity for the duration of the death state. Systems early-out on this tag.
- `RespawnPending.ticksRemaining` — countdown synced into ECS so the future networking layer can replicate per-entity remaining time.
- `EventBus` (`src/events/EventBus.ts`) — pub/sub for `DamageDealt`, `DeathEvent`, `RespawnEvent`, `WeaponEquipped`. Drained at the end of `fixedUpdate`.

Kill attribution uses a 5-second window: the most recent attacker who damaged the victim within that window is credited as the killer (`killerEid = 0` for environmental / suicide). See [`docs/spawn-death-respawn.md`](docs/spawn-death-respawn.md) for the full lifecycle, state diagram, and event payload table.

### Spawn-Point Registry

Spawn points live in `src/world/SpawnPoints.ts` as a `Map<id, SpawnPoint>`. Each entry is `{ id, position: { x, y, z }, yaw }` — feet-position + facing direction in radians. `selectSpawnPoint({ enemies, minEnemyDistance?, random? })` picks a point weighted away from live combatants:

1. Empty registry → `null` (caller logs and skips).
2. No enemies → uniform random across all candidates.
3. Otherwise filter to `distToNearestEnemy ≥ minEnemyDistance` (default `8.0`); uniform random over the safe set.
4. If no candidate is safe, return the candidate that's furthest from its nearest enemy (max-min fallback, so a packed arena still respawns the player).

Both initial spawn (`createPlayer`) and post-death respawn (`processRespawns`) consult this registry — the only difference is initial spawn passes an empty enemies list. The arena (`src/arena/createArena.ts`) is the sole producer of registry entries: it `clearSpawnPoints()` first, then registers the six arena-defined points (S1..S6 from the design doc). The legacy `seedPlaceholderSpawnPoints()` helper is no longer wired in production — it's kept around for unit tests that need a registry without spinning up an arena.

## Animation

Skeletons are driven by a **layered procedural animation system** keyed off `CombatStateComp` (FSM read-model) and the `MovementState` ECS component. Issue #128 rebuilt the system from the ground up — every change visible to the eye now reads as `f(phaseT)`, frame-rate independent and free of the legacy "exponential settling" bug.

### Layered composition

Each tick, exactly **one** layer writes each bone — no shared writers, no fixed-ratio blends. The three layers are:

1. **Movement (lower-body procedural)** — drives `thigh_L/R`, `shin_L/R`, `foot_L/R` from a sinusoidal walk/run cycle keyed off `MovementState.speedFactor`. Always active.
2. **Combat (upper-body keyframe + arc)** — drives `shoulder_L/R`, `upper_arm_L/R`, `forearm_L/R`, `hand_L/R`, `chest`, `neck`, `head` and (sometimes) `spine`. Active in every state — `Idle` runs the "ready stance" `IDLE_POSE`, the rest of the FSM runs their respective keyframe poses, with `Release` swapped for an arc-driven swing.
3. **Idle arm-swing (upper-body procedural)** — overrides `shoulder_L/R` with a counter-swing of the gait cycle when `state === Idle && speedFactor > IDLE_SPEED_FACTOR_THRESHOLD`.

Spine ownership follows a small precedence rule: combat owns it iff the combat pose has a `spine` entry, else movement owns it iff the movement base pose has one, else it stays at rest. This replaces the legacy 60/40 spine blend (`AnimationSystem.ts:294-303` pre-rebuild) which drifted as the layers changed.

### Hybrid pose strategy

- **Keyframe slerp** (Idle, Blocking, Parry, HitStun, Windup, Recovery): on every state-or-direction transition the system snapshots each bone's current quaternion into a per-entity side-table (`prevPoseSnapshots`); each frame the bone is `slerp(snapshot → targetPose, smoothstep(max(phaseT, crossfadeT)))`. Slerping from the **snapshot** (not from `bone.quaternion` live) is the bug fix that gives proper phase-progress motion instead of the old exponential settling.
- **Arc-driven swing** (Release only): the right arm's `shoulder_R / forearm_R / hand_R` follow an explicit per-direction arc (`src/animation/arcSwing.ts`) — Euler-angle endpoints lerped by `phaseT`. The arc swing slerps from the snapshot using `smoothstep(crossfadeT)` only (since the target moves with `phaseT`, double-blending would visually drag).

### Hit-react lean

When a hit lands, `DamageSystem` writes a `HitReactComp` carrying a target-body-local push direction + magnitude + spawn tick. While `state === HitStun && HitReactComp.active === 1`, the animation system overlays a directional spine + chest tilt that peaks at ~30° around `t = 0.3` and decays to 0 by `t = 1`. The overlay is multiplied **on top** of the static `HITSTUN_POSE` (`bone.quaternion.multiply(reactQuat)`) so the layers compose cleanly.

### Shared blend pipeline

The slerp loop lives in `src/animation/poseBlending.ts` so both the third-person `AnimationSystem` and the first-person `ViewmodelAnimationSystem` (issue #D) can share it — no more independently-buggy copies of the same code in two files. The full architecture spec is at [`docs/animation-architecture.md`](docs/animation-architecture.md).

## Test Arena (Arena v1)

The world is a single 30×30 m arena built code-first from `src/arena/createArena.ts` — no glTF, no JSON map files. Layout (top-down, +X = east, −Z = north):

- **Ground plane** — 30 × 0.2 × 30 olive-green floor; top surface at `y = 0.1` (matches `GROUND_TOP_Y`).
- **Perimeter walls** — four 2 m-tall warm-grey walls forming a closed playspace at `x = ±15.25` and `z = ±15.25`.
- **Cover pillars** — two 2 × 3 × 2 m light-grey pillars at `(±5, 0)` that break sightlines through the central killing floor.
- **Shopkeep stall** — a 3 × 1 × 0.5 m wood-brown counter at `(-12, 0, 12)` plus a 0.5 × 3 × 4 m back wall at `(-13.25, 0, 12)`. The Shopkeep NPC stands at `(-12, 0.1, 13)`, behind the counter, facing north into the arena.
- **6 spawn points (S1..S6)** — two on the E-W axis (`S1 = (-13, 0)`, `S4 = (13, 0)`) and four interior points mirror-symmetric across `z = 0` (`S2/S3` north, `S5/S6` south). All spawn yaws face the arena center.

Every visible prop has a matching Rapier static (`RigidBodyType.Fixed`) cuboid collider with identical extents — if you can see it, you collide with it. The arena's `ArenaSpec` (returned by `createArena()` and stored on `world.arena`) exposes `spawnPoints`, `bounds`, `shopkeepStall.{counter, npcAnchor, facing}`, and `weaponPickupSafeVolume` for systems (spawn, weapon-pickup, shopkeep AI) to query. The full design — including dimensions tables and spawn-point yaw values — lives in [`docs/arena-v1.md`](docs/arena-v1.md).

## Testing

```bash
npm test             # Run test suite (Vitest)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run lint         # ESLint
```

## Tech Stack

- **TypeScript** — strict mode, ES2022 target
- **Three.js** ^0.170.x — 3D rendering (flat-shaded low-poly, no textures)
- **Rapier3D WASM** — physics engine (kinematic bodies, sensor colliders for hitboxes)
- **bitECS** — lightweight entity-component-system (ArrayBuffer-backed, numbers only)
- **Vite** ^6.x — build tool with HMR
- **Vitest** — test framework (jsdom environment)

## Project Structure

```
src/
├── main.ts                  # Entry point — initializes world, wires systems, starts game loop
├── core/
│   ├── GameLoop.ts          # Fixed-timestep game loop (60Hz fixed + variable render)
│   ├── World.ts             # Creates ECS world, Three.js scene, Rapier physics world
│   └── types.ts             # Shared type definitions and constants
├── ecs/
│   ├── components.ts        # All bitECS component definitions + lookup registries
│   ├── systems/
│   │   ├── InputSystem.ts       # Raw input → MovementIntent (the AI/network seam)
│   │   ├── MovementSystem.ts    # Consumes MovementIntent, drives Rapier character controller
│   │   ├── CombatSystem.ts      # Combat FSM tick, input handling, state sync
│   │   ├── InventorySystem.ts   # Weapon equip/swap logic (3D model, FSM, ECS sync)
│   │   ├── HitboxSystem.ts      # Creates & syncs hitbox sensor colliders to skeleton bones
│   │   ├── TracerSystem.ts      # Swept-volume hit detection during weapon release phase
│   │   ├── DamageSystem.ts      # Processes damage events (block/parry/hit resolution)
│   │   ├── HealthSystem.ts      # Health management, death detection, respawn timer (180 ticks)
│   │   ├── processDeaths.ts     # Death-cleanup hook: DeathEvent, score, FSM reset, weapon drop
│   │   ├── processRespawns.ts   # Respawn-cleanup hook: teleport, restore HP/stamina, equip starter
│   │   ├── StaminaSystem.ts     # Stamina drain/regen based on combat actions
│   │   ├── AnimationSystem.ts   # Procedural pose blending from combat state
│   │   ├── PhysicsSystem.ts     # Rapier physics step
│   │   └── DummyDamageObserver.ts  # Floating damage numbers for training dummies
│   ├── entities/
│   │   ├── createPlayer.ts      # Player entity factory (mesh, kinematic body, MovementIntent)
│   │   ├── createDummy.ts       # Training dummy factory (mesh, fixed body, capsule)
│   │   └── createWeaponPickup.ts # Ground weapon pickup factory (#109, foundation for #94)
│   └── utils/
│       └── spawnAtGround.ts     # Raycast-down feet-Y resolver (used by all entity factories)
├── arena/
│   ├── types.ts                 # ArenaSpec, SpawnPoint, ShopkeepStallSpec, Volume3D
│   └── createArena.ts           # Code-authored Arena v1: lights, 9 static props, 6 spawn points (#112)
├── world/
│   └── SpawnPoints.ts           # Spawn-point registry + selectSpawnPoint() (placeholder seeds until #91)
├── combat/
│   ├── CombatFSM.ts         # Combat state machine (11 states, data-driven transitions)
│   ├── states.ts            # CombatState enum (Idle, Windup, Release, Block, etc.)
│   └── directions.ts        # Attack/block direction detection from mouse input
├── weapons/
│   ├── WeaponConfig.ts      # WeaponConfig type + registry
│   ├── longsword.ts         # Longsword weapon data (auto-registers on import)
│   ├── mace.ts              # Mace weapon data (auto-registers on import)
│   ├── dagger.ts            # Dagger weapon data (auto-registers on import)
│   └── battleaxe.ts         # Battleaxe weapon data (auto-registers on import)
├── input/
│   ├── InputManager.ts      # Keyboard, mouse, pointer lock, rolling delta buffer
│   ├── InputManager.types.ts # Target interface contract (#102 spec)
│   └── keybinds.ts          # DEFAULT_KEYBINDS map (action → KeyboardEvent.code)
├── rendering/
│   ├── CameraController.ts  # FPS + third-person orbit camera
│   ├── CharacterModel.ts    # Procedural low-poly character mesh + bone skeleton
│   ├── WeaponModels.ts      # Procedural weapon mesh factories (per-weapon geometry)
│   ├── ViewmodelRenderer.ts # First-person viewmodel (right arm + weapon, Layer 1)
│   ├── ViewmodelAnimationSystem.ts # Viewmodel bone animation (reads CombatStateComp)
│   ├── DebugRenderer.ts     # F1-F4 debug toggles (wireframe, physics, hitboxes, FSM)
│   └── TracerDebugRenderer.ts  # Tracer sweep line visualization
├── animation/
│   ├── AnimationData.ts     # Combat pose definitions + bone sets
│   ├── ViewmodelAnimationData.ts # Per-weapon first-person viewmodel poses
│   ├── poseBlending.ts      # Shared slerp pipeline (applyPoseLayer, smoothstepEase) — #128
│   ├── arcSwing.ts          # Per-direction arc-swing pose computation (Release phase) — #128
│   └── hitReact.ts          # Directional stagger lean overlay during HitStun — #128
├── inventory/
│   ├── InventoryData.ts     # Legacy side-table (dead code — see AGENTS.md)
│   └── PickupRegistry.ts    # Side-table for ground weapon pickups (#109, foundation for #94)
├── economy/
│   ├── Wallet.ts            # In-memory gold balance + onGoldChange pubsub (#107)
│   ├── Prices.ts            # weaponPrices side-table + getWeaponPrice (#107)
│   └── PurchaseFlow.ts      # Atomic validate-then-mutate purchaseWeapon API (#123)
├── hud/
│   ├── HUD.ts               # HUD manager (health, stamina, debug, direction indicator)
│   ├── HealthBar.ts         # Player health bar
│   ├── StaminaBar.ts        # Player stamina bar
│   ├── InventoryPanel.ts    # Inventory overlay UI (weapon selection & gear slots)
│   ├── ShopPanel.ts         # Shopkeep overlay — weapon list + Buy buttons (#123)
│   ├── GoldCounter.ts       # Top-right gold balance HUD (#107)
│   ├── FloatingDamage.ts    # Floating damage numbers (3D→2D projected HTML)
│   ├── DummyHealthBar.ts    # Floating health bars above training dummies
│   ├── WorldLabel.ts        # World-anchored HTML overlay (shopkeep nameplate + prompt)
│   ├── DebugOverlay.ts      # FPS counter, position, movement state (top-left)
│   ├── ViewmodelDebugOverlay.ts # Bottom-left bone/state readout for --debug-viewmodel (#122)
│   └── DebugNotification.ts # Brief toast notifications for toggle states
└── utils/
    └── math.ts              # Vector utilities, interpolation helpers
```

## Documentation

Design docs and architecture specs live in [`docs/`](docs/):

- [`docs/MVP.md`](docs/MVP.md) — Foundation rebuild roadmap (#85)
- [`docs/gold-currency.md`](docs/gold-currency.md) — Gold currency design (#95)
- [`docs/input-pipeline.md`](docs/input-pipeline.md) — Input pipeline architecture (#102)

## Architecture Notes

- **ECS-first**: everything is an entity with composable components. Systems operate on component queries.
- **Fixed timestep**: game logic runs at 60Hz. Rendering interpolates between ticks via `lerp(PreviousPosition, Position, alpha)` — the mesh sync runs in `loop.render` so motion stays smooth at high framerates.
- **Feet-origin**: ECS `Position` is the entity's feet, capsule colliders are offset upward inside the body. See `src/core/types.ts` for the canonical comment block.
- **MovementIntent seam**: input → `MovementIntent` component → `MovementSystem`. The same component is the natural plug for AI controllers and network input deserializers.
- **Data-driven weapons**: all weapon behavior (damage, timing, turncaps) comes from `WeaponConfig` objects.
- **Tracer-based hits**: no simple raycasts. Weapons have tracer points swept between ticks.
- **Damage pipeline**: TracerSystem detects hits → DamageSystem resolves block/parry/damage → HealthSystem applies HP changes.
- **First-person viewmodel**: two-pass render layer architecture (Layer 0 = world, Layer 1 = viewmodel) with a dedicated camera for depth-correct weapon rendering. Bone-driven animation via `ViewmodelAnimationSystem` — per-weapon unique poses, quaternion slerp crossfade blending matching the world animation system.
- **Arena lighting (Arena v1, #117)**: lights are map data, owned by `createArena()`, not the engine. The v1 rig is a warm directional "sun" against a sky/ground `HemisphereLight` tint plus a low ambient fill — no shadows, no skybox texture. Sky color matches `scene.background`; ground color matches the arena floor.
- **bitECS components are numbers-only**: complex data (meshes, skeletons) lives in `Map<number, ...>` side-tables.
