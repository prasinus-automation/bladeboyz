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
│   │   │   ├── TracerSystem.ts
│   │   │   ├── HitboxSystem.ts
│   │   │   ├── StaminaSystem.ts
│   │   │   ├── AnimationSystem.ts
│   │   │   └── ...
│   │   └── entities/            # Entity factory/spawner functions
│   │       ├── createPlayer.ts
│   │       ├── createDummy.ts
│   │       └── ...
│   ├── combat/
│   │   ├── CombatFSM.ts         # Combat state machine definition
│   │   ├── states.ts            # State enum and transition logic
│   │   └── directions.ts        # Attack/block direction detection from mouse input
│   ├── weapons/
│   │   ├── WeaponConfig.ts      # WeaponConfig type + registry (weaponConfigs, registerWeapon)
│   │   └── longsword.ts         # Longsword weapon data (auto-registers on import)
│   ├── input/
│   │   └── InputManager.ts      # Raw input capture, pointer lock, mouse delta tracking
│   ├── rendering/
│   │   ├── CameraController.ts  # FPS + debug third-person camera
│   │   ├── CharacterModel.ts    # Procedural low-poly character mesh + skeleton
│   │   └── DebugRenderer.ts     # Wireframe, hitbox, physics debug drawing
│   ├── hud/
│   │   ├── HUD.ts               # HUD manager
│   │   ├── HealthBar.ts
│   │   ├── StaminaBar.ts
│   │   └── DebugOverlay.ts      # FSM state, FPS counter
│   └── utils/
│       └── math.ts              # Vector utilities, interpolation helpers
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
Each combatant has a per-entity FSM. States: `Idle`, `Windup`, `Release`, `Recovery`, `Block`, `ParryWindow`, `Riposte`, `Feint`, `Clash`, `Stunned`, `HitStun`. Transitions are data-driven from weapon config.

### Data-Driven Weapons
Weapon behavior comes entirely from `WeaponConfig` objects — no hardcoded weapon logic in systems.

### Tracer-Based Hit Detection
No simple raycasts. Weapons have tracer points along the blade. During Release phase, swept-volume collision checks between tick positions against enemy hitbox sensor colliders.

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

## Known Issues / Architectural Debt

### Two Combat State Components
Two ECS components track combat state: `CombatStateComponent` (authoritative — synced from FSM by CombatSystem, used by HUD/StaminaSystem/DamageSystem) and `CombatStateComp` (animation mirror — has `phaseElapsed`/`phaseTotal`, used by AnimationSystem). **CombatSystem currently only syncs `CombatStateComponent`** — `CombatStateComp` is NOT being updated, so AnimationSystem reads stale/zero values. Any work touching animations must fix this sync gap.

### Placeholder Player Mesh
`createPlayer.ts` builds a simple non-skinned box-limb mesh instead of using the full skeletal model from `createCharacterModel()` in `CharacterModel.ts`. The skeleton model exists with full bone hierarchy including a `weapon_attach` bone on `hand_R`, but it is NOT wired into player creation. AnimationSystem bone-pose logic has no effect on the player until this is fixed.

### Weapon Model Not Attached
`createLongswordModel()` exists in `CharacterModel.ts` and returns a `THREE.Group` + tracer points, but no code attaches it to the `weapon_attach` bone at runtime.

### Module-Level Singletons
`fsmRegistry`, `meshRegistry`, `hitboxColliderRegistry`, `weaponIdToName` are all module-level Maps/arrays. Works for single-world but won't scale to multiple worlds.

## Gotchas
- **Rapier3D WASM must be initialized async** before creating the physics world — use `import RAPIER from '@dimforge/rapier3d-compat'` then `await RAPIER.init()`
- **bitECS uses ArrayBuffer-backed components** — component values are numbers only (no strings, no objects). Use lookup tables/maps for complex data.
- **Three.js `Clock.getDelta()`** should NOT be used for the fixed timestep — implement a custom accumulator pattern
- **Pointer Lock API** can only be requested from a user gesture (click) — cannot auto-lock on page load
- **Vite HMR** with Three.js requires careful disposal of scenes/renderers to avoid memory leaks on hot reload
- **Rapier debug renderer** needs `@dimforge/rapier3d-compat` not `@dimforge/rapier3d` for browser compatibility
- The deploy workflow (`.github/workflows/deploy-staging.yml`) expects a `Dockerfile` and maps port 3000 internally → 3010 externally
- **CombatSystem only syncs `CombatStateComponent`**, not `CombatStateComp`** — see "Known Issues" above. AnimationSystem depends on `CombatStateComp` fields (`phaseElapsed`, `phaseTotal`, `state`, `direction`).
- **`weaponIdToName` in CombatSystem.ts (line 28) is a hardcoded array** — when adding new weapons, update this array AND ensure the weapon's numeric index matches `CombatStateComponent.weaponId[eid]`
- **Pointer Lock must be released** when showing any UI overlay (inventory, menus) — call `document.exitPointerLock()`. Re-request on close via user gesture (click on canvas).
- **Side-table pattern** for non-numeric data: `meshRegistry` (Map<number, CharacterModelData>), `fsmRegistry` (Map<number, CombatFSM>), `hitboxColliderRegistry` — use the same pattern for inventory/equipment data
