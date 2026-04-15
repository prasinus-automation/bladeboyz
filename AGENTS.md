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
│   │   └── DebugRenderer.ts     # Wireframe, hitbox, physics debug drawing
│   ├── inventory/
│   │   └── InventoryData.ts     # Inventory side-table (inventoryRegistry Map<eid, InventoryData>)
│   ├── hud/
│   │   ├── HUD.ts               # HUD manager
│   │   ├── HealthBar.ts
│   │   ├── StaminaBar.ts
│   │   ├── DirectionIndicator.ts # Mordhau-style compass-rose crosshair overlay (attack/block direction)
│   │   ├── InventoryPanel.ts    # Tab inventory UI overlay (HTML/CSS, pointer lock toggle)
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

### Two Combat State Components (SYNCED — no longer broken)
Two ECS components track combat state: `CombatStateComponent` (authoritative — synced from FSM by CombatSystem, used by HUD/StaminaSystem/DamageSystem) and `CombatStateComp` (animation mirror — has `phaseElapsed`/`phaseTotal`, used by AnimationSystem). **Both are now synced by CombatSystem** after FSM tick (fixed in PR #36). `computePhaseTotal()` in CombatSystem.ts derives phase duration from FSM state + weapon config. Long-term, these should be unified into a single component.

### Two Disconnected Inventory Modules (NEEDS FIX)
`src/inventory/InventoryData.ts` is a lightweight UI-only side-table used by `InventoryPanel.ts`. `src/ecs/systems/InventorySystem.ts` is the real system with full equip logic (3D model swap, FSM update, ECS sync). **They maintain separate data stores.** `InventoryData.ts` is never initialized in `main.ts`, so the UI weapons grid is always empty. The UI's `equipWeapon()` only updates the InventoryData side-table — it does NOT swap 3D models, update FSM, or sync `CombatStateComponent.weaponId`. Fix: wire `InventoryPanel.ts` to import from `InventorySystem.ts` instead.

### Damage Pipeline (WIRED — PR #60)
The tracer-based hit detection pipeline (`TracerSystem` → `DamageSystem` → `HealthSystem`) is now fully connected. All 5 wiring points fixed: `TracerTag` added to player and dummies, `weaponBoneMap` populated in entity factories, `weaponConfigMap` populated in main.ts from `weaponConfigs` registry, `colliderToHitbox` populated in `createHitboxes()`, and player entity now has hitbox sensor colliders. Note: `weaponBoneMap` and `weaponConfigMap` must also be updated when weapons are swapped at runtime (handled by `InventorySystem.equipWeapon()`).

### First-Person Viewmodel (IMPLEMENTED — PR #57)
`ViewmodelRenderer` (`src/rendering/ViewmodelRenderer.ts`) renders a procedural right arm + weapon in FPS mode using Two-pass Layer architecture: Layer 0 = world, Layer 1 = viewmodel. Separate `PerspectiveCamera` (FOV 70, near 0.01). Weapon swaps automatically via `onEquip` listener. `CameraController.setViewmodel()` toggles visibility on F5 camera mode switch. Minor optimization opportunity: `ARM_OFFSET.clone()` allocates every frame in `syncWithCamera()`.

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
