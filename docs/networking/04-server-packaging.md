# 04 — Headless Server Packaging & Deploy

> **Status:** architecture spec, no production code change. This is sub-issue
> 4 of 4 under the multiplayer parent (#92). Docs 01 (transport / authority),
> 02 (replication / protocol), and 03 (sequences / anti-cheat) are taken as
> given throughout.
>
> **Scope:** how the codebase reorganizes to support a headless authoritative
> server, how Three.js coupling is pulled out of the core runtime, how the
> module-level singletons currently in `AGENTS.md` "Known Issues" become
> per-world side-tables on a `CoreWorld`, and how the existing Docker / deploy
> workflow grows to ship both the static client bundle AND a Node WebSocket
> server from a single container on a single port.
>
> **Out of scope for this doc** (covered elsewhere): transport choice (#116 /
> doc 01), wire byte layout (#126 / doc 02), end-to-end sequence diagrams
> and per-message anti-cheat (#133 / doc 03), matchmaking, regional shards,
> horizontal scale, encryption beyond TLS-on-WS, statistical anti-cheat,
> demo replay, observability stack.

---

## 0. Reading order

This doc is structured top-to-bottom on a first pass. §1 establishes *why*
the current `World.ts` cannot run headless — every subsequent section is a
concrete fix for one of those blockers. §9 is the migration PR sequence the
implementation milestone follows.

Names from doc 02's protocol catalog (`ClientHello`, `Welcome`,
`InputFrame`, `Snapshot`, `EntitySpawned`, `EntityDespawned`, `Disconnect`,
…) appear without redefinition. References to `AGENTS.md` use the section
title in quotes (e.g. "Module-Level Singletons").

Acronyms used: **C→S** = client to server, **S→C** = server to client,
**SoT** = source of truth, **WS** = WebSocket.

---

## 1. Why headless is currently impossible

Today the game ships as a single-page Vite app. There is no Node process; the
deploy serves a static bundle behind nginx. Four concrete blockers prevent
spinning up a copy of the same simulation in Node:

### 1.1 `GameWorld` mandates a render context

`src/core/types.ts:28` declares the load-bearing world type:

```ts
export interface GameWorld {
  ecs: IWorld;
  scene: THREE.Scene;            // ← non-optional, browser-only
  renderer: THREE.WebGLRenderer; // ← non-optional, browser-only
  rapier: typeof RAPIER;
  physicsWorld: RAPIER.World;
  camera: THREE.PerspectiveCamera; // ← non-optional, browser-only
  playerEntity: number;
  arena?: ArenaSpec;
}
```

Three of the seven required fields have no meaning on a server: `scene`,
`renderer`, `camera`. Every authoritative ECS system signature today reads
`world: GameWorld` rather than a narrower interface, so the type itself
forces a render context to exist before the simulation can step.

### 1.2 `createGameWorld` calls browser globals

`src/core/World.ts:10-62` instantiates the world. The relevant browser-only
calls are inline:

```ts
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);   // ← window
renderer.setSize(window.innerWidth, window.innerHeight); // ← window
if (!canvas) document.body.appendChild(renderer.domElement); // ← document
window.addEventListener('resize', () => { /* ... */ }); // ← window
```

`WebGLRenderer` requires a WebGL context. `window` and `document` do not
exist in Node. Even the `await RAPIER.init()` call at the top of the same
function uses the **WASM-compat** build (`@dimforge/rapier3d-compat`); the
identical Rapier API is available in Node, but only because we picked the
compat package. The Three.js renderer cannot be constructed in Node at all.

### 1.3 Entity factories couple ECS spawning to Three.js mesh creation

`src/ecs/entities/createPlayer.ts` adds bitECS components AND constructs the
character mesh AND inserts it into `meshRegistry` AND calls
`world.scene.add(group)` (`createPlayer.ts:213`) — all in one function. The
same pattern holds for `createDummy.ts:149-156` and `createShopkeep.ts`.

A server cannot call this code path: `world.scene` does not exist in
`CoreWorld` (§2), and even if it did, the Three.js skeleton math the player
factory walks (`buildSkeleton(...)` → `Bone` hierarchy) is only useful when
the simulation later renders. The fix is a strict ECS / visual split per §5.

### 1.4 Module-level state is shared across "worlds"

Per the "Module-Level Singletons" section of `AGENTS.md`, eleven side-tables
are currently exported as module-level Maps / arrays:

| Side-table              | Currently exported from                                 |
| ----------------------- | ------------------------------------------------------- |
| `fsmRegistry`           | `src/combat/CombatFSM.ts:645`                           |
| `inventoryRegistry`     | `src/ecs/systems/InventorySystem.ts:60`                 |
| `weaponBoneMap`         | `src/ecs/systems/TracerSystem.ts:62`                    |
| `weaponConfigMap`       | `src/ecs/systems/TracerSystem.ts:55`                    |
| `colliderToHitbox`      | `src/ecs/systems/TracerSystem.ts:68`                    |
| `weaponIdToName`        | `src/ecs/systems/CombatSystem.ts:43` (hardcoded array)  |
| `meshRegistry`          | `src/ecs/components.ts:344`                             |
| `hitboxColliderRegistry`| `src/ecs/components.ts:347`                             |
| `weaponModelFactories`  | `src/ecs/systems/InventorySystem.ts:47` AND `src/rendering/WeaponModels.ts:159` (DUP) |
| `activeDummies`         | `src/ecs/entities/createDummy.ts:34`                    |
| `dummyLastHitTick`      | `src/ecs/entities/createDummy.ts:37`                    |

Plus the smaller scalars / maps from `AGENTS.md`: `Wallet.goldBalance`,
`shopkeepRegistry`, `pickupRegistry`, `MovementSystem.bodyByEid`,
`InputSystem.prevJumpKeyDown`, `tickCounter.currentFixedTick`,
`EventBus.handlers`/`queue`, `DamageSystem.attributionByVictim`,
`spawnPointRegistry`, `AnimationSystem.prevPoseSnapshots`.

Module-level state is fine for single-world single-player. It breaks the
moment a single Node process needs to host one server **plus** run unit
tests in parallel (Vitest workers already mitigate by isolating modules per
worker, but a server-test that span up two `CoreWorld` instances in the
same process would alias every registry above). It will also break the day
we run multiple arenas in one server, which is a likely
post-MVP requirement. Migration plan in §3.

### 1.5 Build pipeline produces only a static client

`package.json` has `"build": "tsc --noEmit && vite build"` and no server
build. The Dockerfile runs `npm run build` and copies `/app/dist` into
nginx. There is no Node runtime in the deploy image, no second build step
for a server, no `start` script. New build / deploy story in §7 + §8.

---

## 2. Proposed `World` split

The `GameWorld` interface splits into two interfaces. Authoritative ECS
systems take the narrower one; client-only systems take the wider one.

```ts
// src/shared/CoreWorld.ts
import type RAPIER from '@dimforge/rapier3d-compat';
import type { IWorld } from 'bitecs';
import type { ArenaSpec } from './arena/types';
import type { CombatFSM } from './combat/CombatFSM';
import type { InventoryData } from './ecs/systems/InventorySystem';
import type { WeaponConfig } from './weapons/WeaponConfig';

export interface CoreWorld {
  ecs: IWorld;
  rapier: typeof RAPIER;
  physicsWorld: RAPIER.World;
  /** Current fixed-update tick (replaces the `tickCounter.ts` module global). */
  tick: number;

  /** Per-world side-tables (§3). Server is SoT for everything below. */
  fsmRegistry: Map<number, CombatFSM>;
  inventoryRegistry: Map<number, InventoryData>;
  hitboxColliderRegistry: Map<number, RAPIER.Collider[]>;
  weaponConfigMap: Map<number, WeaponConfig>;
  colliderToHitbox: Map<number, { ownerEid: number; bodyRegion: number }>;
  activeDummies: number[];
  dummyLastHitTick: Map<number, number>;
  /** Per-arena, populated by createArena(). */
  arena?: ArenaSpec;
}
```

```ts
// src/client/RenderWorld.ts
import type * as THREE from 'three';
import type { CoreWorld } from '../shared/CoreWorld';
import type { CharacterModelData } from '../shared/ecs/components';

export interface RenderWorld extends CoreWorld {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  playerEntity: number;          // local player only — server tracks N players
  meshRegistry: Map<number, CharacterModelData>;
  /** Bone refs used by ViewmodelAnimationSystem and CharacterModel. */
  weaponBoneMap: Map<number, THREE.Object3D>;
}
```

```ts
// src/server/ServerWorld.ts
import type { CoreWorld } from '../shared/CoreWorld';
import type { ConnectionState } from './ConnectionState';

export interface ServerWorld extends CoreWorld {
  /** eid → connection state. eid is the entity the connection drives. */
  connections: Map<number, ConnectionState>;
  /** Snapshot tick rate is /2 of the simulation tick (doc 01 §3). */
  lastBroadcastTick: number;
  /** AntiCheat state (doc 03 §6) — recent input timestamps, etc. */
  antiCheat: AntiCheatState;
}
```

The split is **strictly additive** — anything already valid on `CoreWorld`
stays valid on `RenderWorld` / `ServerWorld`. No system that already takes
`world: GameWorld` needs a behavioural change; only its parameter type
narrows.

### 2.1 Per-system interface table

Every system's required interface is fixed below. The "Required" column is
the narrowest interface that compiles; tightening to `CoreWorld` is the
goal of step 2 of the §9 migration.

| System / module                   | Required interface | Notes                                                                                                                                                |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InputSystem`                     | client-only        | Reads raw keyboard / mouse / pointer-lock. Stays in `src/client/`. Server replaces it with `InputBuffer.applyToIntent` (§5).                          |
| `MovementSystem`                  | `CoreWorld`        | Reads `MovementIntent`, drives Rapier kinematic body, writes `Position`. Today reads `world.physicsWorld` only — already core-clean.                  |
| `CombatSystem`                    | `CoreWorld`        | Ticks `fsmRegistry`. Today reads no Three.js. Already core-clean once `fsmRegistry` is on `CoreWorld`.                                                |
| `StaminaSystem`                   | `CoreWorld`        | Pure ECS read/write.                                                                                                                                  |
| `HealthSystem` / `processDeaths` / `processRespawns` | `CoreWorld` | Pure ECS + EventBus. EventBus moves to `CoreWorld.events` per §3.                                                                       |
| `HitboxSystem`                    | `CoreWorld`        | Reads `hitboxColliderRegistry` and writes Rapier collider transforms. Already core-clean.                                                             |
| `TracerSystem`                    | `CoreWorld`        | Reads `weaponBoneMap` for bone-world-space — see §3 for the bone-math story. Today reads `THREE.Object3D` directly via `weaponBoneMap`.                |
| `DamageSystem`                    | `CoreWorld`        | Pure ECS + EventBus.                                                                                                                                  |
| `InventorySystem` (equip / drop)  | `CoreWorld`        | The 3D-mesh-swap branch (today inline) is split off into `RenderWorld`-only `applyEquippedWeaponVisual()`. Server runs the data half only.            |
| `InteractionSystem`               | `CoreWorld`        | Distance check against `shopkeepRegistry` — moves onto `CoreWorld.shopkeepRegistry`.                                                                  |
| `AnimationSystem`                 | `RenderWorld`      | Writes bone quaternions on `meshRegistry` skeletons. Client-only.                                                                                     |
| `ViewmodelAnimationSystem`        | `RenderWorld`      | Client-only.                                                                                                                                          |
| `PickupRenderer`, `PickupPrompt`  | `RenderWorld`      | Client-only.                                                                                                                                          |
| `HUD` / `DeathScreen` / `Killfeed` / `Scoreboard` / `GoldCounter` | `RenderWorld` | Client-only DOM overlays.                                                                                                            |
| Mesh-sync block (`main.ts:265-280`) | `RenderWorld`    | The `lerp(PreviousPosition, Position, alpha)` write of `meshGroup.position` is render-only.                                                            |

Anything that takes `RenderWorld` MUST NOT be imported from `src/server/`.
The TypeScript build catches violations; an additional ESLint rule
(`no-restricted-imports` per directory) enforces it earlier.

---

## 3. Per-world side-table refactor

Every module-level singleton from §1.4 moves onto `CoreWorld` or
`RenderWorld`. The migration is mechanical: each `export const fooRegistry =
new Map<...>()` becomes a field on the world interface, instantiated in
`createCoreWorld()` / `createRenderWorld()` / `createServerWorld()`.
Consumers that today do

```ts
import { fsmRegistry } from '../../combat/CombatFSM';
fsmRegistry.set(eid, fsm);
```

become

```ts
world.fsmRegistry.set(eid, fsm);
```

### 3.1 Migration table

| Side-table                | Currently in                              | Move to                              | Notes                                                                                                       |
| ------------------------- | ----------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `fsmRegistry`             | `src/combat/CombatFSM.ts:645`             | `CoreWorld.fsmRegistry`              | Server is SoT for FSM transitions. Client mirrors via `CombatStateComp` snapshots.                          |
| `inventoryRegistry`       | `src/ecs/systems/InventorySystem.ts:60`   | `CoreWorld.inventoryRegistry`        | Server-authoritative for owned-list. Client renders from `EquippedWeapon` (doc 02 §1.4).                    |
| `weaponBoneMap`           | `src/ecs/systems/TracerSystem.ts:62`      | split — see §3.2                     | Bone refs are render-side; server replaces them with skeleton-math poses (§3.2).                            |
| `weaponConfigMap`         | `src/ecs/systems/TracerSystem.ts:55`      | `CoreWorld.weaponConfigMap`          | Server uses for damage / range / tracer-points lookup during swept hit detection.                           |
| `colliderToHitbox`        | `src/ecs/systems/TracerSystem.ts:68`      | `CoreWorld.colliderToHitbox`         | Server-authoritative.                                                                                       |
| `weaponIdToName`          | `src/ecs/systems/CombatSystem.ts:43`      | `src/shared/weapons/registry.ts`     | Today a hardcoded array. Promoted to a single registry that exports both an array (numeric ↔ name) and a `Map<name, id>`. Wire format depends on the numeric values — never reorder once shipped, only append (matches the "wire-format note" pattern from FSM v2 #131). |
| `activeDummies`           | `src/ecs/entities/createDummy.ts:34`      | `CoreWorld.activeDummies`            | Server owns dummies in single-arena MVP.                                                                    |
| `dummyLastHitTick`        | `src/ecs/entities/createDummy.ts:37`      | `CoreWorld.dummyLastHitTick`         | Server-authoritative.                                                                                       |
| `meshRegistry`            | `src/ecs/components.ts:344`               | `RenderWorld.meshRegistry`           | Client-only. Server has no Three.js skeleton.                                                               |
| `hitboxColliderRegistry`  | `src/ecs/components.ts:347`               | `CoreWorld.hitboxColliderRegistry`   | Server-authoritative.                                                                                       |
| `weaponModelFactories`    | `InventorySystem.ts:47` AND `WeaponModels.ts:159` (duplicate) | `RenderWorld.weaponModelFactories` (single map, sourced from `src/client/rendering/WeaponModels.ts`) | The duplicate goes away in this PR — `InventorySystem` no longer needs the factory map once the equip-visual branch is split off (§5). |
| `Wallet.goldBalance`      | `src/economy/Wallet.ts`                   | `CoreWorld` per-eid `Gold` component (doc 02 §1.4) | Per-eid, replicated. The module-level `goldBalance` scalar disappears entirely — Wallet becomes a thin wrapper around `Gold.amount[eid]`. |
| `shopkeepRegistry`        | `src/ecs/entities/createShopkeep.ts`      | `CoreWorld.shopkeepRegistry`         | Server owns shopkeep state (it's a static NPC; no networking traffic, just the proximity-prompt seam).      |
| `pickupRegistry`          | `src/inventory/PickupRegistry.ts`         | `CoreWorld.pickupRegistry` (data) + `RenderWorld.pickupGroups` (Three.js groups) | Split per the §3.3 "non-numeric data on RenderWorld" pattern.                                                |
| `MovementSystem.bodyByEid`/ `colliderByEid` / `movementTick` | `MovementSystem.ts` | `CoreWorld.physicsBodies` / `physicsColliders` / built-in `tick` | Single physics-handle map; tick is now `CoreWorld.tick`.                                                    |
| `InputSystem.prevJumpKeyDown` | `InputSystem.ts`                      | `RenderWorld.localInputState` (client) / `ConnectionState.lastInput` (server) | Per-controller state. Local player only on the client; per-connection on the server.                        |
| `tickCounter.currentFixedTick` | `src/core/tickCounter.ts`            | `CoreWorld.tick`                     | Single source of truth. The `advanceFixedTick()` helper becomes `world.tick++` at the top of the fixed loop. |
| `EventBus.handlers` / `queue` | `src/events/EventBus.ts`              | `CoreWorld.events` (per-world bus)   | Each world has its own bus. Tests today already need `EventBus.reset()` between cases — per-world removes that.   |
| `DamageSystem.attributionByVictim` | `src/ecs/systems/DamageSystem.ts` | `CoreWorld.damageAttribution`        | Server-authoritative for kill credit.                                                                       |
| `spawnPointRegistry`      | `src/world/SpawnPoints.ts`                | `CoreWorld.spawnPointRegistry`       | Populated by `createArena(world)`. The `clearSpawnPoints()` test helper becomes `world.spawnPointRegistry.clear()`. |
| `AnimationSystem.prevPoseSnapshots` | `src/ecs/systems/AnimationSystem.ts` | `RenderWorld.poseSnapshots`        | Client-only (animation is render-side).                                                                     |

### 3.2 The hard part — server-side bone math for tracer hit detection

`TracerSystem.ts:141` reads `weaponBoneMap.get(eid)`, then walks the
`THREE.Object3D` hierarchy to compute world-space positions for the four
tracer points along the blade. That walk is the expensive step that makes
melee hit detection directional. The server has to do the equivalent
calculation, but cannot import `WebGLRenderer`. There are three paths.

| Option   | Approach                                                                                                                                                                            | Pros                                                                                                                                                                       | Cons                                                                                                                                                              | Verdict                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**    | Reimplement minimal matrix math in `src/shared/skeleton/`. Pure `Mat4`/`Vec3`/`Quat` types. Walk a parent-pointer-only bone tree using the rest pose from `AnimationData.ts` and the per-frame combat-pose Eulers. | No Three.js dep on the server. Smallest server bundle.                                                                                                                       | Substantial code to write and keep numerically identical to Three.js. Every test against `THREE.Bone.matrixWorld` becomes "and also against ours, to floor".       | **Fallback** for if (B) ever proves too heavy.                                                                                                                   |
| **B**    | Use Three.js `THREE.Bone` / `THREE.Object3D` / `THREE.Matrix4` on the server. **No `WebGLRenderer`, no `Scene.add`** — bones live in a detached hierarchy used only as a math library. | Zero math reimplementation. Animation pose code (§4 of doc 03) reuses `AnimationData.ts` byte-for-byte. Hit detection uses identical numerics to the client.                  | Three.js bundle on the server (~600KB minified, but tree-shakes well — only `Object3D` / `Matrix4` / `Vector3` / `Quaternion` / `Bone` are reached). Adds a runtime dep on a browser-coded library. | **Recommended primary path.** Three.js's math classes have no DOM coupling — `import { Object3D } from 'three'` works in pure Node. The only browser-coupled module is `WebGLRenderer`, which the server never imports. |
| **C**    | Skip per-bone math entirely. Approximate the swept-volume as a single capsule along the player's facing direction.                                                                    | Trivial server code.                                                                                                                                                         | Loses the directional fidelity that makes Mordhau-style combat work. Stab vs. Overhead are visually distinct on the client but indistinguishable to the server hit detector. | **Rejected for MVP.** Re-evaluate post-MVP if (B) becomes a perf bottleneck (it almost certainly will not at 8 players).                                          |

**Recommendation: B.** The architect's note on this issue makes the case
explicitly: Three.js's scene-graph math layer is portable to Node because
nothing under `Object3D` / `Bone` / `Matrix4` reaches for `document` or
`window`. The only place those globals appear in Three.js is inside
`WebGLRenderer` and a few DOM-coupled loaders we will never import on the
server. Bundle size is acceptable: a server-side import of just
`{ Object3D, Bone, Matrix4, Vector3, Quaternion, Euler }` tree-shakes to
~30 KB minified — the same set the client already pays for.

The issue body originally framed this as a two-option choice (`A`
matrix-only / `B` capsule-approximation, recommending `A`). This doc
widens the choice to three by adding the Three.js-on-Node option — that's
the architect's preferred path because it minimises math reimplementation
and keeps the server numerically identical to the client by construction.
The original "matrix-only" option survives as a fallback (`A` here) if
bundle weight ever becomes a concern.

**Implications for the directory layout:**

- `AnimationData.ts` — used by both the client (drives third-person bone
  poses) and the server (combat-pose data feeds the bone-math walk during
  the Release phase). Move to **`src/shared/animation/AnimationData.ts`**.
- `ViewmodelAnimationData.ts` — used only by the first-person viewmodel
  renderer. Stays in **`src/client/animation/`**.
- The `weaponBoneMap` side-table splits in two: a **render-side** version
  on `RenderWorld` keyed by eid → `THREE.Object3D` (the client's bone for
  rendering), and a **server-side** version on `ServerWorld` keyed by eid
  → a detached `THREE.Bone` (no parent in any scene). The server's bone
  hierarchy is built once per spawn from the same data the client uses, so
  the lookup signature is identical.

### 3.3 Pattern for "non-numeric data" on a world

bitECS only stores numbers. We use side-tables for everything else
(meshes, FSMs, Three.js groups, weapon configs, …). The post-split rule:
**if the data is authoritative state, it lives on `CoreWorld`; if it is
purely visual, it lives on `RenderWorld`**. The two halves can share an
eid because eids are minted by `addEntity(world.ecs)` which is core-side.

This is also the rule for the `pickupRegistry` split: the per-eid
`{ weaponName: string, materials: THREE.Material[] }` data is the union of
authoritative state (`weaponName`) and visual cache (`materials`).
Splitting it cleanly:

```ts
// CoreWorld
type PickupData = { weaponName: string };  // weaponId is on the WeaponPickup component
world.pickupRegistry: Map<number, PickupData>;

// RenderWorld
type PickupVisual = { group: THREE.Group; materials: THREE.Material[] };
world.pickupVisuals: Map<number, PickupVisual>;
```

The server only ever populates `pickupRegistry`; the client populates both
when it processes a `WeaponDropEvent` (doc 02 §3).

---

## 4. Proposed directory layout

```
src/
├── shared/                      # NEW — code used by both client and server
│   ├── CoreWorld.ts
│   ├── tick.ts                  # FIXED_TIMESTEP, tickrate constants
│   ├── ecs/
│   │   ├── components.ts        # MOVED from src/ecs/
│   │   └── systems/             # MOVED — all authoritative systems
│   │       ├── CombatSystem.ts
│   │       ├── TracerSystem.ts
│   │       ├── DamageSystem.ts
│   │       ├── HealthSystem.ts
│   │       ├── processDeaths.ts
│   │       ├── processRespawns.ts
│   │       ├── StaminaSystem.ts
│   │       ├── MovementSystem.ts
│   │       ├── HitboxSystem.ts
│   │       ├── InteractionSystem.ts
│   │       ├── HitReactSystem.ts
│   │       └── InventorySystem.ts # data half only — see §5
│   ├── combat/
│   │   ├── CombatFSM.ts          # MOVED
│   │   ├── states.ts             # MOVED
│   │   └── directions.ts         # MOVED
│   ├── animation/
│   │   └── AnimationData.ts      # MOVED — needed for server-side bone math (§3.2)
│   ├── weapons/                  # MOVED — pure data
│   │   ├── WeaponConfig.ts
│   │   ├── longsword.ts
│   │   ├── mace.ts
│   │   ├── dagger.ts
│   │   ├── battleaxe.ts
│   │   └── registry.ts           # NEW — replaces hardcoded weaponIdToName
│   ├── entities/                 # MOVED — server is SoT for spawning
│   │   ├── createPlayer.ts       # SPLIT — see §5
│   │   └── createDummy.ts        # SPLIT — see §5
│   ├── events/
│   │   ├── EventBus.ts           # per-world (no longer module-level)
│   │   └── types.ts
│   ├── economy/                  # MOVED — Prices.ts is pure data
│   │   ├── Prices.ts
│   │   ├── Wallet.ts             # now a thin wrapper around Gold component
│   │   └── PurchaseFlow.ts       # validate-then-mutate (server-authoritative)
│   ├── arena/
│   │   ├── createArena.ts        # SPLIT — geometry data here, lights moved client-side
│   │   └── types.ts
│   ├── world/
│   │   └── SpawnPoints.ts        # selectSpawnPoint() — pure math
│   └── protocol/                 # NEW — wire-format contracts
│       ├── messages.ts           # all C↔S message types + encoders / decoders
│       ├── version.ts            # PROTOCOL_VERSION constant — see doc 02 §6
│       └── snapshot.ts           # snapshot encode / decode + dirty-bit tracking
├── server/                       # NEW — Node-only entry
│   ├── main.ts                   # Node entrypoint, npm run server
│   ├── ServerWorld.ts            # extends CoreWorld; no scene/renderer/camera
│   ├── createServerWorld.ts      # CoreWorld + ServerWorld init, no DOM/WebGL
│   ├── WSGateway.ts              # ws-based WebSocket server, connection lifecycle
│   ├── ConnectionState.ts        # per-client: eid, sessionToken, lastInputTick, gracePeriodTimer
│   ├── InputBuffer.ts            # per-client input ring buffer + applyToIntent
│   ├── SnapshotBuilder.ts        # builds delta snapshots from dirty-bit ECS state
│   ├── AntiCheat.ts              # validation rules from doc 03 §6
│   ├── HttpStatic.ts             # serves dist/client/* alongside the WS endpoint
│   └── ServerLoop.ts             # 60Hz fixed-update + 30Hz snapshot broadcast
├── client/                       # NEW — browser-only
│   ├── main.ts                   # browser entrypoint, current src/main.ts contents
│   ├── RenderWorld.ts            # extends CoreWorld with scene/renderer/camera
│   ├── createRenderWorld.ts      # current createGameWorld(), narrowed
│   ├── NetworkClient.ts          # WS connection, message dispatch
│   ├── ClientPrediction.ts       # MovementSystem prediction layer
│   ├── Reconciliation.ts         # rewind + replay from snapshot (doc 01 §5)
│   ├── Interpolation.ts          # 100 ms render-buffer between snapshots
│   ├── input/                    # MOVED from src/input/
│   ├── rendering/                # MOVED from src/rendering/
│   │   ├── WeaponModels.ts       # owns weaponModelFactories (single SoT now)
│   │   ├── PickupRenderer.ts
│   │   ├── PickupPrompt.ts       # (HUD subdir candidate, kept here for now)
│   │   ├── ViewmodelRenderer.ts
│   │   ├── ViewmodelAnimationSystem.ts
│   │   ├── CharacterModel.ts
│   │   └── DebugRenderer.ts
│   ├── hud/                      # MOVED from src/hud/
│   ├── animation/
│   │   └── ViewmodelAnimationData.ts   # client-only
│   ├── entities/                 # NEW — client-side visual instantiation
│   │   ├── instantiatePlayerVisual.ts  # see §5
│   │   ├── instantiateDummyVisual.ts
│   │   └── instantiateShopkeepVisual.ts
│   ├── ecs/
│   │   └── systems/              # render-side ECS systems
│   │       ├── AnimationSystem.ts
│   │       └── InputSystem.ts
│   └── inventory/
│       └── InventoryPanel.ts     # MOVED — UI overlay
└── core/                         # DELETE — split into shared/ + client/
```

### 4.1 Rationale

- Anything client-only (renderers, HUD, input capture, viewmodel)
  lives in `src/client/`. The build for the client is a Vite bundle of
  `src/client/main.ts`.
- Anything server-only (WS gateway, connection state, anti-cheat) lives in
  `src/server/`. The build for the server is a small Node bundle of
  `src/server/main.ts`.
- Anything authoritative or pure-data lives in `src/shared/`. Both client
  and server import from `src/shared/`; neither imports from the other's
  directory. ESLint's `no-restricted-imports` enforces this:

  ```jsonc
  // .eslintrc — server / client cross-imports are errors
  {
    "overrides": [
      { "files": ["src/server/**/*.ts"],
        "rules": { "no-restricted-imports": ["error",
          { "patterns": ["**/client/**", "three"] }] } },
      { "files": ["src/client/**/*.ts"],
        "rules": { "no-restricted-imports": ["error",
          { "patterns": ["**/server/**"] }] } }
    ]
  }
  ```

  Note: the server's `three` ban is a soft convention — once §3.2 picks
  Option B (Three.js math on Node), the server is **allowed** to import
  Three.js but only the math classes (`Object3D`, `Bone`, `Matrix4`, …).
  The lint rule should refine to ban the renderer-coupled exports
  (`WebGLRenderer`, `WebGLRenderTarget`, `Scene` is borderline — `Scene`
  itself is plain math, but importing it tends to drag in
  `@webxr-input-profiles` etc; safest to ban `WebGLRenderer` only).
- `src/core/` is deleted: half its contents move to `shared/` (the world
  type and tick constants), the other half move to `client/` (the
  `WebGLRenderer` setup).

### 4.2 Build commands

`package.json` grows three new scripts and gets one rename:

```json
{
  "scripts": {
    "dev": "concurrently -n server,client 'npm:dev:server' 'npm:dev:client'",
    "dev:client": "vite --config vite.client.config.ts",
    "dev:server": "tsx watch src/server/main.ts",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build --config vite.client.config.ts",
    "build:server": "esbuild src/server/main.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/server/main.js --external:@dimforge/rapier3d-compat",
    "start": "node dist/server/main.js",
    "preview": "vite preview --config vite.client.config.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Notes on the server build:
- `--platform=node` + `--target=node20` matches the Docker base image
  (§7).
- `--external:@dimforge/rapier3d-compat` tells esbuild to leave the WASM
  bindings as a runtime require, not bundle them. The bindings ship as
  Node-compatible WASM out of the box — the same package the client
  uses.
- Output is ESM (`--format=esm`) because `package.json` is already
  `"type": "module"`.

The `concurrently` dev story runs Vite (HMR client) and `tsx watch`
(server auto-reload) side-by-side. The client Vite config proxies the
`/ws` path to the dev server's port (default 3000) so a single
`localhost:5173` URL works in dev exactly like prod.

---

## 5. `createPlayer` split (and friends)

`createPlayer.ts` today does three things in sequence (line numbers are
the post-#134 file):

1. Pick spawn position (lines 88-101).
2. Add ECS components, set Position / Rotation / Health, instantiate
   Rapier kinematic body, create hitboxes (lines 103-198).
3. Build the Three.js character mesh, attach the starting weapon model,
   insert into `meshRegistry`, call `world.scene.add(group)` (lines
   199-217).

The split is at the boundary between (2) and (3). The first two halves
become `src/shared/entities/createPlayer.ts`; the third half becomes
`src/client/entities/instantiatePlayerVisual.ts`:

```ts
// src/shared/entities/createPlayer.ts
export interface CreatePlayerOptions {
  spawnPos?: { x: number; y: number; z: number };
  yaw?: number;
  startingWeapon?: string;       // defaults to DEFAULT_STARTER_WEAPON
}

export function createPlayer(world: CoreWorld, opts: CreatePlayerOptions = {}): number {
  // … ECS components, Position, Rotation, Velocity, Health, Stamina,
  // Hitboxes, Score, kinematic Rapier body, hitboxColliderRegistry,
  // fsmRegistry, inventoryRegistry — exactly the same code as today,
  // minus everything Three.js below.
  return eid;
}
```

```ts
// src/client/entities/instantiatePlayerVisual.ts
export function instantiatePlayerVisual(world: RenderWorld, eid: number): void {
  // Build CharacterModel skeleton + mesh, attach starting weapon model
  // to weapon_attach bone, position group at Position[eid], world.scene.add(group),
  // populate meshRegistry, populate weaponBoneMap (render-side).
  // Server: never called.
  // Client: called when the local player joins (after Welcome) or when
  // EntitySpawned arrives over the wire (doc 02 §3).
}
```

The same split applies to `createDummy.ts` (split into ECS components +
Rapier body in shared, character mesh in client) and `createShopkeep.ts`
(shopkeep has no Rapier body; the split is just "data on shared, visual
on client"). The `createWeaponPickup.ts` already has the right
ECS-component-only shape on the data side; only the
`createGroundPickupModel` mesh-build call moves into a client-side
`instantiatePickupVisual.ts`.

The `removeX` family of helpers (e.g. `removePlayer`, `removeDummy`,
`removeShopkeep`, `removeWeaponPickup`) splits the same way — one shared
helper to clear the ECS / physics state, one client helper to dispose the
Three.js group + materials.

### 5.1 Wiring on the client

Today the client calls `createPlayer(world, ...)` once during boot
(`main.ts`). After the split, the client:

1. On boot, builds `RenderWorld` (no `createPlayer` call yet — we wait for
   the server's `Welcome`).
2. Sends `ClientHello`, awaits `Welcome` + initial `Snapshot` (doc 03 §1).
3. For each entity in the initial snapshot (the local player + any
   already-connected remotes + the dummies + the shopkeep), the client
   calls **`createPlayer` (shared)** to mint the ECS components AND
   **`instantiatePlayerVisual` (client)** to mint the Three.js mesh.
4. On subsequent `EntitySpawned` messages, the same pair runs for the new
   eid.

The shared `createPlayer` running on the client is a **read-only mirror**
of the server's authoritative state — the client adds the same
components but the server overwrites their values via the next snapshot.
This is the standard pattern for predicted+reconciled networking.

### 5.2 Wiring on the server

The server calls `createPlayer` (shared) once per connection in the
`Welcome` flow (doc 03 §1). Never calls `instantiatePlayerVisual`.

---

## 6. Dependencies to add

| Dep                           | Type            | Version   | Why                                                                                                                                                                                |
| ----------------------------- | --------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ws`                          | runtime         | `^8.x`    | Node WebSocket server. Doc 01 §1 commits to plain WebSocket. `ws` is the de-facto standard, ~50 KB minified, no native deps.                                                        |
| `msgpackr`                    | runtime         | `^1.x`    | Binary encoding picked in doc 02 §4. Same package on client and server (it bundles fine in Vite, runs natively in Node).                                                            |
| `serve-static` *(or hand-rolled)* | runtime     | `^1.x`    | Static file serving for `dist/client/*` from inside `WSGateway.ts`'s HTTP server. See §7 for the "library or hand-rolled" call.                                                      |
| `@types/ws`                   | dev             | `^8.x`    | TypeScript types for `ws`.                                                                                                                                                          |
| `tsx`                         | dev             | `^4.x`    | `npm run dev:server` — fast TS reload without a build step.                                                                                                                          |
| `esbuild`                     | dev             | `^0.20.x` | `npm run build:server` — single-file Node bundle. `vite build` already pulls esbuild as a transitive dep, but we want it as a direct dev dep so the build script works without Vite's CLI. |
| `concurrently`                | dev             | `^8.x`    | Runs `dev:client` + `dev:server` as one `npm run dev` invocation.                                                                                                                    |

No client-only dep needs to change. `three`, `bitecs`, and
`@dimforge/rapier3d-compat` are already in the manifest and are valid in
Node (with the §3.2 caveat: `three` is imported on the server for math
classes only).

---

## 7. Updated Dockerfile

The current `Dockerfile` is a two-stage build that ends in `nginx:alpine`
and serves only the static client (`/app/dist` → `/usr/share/nginx/html`,
listens on 80). The replacement is a two-stage build that ends in
`node:20-alpine` and runs the server, which itself serves both the static
client AND the WS endpoint on port 3000.

```Dockerfile
# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:client && npm run build:server

FROM node:20-alpine AS runtime
WORKDIR /app
# Copy only what the runtime needs: server bundle, client static bundle,
# and the production-only node_modules (ws + msgpackr + the rapier WASM).
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["node", "dist/server/main.js"]
```

Notes:
- The runtime stage installs production deps with `--omit=dev`, which
  drops `vite`, `esbuild`, `tsx`, `concurrently`, `vitest`, `jsdom`,
  `typescript`, `@types/*`. Final image lands at ~120 MB (Node alpine
  base ~50 MB + production `node_modules` ~70 MB).
- `dist/server/main.js` is a single-file esbuild bundle of the server,
  but `--external:@dimforge/rapier3d-compat` keeps the WASM bindings in
  `node_modules` rather than inlined; that's why the runtime stage still
  needs `npm ci --omit=dev`.
- `dist/client/*` is served by the Node server itself (see below).

### 7.1 Static-file serving inside the Node server

`src/server/HttpStatic.ts` mounts `dist/client/*` on the same `http.Server`
that owns the WebSocket upgrade handler. Two reasonable implementations:

- **`serve-static` (~7 KB)** — tested, gzip support, ETag handling,
  `index.html` fallback for SPA routing. Recommended for MVP — small,
  no surprises.
- **Hand-rolled `fs.readFile`** — `index.html` + `assets/*` directly.
  Saves the dependency, costs about 60 lines of careful caching code.
  Worth it only if dependency minimisation matters.

Recommend `serve-static`. The dep cost is negligible (zero deps of its
own) and we get correct content-types, cache headers, and `Range`
support for free.

### 7.2 Combined server vs. nginx + WS sidecar

The architect's note is explicit: **single combined server** is simpler
than running nginx as a TLS terminator / static-file server with a
sidecar Node process for WS. For the 8-player MVP:

- One container, one port, one process — easier deploy, easier logs,
  fewer moving parts.
- WS upgrade goes through the same HTTP listener that serves the SPA.
  No reverse-proxy config to maintain.
- TLS is terminated upstream (the deploy host runs Caddy / a host-level
  reverse proxy that already handles TLS for `bladeboyz.example.com`).
  The container speaks plain HTTP / WS internally; the host reverse
  proxy upgrades it to HTTPS / WSS at the edge. This matches the
  current static-only deploy's TLS story — no change.

Re-evaluate post-MVP if we need separate static-CDN serving (we will
not for 8 concurrent players).

---

## 8. Updated `.github/workflows/deploy-staging.yml`

The existing deploy workflow is a one-job, one-container, ssh-based
push. Five edits:

1. **Container port stays 3000** — the new server listens on 3000 (see
   Dockerfile `EXPOSE 3000`). The existing workflow's `CONTAINER_PORT`
   env var currently reads `"80"` (nginx). Change it to `"3000"`.
2. **Host port stays 3010** — preserves the existing URL that QA already
   has bookmarked. No DNS / reverse-proxy change.
3. **Image is now both halves** — no workflow change here; the Dockerfile
   already builds both client and server in one image. The workflow does
   not need a separate static-asset upload step.
4. **No second container** — combined server, not nginx + WS sidecar.
   The existing `docker run` step stays as-is.
5. **Document the AGENTS.md inconsistency** — `AGENTS.md` says "the
   deploy workflow expects a Dockerfile and maps port 3000 internally
   → 3010 externally". That sentence is currently **wrong** in two
   ways: the existing `Dockerfile` declares `EXPOSE 3000` purely
   cosmetically (nginx actually listens on 80), and the deploy workflow
   maps host 3010 → container 80 today. The new design *makes* the
   AGENTS.md sentence correct: the Node server genuinely listens on
   3000, and the deploy workflow genuinely maps 3010 → 3000. The
   AGENTS.md note should stay as-is — it describes the post-#138
   reality.

The required workflow diff:

```yaml
env:
  PROJECT_NAME: bladeboyz
  HOST_PORT: "3010"
- CONTAINER_PORT: "80"
+ CONTAINER_PORT: "3000"
```

### 8.1 Required GitHub Actions secrets

The existing secrets cover the new design exactly:
- `secrets.DEPLOY_HOST` — the staging host's hostname.
- `secrets.DEPLOY_USER` — the ssh user with docker-run permissions.
- `secrets.DEPLOY_SSH_KEY` — the private key.

**No new secrets are required.** The Node server has no API keys, no
database credentials, no third-party auth — it is a self-contained
process speaking only the doc-02 protocol on its WebSocket port.

### 8.2 Smoke test (deploy-time)

Add one curl step after `docker run` to verify the server responds:

```yaml
- name: Smoke test
  run: |
    ssh -i ~/.ssh/deploy_key ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
      'curl -sf http://localhost:${{ env.HOST_PORT }}/healthz'
```

The server exposes `/healthz` returning `200 OK` once the simulation
loop is ticking. If the response is not 200, the workflow fails and we
surface the breakage before QA sees it.

---

## 9. Migration sequencing

The implementation milestone is too big to land in one PR. The architect's
guidance — directory shuffle and `World` split FIRST, networking code
LAST — frames the order. Each step below should land as one PR, with the
existing single-player tests still green (or in stages 4-11, with new
networking tests added on top of green single-player).

| #   | PR title                                                    | What it does                                                                                                                                                                                    | Ship gate                                                                                                                                  |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | refactor: move pure-data + non-coupled files to `src/shared/` | Move `weapons/`, `combat/`, `animation/AnimationData.ts`, `arena/types.ts`, `world/SpawnPoints.ts`, `events/`, `economy/Prices.ts`, `protocol/` (empty stub). No behavioural changes.            | All existing tests green. No `import` changes outside the moved files.                                                                       |
| 2   | refactor: split `GameWorld` into `CoreWorld` + `RenderWorld`  | Add `src/shared/CoreWorld.ts` + `src/client/RenderWorld.ts`. Update every system signature to its narrowest interface (per §2.1 table). Delete `src/core/types.ts`'s `GameWorld`.                  | Type-check passes, all tests green, no system narrows incorrectly.                                                                          |
| 3   | refactor: side-tables onto the world                          | Walk the §3.1 migration table top-to-bottom. Each side-table becomes `world.X`. Tests update to instantiate side-tables on the test world.                                                          | All tests green; the `EventBus.reset()` / `clearSpawnPoints()` test helpers can be deleted because per-world Maps reset themselves.            |
| 4   | feat(server): hello-world WS gateway                          | Add `src/server/main.ts` with a Node WS server that accepts connections, logs, and disconnects on TLS failure. Add Docker / deploy-workflow updates. No game logic.                                | `docker run` produces `200 OK` on `/healthz`; `wscat ws://host:3010/ws` connects.                                                            |
| 5   | feat(client): NetworkClient skeleton                          | Add `src/client/NetworkClient.ts`. WS connection + message dispatch only — no game logic. Behind a feature flag (`?multiplayer=1`); single-player stays the default.                                | Feature-flagged client connects to feature-flagged server; round-trip log of `ClientHello` → `Welcome` works.                                |
| 6   | feat(net): `Welcome` + initial snapshot                       | Implement `Welcome` payload + the initial full snapshot from doc 02 §2. Two clients can join an empty arena and see each other's eid (no movement yet).                                              | Two `?multiplayer=1` clients see each other in the snapshot; eids stable.                                                                    |
| 7   | feat(net): `InputFrame` + server `MovementSystem`             | Server runs `MovementSystem` from inputs; client predicts (no reconciliation yet). Two clients see each other move.                                                                                  | Visual: two clients walk around a shared arena. Latency is visible (no prediction yet).                                                       |
| 8   | feat(net): client prediction + reconciliation                  | Doc 01 §5: rewind-and-replay on snapshot mismatch. Local input feels native; remote movement is interpolated.                                                                                         | Visual: own movement is snappy; remote movement is smooth (100 ms interp).                                                                    |
| 9   | feat(net): combat replication                                 | FSM transitions cross the wire (`CombatStateComp` deltas). Tracer + damage runs server-side; client renders `HitReactEvent`, `DamageEvent`, `DeathEvent` from doc 02 §3.                            | Two clients can fight to the death.                                                                                                          |
| 10  | feat(net): weapon swap, pickup, gold                          | `WeaponSwapRequest`, `PickupRequest`, `WeaponPickupEvent`, `WeaponDropEvent`, `GoldDelta`. Shop purchases server-validated.                                                                            | Shop works. Drop-on-death works. Gold is server-authoritative.                                                                                |
| 11  | feat(net): disconnect / grace / reconnect                     | Doc 03 §5: 30 s grace timer, session token reconnect, `PlayerLeft` broadcast on grace expiry.                                                                                                          | Pull a network cable; reconnect within 30 s; player resumes.                                                                                  |

This sequencing list is **documentation only** — actual issues for each
step are filed in a follow-up planning round once doc 04 is approved.

### 9.1 What "single-player still works" means at each stage

Steps 1-3 must preserve the existing single-player game in full. The
acceptance criterion is the existing test suite (currently 1102+ tests)
passing, plus a manual smoke test of `npm run dev` in the browser. From
step 4 on, single-player is preserved by leaving the `?multiplayer=1`
feature flag off; the local-only client path is untouched until step 11
ships, at which point the `?multiplayer=1` flag flips to default-on.

### 9.2 Risk: Three.js on the server (§3.2 Option B)

The single biggest unknown is whether the Three.js bone-math approach
behaves identically to the client's `Object3D.matrixWorld` walk. The
risk is mitigated by:
- A shared test fixture in `src/shared/skeleton/__tests__/` that builds
  the same skeleton in both contexts and asserts world-space bone
  positions match to f32 precision (the snapshot precision in doc 02 §5).
- The server using the same `AnimationData.ts` poses as the client; any
  divergence is a math-layer bug, not a data bug.

If Option B turns out to be too heavy or numerically diverges, fall
back to Option A (matrix-only math in `src/shared/skeleton/`) — the
swap is contained to one file and the consumer signature does not
change.

---

## Appendix A — File-move quick-reference

For implementers running step 1 of §9: the exact moves. Items not in
this table stay where they are (e.g. `vite.config.ts`,
`vitest.config.ts`, `index.html`, `Dockerfile`, the workflow, the
`docs/` tree, `package.json`, `tsconfig.json`, `README.md`).

| From                                            | To                                                       |
| ----------------------------------------------- | -------------------------------------------------------- |
| `src/core/types.ts`                             | split — `GameWorld` → deleted; constants → `src/shared/tick.ts` and `src/shared/spatial.ts` |
| `src/core/World.ts`                             | `src/client/createRenderWorld.ts` (renamed, narrowed)     |
| `src/core/GameLoop.ts`                          | `src/shared/GameLoop.ts` (used by both)                   |
| `src/core/tickCounter.ts`                       | deleted — `tick` becomes a `CoreWorld` field             |
| `src/ecs/components.ts`                         | `src/shared/ecs/components.ts`                           |
| `src/ecs/systems/CombatSystem.ts`               | `src/shared/ecs/systems/CombatSystem.ts`                 |
| `src/ecs/systems/TracerSystem.ts`               | `src/shared/ecs/systems/TracerSystem.ts`                 |
| `src/ecs/systems/DamageSystem.ts`               | `src/shared/ecs/systems/DamageSystem.ts`                 |
| `src/ecs/systems/HealthSystem.ts`               | `src/shared/ecs/systems/HealthSystem.ts`                 |
| `src/ecs/systems/processDeaths.ts`              | `src/shared/ecs/systems/processDeaths.ts`                |
| `src/ecs/systems/processRespawns.ts`            | `src/shared/ecs/systems/processRespawns.ts`              |
| `src/ecs/systems/StaminaSystem.ts`              | `src/shared/ecs/systems/StaminaSystem.ts`                |
| `src/ecs/systems/MovementSystem.ts`             | `src/shared/ecs/systems/MovementSystem.ts`               |
| `src/ecs/systems/HitboxSystem.ts`               | `src/shared/ecs/systems/HitboxSystem.ts`                 |
| `src/ecs/systems/InteractionSystem.ts`          | `src/shared/ecs/systems/InteractionSystem.ts`            |
| `src/ecs/systems/HitReactSystem.ts`             | `src/shared/ecs/systems/HitReactSystem.ts`               |
| `src/ecs/systems/InputSystem.ts`                | `src/client/ecs/systems/InputSystem.ts`                  |
| `src/ecs/systems/AnimationSystem.ts`            | `src/client/ecs/systems/AnimationSystem.ts`              |
| `src/ecs/systems/InventorySystem.ts`            | split — data half → `src/shared/`; visual hooks → `src/client/inventory/applyEquippedWeaponVisual.ts` |
| `src/ecs/entities/createPlayer.ts`              | split per §5                                             |
| `src/ecs/entities/createDummy.ts`               | split per §5                                             |
| `src/ecs/entities/createShopkeep.ts`            | split per §5                                             |
| `src/ecs/entities/createWeaponPickup.ts`        | split per §5                                             |
| `src/ecs/utils/spawnAtGround.ts`                | `src/shared/ecs/utils/spawnAtGround.ts`                  |
| `src/combat/CombatFSM.ts`                       | `src/shared/combat/CombatFSM.ts`                         |
| `src/combat/states.ts`                          | `src/shared/combat/states.ts`                            |
| `src/combat/directions.ts`                      | `src/shared/combat/directions.ts`                        |
| `src/animation/AnimationData.ts`                | `src/shared/animation/AnimationData.ts`                  |
| `src/animation/poseBlending.ts`                 | `src/client/animation/poseBlending.ts` (render-only)     |
| `src/animation/arcSwing.ts`                     | `src/shared/animation/arcSwing.ts` (server uses arcs for swept-volume math during Release) |
| `src/animation/hitReact.ts`                     | `src/client/animation/hitReact.ts` (render-only overlay) |
| `src/weapons/*`                                 | `src/shared/weapons/*` (+ new `registry.ts`)             |
| `src/arena/createArena.ts`                      | split — geometry/spawns → shared; lights → client        |
| `src/arena/types.ts`                            | `src/shared/arena/types.ts`                              |
| `src/world/SpawnPoints.ts`                      | `src/shared/world/SpawnPoints.ts`                        |
| `src/events/*`                                  | `src/shared/events/*`                                    |
| `src/economy/Wallet.ts`                         | `src/shared/economy/Wallet.ts` (Gold-component wrapper)  |
| `src/economy/Prices.ts`                         | `src/shared/economy/Prices.ts`                           |
| `src/economy/PurchaseFlow.ts`                   | `src/shared/economy/PurchaseFlow.ts`                     |
| `src/input/*`                                   | `src/client/input/*`                                     |
| `src/rendering/*`                               | `src/client/rendering/*`                                 |
| `src/hud/*`                                     | `src/client/hud/*`                                       |
| `src/inventory/InventoryPanel.ts`               | `src/client/inventory/InventoryPanel.ts`                 |
| `src/inventory/PickupRegistry.ts`               | split — data on `CoreWorld`, materials on `RenderWorld`  |
| `src/main.ts`                                   | `src/client/main.ts` (the existing `main.ts` body, narrowed) |

The actual move PR (step 1 of §9) does not need to touch every file
above in one go — split into smaller PRs grouped by directory if review
gets noisy.
