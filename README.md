# BladeBoyz

Browser-based multiplayer melee combat game with an ultra-low-poly BattleBit-style aesthetic and Mordhau/Chivalry-inspired directional combat mechanics. Built with Three.js, Rapier3D physics, and a bitECS entity-component-system architecture.

Currently in the scaffolding phase: single player, test arena with training dummies, no networking yet. The combat system features tracer-based hit detection (swept-volume collision along the blade), directional attacks and blocks, a parry/riposte system, and data-driven weapon configurations. Players can open an inventory overlay to swap between unlocked weapons mid-session.

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
| **E** | Interact (when prompt shown) — e.g. open the shop while standing near the shopkeep |

> A **shopkeep NPC** stands at one corner of the arena (around `(8, _, 8)`). Walk close enough and a "Press [E] to shop" prompt appears above their head; pressing **E** opens the shop overlay.

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

Spawn Y is resolved by `spawnAtGround(world, x, z)`, which raycasts down from `(x, 50, z)` and returns the surface hit + a small `CHARACTER_CONTROLLER_OFFSET` epsilon. Entity factories never hard-code Y. The arena ground top is at `y = GROUND_TOP_Y = 0.1` (a 25×0.1×25 cuboid centered at origin).

## Weapons

All weapons are data-driven via `WeaponConfig` objects — damage, timing, turncaps, and tracer geometry are defined in config, not hardcoded in systems. Swap weapons at runtime through the inventory overlay (**I** key) or the console.

| Weapon | Range | Speed | Damage (head/torso/limb) | Stamina | Parry rec. / Block-break stun (ticks) | Style |
|--------|-------|-------|--------------------------|---------|----------------------------------------|-------|
| **Longsword** | 1.4 | Fast | 45–55 / 35–40 / 20–25 | 15 | 12 / 30 | Balanced all-rounder. Good reach and moderate speed. Reliable across all directions. |
| **Dagger** | 0.35 | Very Fast | 22–25 / 16–18 / 10–12 | 8 | 8 / 24 | Lightning-fast but short range. Low stamina cost lets you combo freely. |
| **Mace** | 0.6 | Slow | 42–55 / 30–40 / 20–25 | 18 | 14 / 36 | Heavy blunt weapon. High stun duration (68 ticks) punishes failed parries. |
| **Battleaxe** | 1.2 | Very Slow | 55–75 / 40–55 / 28–35 | 24 | 16 / 42 | Devastating damage but long windups. Overheads deal up to 75 head damage. |

*Damage ranges show min–max across attack directions (left, right, overhead, stab — the FSM v2 schema removed `Underhand`). Actual damage depends on attack direction and body region hit.*

*`Parry rec.` is how long the Parry pose locks before returning to Blocking (ticks). `Block-break stun` is the stagger applied when a blocker's stamina hits zero mid-block. Both are per-weapon as of FSM v2 (issue #131); the v1 module-level `BLOCK_BREAK_STUN_TICKS = 30` constant is still used by `StaminaSystem` until the FSM v2 wiring lands. Every weapon also has a `turncap.hitStun` of 0.005 rad/tick — the stagger almost completely locks your aim.*

## Gold & Shop

The player starts with a small purse of **200 gold** and only the **Dagger** equipped. Other weapons (Mace, Longsword, Battleaxe) must be purchased from the shopkeep — the inventory no longer starts populated with every weapon. Gold prices live in `src/economy/Prices.ts` (Mace 100, Longsword 150, Battleaxe 200) and the balance lives in a small in-memory `Wallet` module at `src/economy/Wallet.ts`. A **gold counter HUD** appears at the top-right of the screen and updates whenever the balance changes; it pulses briefly on each change.

To shop, walk up to the shopkeep NPC and press **E** — see [Shop](#shop) above for the full UX. Purchases are atomic: gold is only deducted on success, and a successful purchase adds the weapon to inventory and equips it in one step.

The wallet is intentionally minimal scaffolding for the shop feature — earning gold from kills, persistence across sessions, and networked reconciliation belong to the full Gold currency design (issue #95) and are deliberately out of scope here.

## Combat System

BladeBoyz uses a **directional melee combat system** inspired by Mordhau and Chivalry:

### Directional Attacks & Blocks
Mouse movement before clicking determines your attack direction — sweep left for a left swing, sweep right for a right swing, push up for an overhead, or hold steady (or push down) for a stab. The FSM v2 schema (issue #131) trims the attack set to **four directions** (`Left`, `Right`, `Overhead`, `Stab`) — the old `Underhand` swing was folded into `Stab` because it animated similarly to `Overhead`. Blocking still has all four cardinal poses (`Left`, `Right`, `Top`, `Bottom`); the bottom block stays as a defensive option even though no attack is dedicated to it.

### Parry & Riposte
Tapping block just as an attack enters its Release phase triggers a **parry**. A successful parry stuns the attacker (40–75 ticks depending on weapon) and opens a **riposte window** — your next attack comes out faster with reduced stamina cost.

### Stamina
Every action costs stamina: attacking, blocking, parrying. Blocking drains stamina based on the attacker's weapon weight (8–30 per block). Running out of stamina leaves you unable to block. (The legacy `Feint` action was removed in FSM v2, so weapon configs no longer specify a `staminaCost.feint` value — the field stays optional in the type for a future re-add.)

### Tracer-Based Hit Detection
Instead of simple raycasts, weapons define **tracer points** along the blade. During the Release phase, the system performs swept-volume collision tests between each tracer point's position on the current and previous ticks. This creates realistic hit detection that respects the actual arc of the weapon swing — edge alignment matters.

Hits are resolved against **hitbox sensor colliders** attached to the target's skeleton bones (head, torso, arms, legs). Damage scales by body region: headshots deal full damage, torso is reduced, limbs take the least.

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
│   │   ├── HealthSystem.ts      # Health management, death, respawn after 2s
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
│   └── createArena.ts           # Code-authored arena: lights (#117), geometry/spawns (#112)
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
│   └── AnimationData.test.ts
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
