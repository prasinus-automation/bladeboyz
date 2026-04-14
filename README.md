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
window.setWeapon('Longsword')   // Swap weapon by name
window.setWeapon('Mace')        // Available: Longsword, Mace, Dagger, Battleaxe
```

## Weapons

All weapons are data-driven via `WeaponConfig` objects — damage, timing, turncaps, and tracer geometry are defined in config, not hardcoded in systems. Swap weapons at runtime through the inventory overlay (**I** key).

| Weapon | Style | Description |
|--------|-------|-------------|
| **Longsword** | Balanced | The baseline weapon. Good reach, moderate speed, and reliable damage across all attack directions. Versatile for both beginners and experienced players. |
| **Mace** | Heavy | Slow but devastating. High damage output with strong stamina drain on block. Punishes mistimed blocks and rewards patience. |
| **Dagger** | Fast | Lightning-quick attacks with short reach. Low damage per hit but rapid combos and minimal stamina cost. Excels at close range. |
| **Battleaxe** | Power | The heaviest hitter. Massive windup and recovery windows leave you vulnerable, but a clean overhead can end a fight in one or two strikes. |

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
│   │   ├── HitboxSystem.ts      # Creates & syncs hitbox sensor colliders to skeleton bones
│   │   ├── TracerSystem.ts      # Swept-volume hit detection during weapon release phase
│   │   ├── DamageSystem.ts      # Processes damage events (block/parry/hit resolution)
│   │   └── DummyDamageObserver.ts  # Floating damage numbers for training dummies
│   └── entities/
│       ├── createPlayer.ts      # Player entity factory (mesh, physics, components)
│       ├── createDummy.ts       # Training dummy factory + management (spawn/reset/block)
│       └── createArena.ts       # Test arena geometry + physics
├── combat/
│   ├── states.ts            # CombatState enum (Idle, Windup, Release, Block, etc.)
│   └── directions.ts        # Attack/block direction detection from mouse input
├── weapons/
│   ├── WeaponConfig.ts      # WeaponConfig type + registry
│   ├── longsword.ts         # Longsword weapon data (auto-registers on import)
│   ├── mace.ts              # Mace weapon data
│   ├── dagger.ts            # Dagger weapon data
│   └── battleaxe.ts         # Battleaxe weapon data
├── input/
│   └── InputManager.ts      # Keyboard, mouse, pointer lock, rolling delta buffer
├── rendering/
│   ├── CameraController.ts  # FPS + third-person orbit camera
│   ├── CharacterModel.ts    # Procedural low-poly character mesh + bone skeleton
│   ├── DebugRenderer.ts     # F1-F4 debug toggles (wireframe, physics, hitboxes, FSM)
│   └── TracerDebugRenderer.ts  # Tracer sweep line visualization
├── inventory/
│   └── InventoryData.ts     # Weapon ownership & equipment side-table
├── hud/
│   ├── InventoryPanel.ts    # Inventory overlay UI (weapon selection & gear slots)
│   ├── DebugOverlay.ts      # FPS counter, position, movement state (top-left)
│   ├── FloatingDamage.ts    # Floating damage numbers (3D→2D projected HTML)
│   ├── DummyHealthBar.ts    # Floating health bars above training dummies
│   └── DebugNotification.ts # Brief toast notifications for toggle states
└── utils/
    └── math.ts              # Vector utilities, interpolation helpers
```

## Architecture Notes

- **ECS-first**: everything is an entity with composable components. Systems operate on component queries.
- **Fixed timestep**: game logic runs at 60Hz. Rendering interpolates between ticks.
- **Data-driven weapons**: all weapon behavior (damage, timing, turncaps) comes from `WeaponConfig` objects.
- **Tracer-based hits**: no simple raycasts. Weapons have tracer points swept between ticks.
- **bitECS components are numbers-only**: complex data (meshes, skeletons) lives in `Map<number, ...>` side-tables.
