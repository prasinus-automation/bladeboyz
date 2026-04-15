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

In first-person mode, a **viewmodel** renders your right arm and equipped weapon in front of the camera, giving visual feedback on your current weapon and combat state. The viewmodel arm is **bone-driven** (skeletal hierarchy: upper arm → forearm → hand → weapon attach) and animated by the **ViewmodelAnimationSystem**, which reads the player's `CombatStateComp` each frame. Every weapon has unique first-person poses for all attack directions (left, right, overhead, underhand, stab × windup/release/recovery), all block directions, parry, stunned, and hit-stun states. Pose transitions use **quaternion slerp crossfade** (~80ms blend duration), matching the world animation system's blending approach. A subtle idle sway (sinusoidal bob on the hand bone) adds life when no combat action is active.

### Inventory
| Key | Action |
|-----|--------|
| **I** | Toggle inventory overlay (weapon selection & equipment) |

> While the inventory is open, mouse look and combat inputs are paused. Close with **I** or **Escape** to resume gameplay.

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
```

## Weapons

All weapons are data-driven via `WeaponConfig` objects — damage, timing, turncaps, and tracer geometry are defined in config, not hardcoded in systems. Swap weapons at runtime through the inventory overlay (**I** key) or the console.

| Weapon | Range | Speed | Damage (head/torso/limb) | Stamina | Style |
|--------|-------|-------|--------------------------|---------|-------|
| **Longsword** | 1.4 | Fast | 50–55 / 35–40 / 20–25 | 15 | Balanced all-rounder. Good reach and moderate speed. Reliable across all directions. |
| **Dagger** | 0.35 | Very Fast | 22–25 / 15–18 / 10–12 | 8 | Lightning-fast but short range. Low stamina cost lets you combo freely. |
| **Mace** | 0.6 | Slow | 42–55 / 30–40 / 20–25 | 18 | Heavy blunt weapon. High stun duration (68 ticks) punishes failed parries. |
| **Battleaxe** | 1.2 | Very Slow | 55–75 / 40–55 / 28–35 | 24 | Devastating damage but long windups. Overheads deal up to 75 head damage. |

*Damage ranges show min–max across attack directions (left, right, overhead, underhand, stab). Actual damage depends on attack direction and body region hit.*

## Combat System

BladeBoyz uses a **directional melee combat system** inspired by Mordhau and Chivalry:

### Directional Attacks & Blocks
Mouse movement before clicking determines your attack direction — sweep left for a left swing, pull down for an underhand, push forward for a stab. Blocking works the same way: hold RMB in the correct direction to block an incoming attack. Mismatched block direction lets the attack through.

### Parry & Riposte
Tapping block just as an attack enters its Release phase triggers a **parry**. A successful parry stuns the attacker (40–75 ticks depending on weapon) and opens a **riposte window** — your next attack comes out faster with reduced stamina cost.

### Stamina
Every action costs stamina: attacking, blocking, feinting. Blocking drains stamina based on the attacker's weapon weight (8–30 per block). Running out of stamina leaves you unable to block.

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
│   │   ├── MovementSystem.ts    # WASD movement with Rapier character controller
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
│   └── entities/
│       ├── createPlayer.ts      # Player entity factory (mesh, physics, components)
│       ├── createDummy.ts       # Training dummy factory + management (spawn/reset/block)
│       └── createArena.ts       # Test arena geometry + physics
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
│   └── InputManager.ts      # Keyboard, mouse, pointer lock, rolling delta buffer
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
│   └── InventoryData.ts     # Weapon ownership & equipment side-table
├── hud/
│   ├── HUD.ts               # HUD manager (health, stamina, debug, direction indicator)
│   ├── HealthBar.ts         # Player health bar
│   ├── StaminaBar.ts        # Player stamina bar
│   ├── InventoryPanel.ts    # Inventory overlay UI (weapon selection & gear slots)
│   ├── FloatingDamage.ts    # Floating damage numbers (3D→2D projected HTML)
│   ├── DummyHealthBar.ts    # Floating health bars above training dummies
│   ├── DebugOverlay.ts      # FPS counter, position, movement state (top-left)
│   └── DebugNotification.ts # Brief toast notifications for toggle states
└── utils/
    └── math.ts              # Vector utilities, interpolation helpers
```

## Architecture Notes

- **ECS-first**: everything is an entity with composable components. Systems operate on component queries.
- **Fixed timestep**: game logic runs at 60Hz. Rendering interpolates between ticks.
- **Data-driven weapons**: all weapon behavior (damage, timing, turncaps) comes from `WeaponConfig` objects.
- **Tracer-based hits**: no simple raycasts. Weapons have tracer points swept between ticks.
- **Damage pipeline**: TracerSystem detects hits → DamageSystem resolves block/parry/damage → HealthSystem applies HP changes.
- **First-person viewmodel**: two-pass render layer architecture (Layer 0 = world, Layer 1 = viewmodel) with a dedicated camera for depth-correct weapon rendering. Bone-driven animation via `ViewmodelAnimationSystem` — per-weapon unique poses, quaternion slerp crossfade blending matching the world animation system.
- **bitECS components are numbers-only**: complex data (meshes, skeletons) lives in `Map<number, ...>` side-tables.
