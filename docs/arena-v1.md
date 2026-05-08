# Arena v1 — Architecture Doc

**Status:** Architect deliverable for Issue #91. Implementation lives in follow-up dev sub-issues.

## Goal

A single small arena map suitable for 2–8 players. Symmetric, simple, easy to learn. Houses the shopkeep NPC. Replaces the current 50×50 procedural test arena (`src/ecs/entities/createArena.ts`).

## Design Principles

1. **Code-authored, no asset pipeline.** All geometry built in TypeScript with `THREE.BoxGeometry` + matching Rapier `cuboid` static colliders. No glTF, no JSON map files. This keeps MVP velocity high; we add an asset pipeline later only if hand-authored maps stop scaling.
2. **Mesh / collider 1:1.** Every visible static prop has a Rapier static collider with identical extents. No "decoration only" geometry — if you can see it, you collide with it.
3. **Symmetric where it matters, asymmetric where it doesn't.** The play space is mirror-symmetric across the X-axis (north-south). The shopkeep stall sits in the SW corner — a deliberate, small (3×3m) asymmetry that doesn't affect competitive balance because it's outside any common engagement area.
4. **No pits in v1.** The floor is a single flat plane. `weapon_pickup_safe_volume` is defined now anyway so dropped weapons that physics-eject out of bounds (e.g., bouncing off a pillar at high speed) get respawned in-bounds — and so the contract is in place for future maps with pits.
5. **Preserve `SPAWN_HEIGHT`.** Ground top surface stays at `y = 0.1` (ground cuboid `cuboid(15, 0.1, 15)` at origin), so the existing `SPAWN_HEIGHT = 0.1 + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS = 1.1` formula in `src/core/types.ts` continues to work without changes.

## Coordinate System

Three.js right-handed, with our convention:

- Origin = arena center, on the floor's top surface (xz plane at `y = 0.1`).
- `+X` = east, `−X` = west.
- `+Y` = up.
- `+Z` = south, `−Z` = north.
- Yaw = 0 means facing `−Z` (north). Yaw increases CCW looking down `+Y`.

## Top-Down Layout (30×30m)

```
                          NORTH (-Z, z = -15)
       +─────────────────────────────────────────────+
       |                                             |
       |         · S2 (-7,-9)        · S3 (7,-9)    |
       |                                             |
       |                                             |
       |              ┌────────┐                     |
       |              │Pillar A│                     |
       |              │ 2×2×3  │                     |
       |              │ (-5,0) │                     |
       |              └────────┘                     |
       |                                             |
       |                                             |
  W    | · S1                                  S4 ·  |  E
(-X)   |   (-13,0)         CENTRAL              (13,0) |  (+X)
       |                  KILLING                     |
       |                   FLOOR                      |
       |               (open ~12×12)                  |
       |                                             |
       |                                             |
       |              ┌────────┐                     |
       |              │Pillar B│                     |
       |              │ 2×2×3  │                     |
       |              │ (5,0)  │                     |
       |              └────────┘                     |
       |                                             |
       |                                             |
       | ┌─────┐                                     |
       | │ Shop│  · S5 (-7,9)        · S6 (7,9)     |
       | │ 3×3 │                                     |
       | │stall│                                     |
       | └─────┘                                     |
       |(-12,12)                                     |
       +─────────────────────────────────────────────+
                          SOUTH (+Z, z = +15)
```

Pillar A and Pillar B are mirror-symmetric across z = 0 (well, they're on the X-axis, so they're on the line of symmetry — placed at `(±5, 0)` they break sightlines through the central killing floor without sealing it off). Spawns S1↔S4, S2↔S5, S3↔S6 are mirror-symmetric across the X-axis (z-flipped).

## Static Geometry Inventory

All extents are full extents (Three.js `BoxGeometry(width, height, depth)`); Rapier `cuboid(hx, hy, hz)` takes half-extents.

| ID | Type | Center (x, y, z) | Size (w × h × d) | Color | Notes |
|---|---|---|---|---|---|
| `ground` | floor | `(0, 0, 0)` | `30 × 0.2 × 30` | `0x556b2f` (olive) | Top surface at `y = 0.1`. Same height as v0 to preserve `SPAWN_HEIGHT`. |
| `wall_N` | wall | `(0, 1, -15.25)` | `30.5 × 2 × 0.5` | `0x6b6b5a` (warm grey) | Low wall, blocks fall-off. Slight overlap into corner. |
| `wall_S` | wall | `(0, 1, 15.25)` | `30.5 × 2 × 0.5` | `0x6b6b5a` | |
| `wall_E` | wall | `(15.25, 1, 0)` | `0.5 × 2 × 30.5` | `0x6b6b5a` | |
| `wall_W` | wall | `(-15.25, 1, 0)` | `0.5 × 2 × 30.5` | `0x6b6b5a` | |
| `pillar_A` | pillar | `(-5, 1.5, 0)` | `2 × 3 × 2` | `0x8a8a8a` (light grey) | Cover for west-facing engagements. |
| `pillar_B` | pillar | `(5, 1.5, 0)` | `2 × 3 × 2` | `0x8a8a8a` | Cover for east-facing engagements. |
| `shop_counter` | counter | `(-12, 0.5, 12)` | `3 × 1 × 0.5` | `0x6e4a2a` (wood brown) | Waist-high counter in front of stall. Faces north (`−Z`) into arena. |
| `shop_back_wall` | wall | `(-13.25, 1.5, 12)` | `0.5 × 3 × 4` | `0x6e4a2a` | Back wall behind shopkeep. Hides the wall corner. |

**Total Rapier static colliders: 9.** All `RigidBodyType.Fixed`. Negligible perf impact.

## Spawn Points

Spawn points are mirror-symmetric pairs across z=0, plus two perpendicular spawns on the east-west axis. 6 spawn points total — fits 2–8 players if some respawn waves overlap. Player rotation faces arena center (yaw points toward origin, projected onto xz-plane).

| ID | Position (x, y, z) | Yaw (rad, faces center) | Notes |
|---|---|---|---|
| S1 | `(-13, 1.1, 0)` | `Math.PI / 2` (faces +X / east) | West side, on E-W axis. |
| S2 | `(-7, 1.1, -9)` | `atan2(7, 9)` ≈ `0.66` | NW interior, faces SE toward center. |
| S3 | `(7, 1.1, -9)` | `atan2(-7, 9)` ≈ `-0.66` | NE interior, faces SW toward center. |
| S4 | `(13, 1.1, 0)` | `-Math.PI / 2` (faces −X / west) | East side, on E-W axis. |
| S5 | `(-7, 1.1, 9)` | `atan2(7, -9)` ≈ `2.48` | SW interior, faces NE toward center. (Behind shop stall — slight gameplay note: this spawn is closest to the shopkeep.) |
| S6 | `(7, 1.1, 9)` | `atan2(-7, -9)` ≈ `-2.48` | SE interior, faces NW toward center. |

`y = 1.1` matches `SPAWN_HEIGHT`. Once Issue #86 (character controller) lands, spawn implementations should raycast down from `y = 5` and snap-to-ground; until then the static `y = 1.1` works because the ground is flat.

**Distance to nearest pillar from each spawn:**
- S1 → pillar A: 8m
- S2 → pillar A: ~9.2m
- S3 → pillar A: ~14.7m, pillar B: ~10.8m
- (mirrored for S4–S6)

No spawn is closer than 8m to any pillar — players can't be insta-melee'd through cover after respawn. The closest spawn-to-spawn distance is S2↔S3 = 14m, which is well outside any weapon's lunge range.

## Shopkeep Stall

The shopkeep stall is a fixed structure in the SW corner. Sub-issues / future work will spawn the actual NPC entity at `npcAnchor`, facing `facing`, with collision / interaction triggers.

```ts
shopkeepStall: {
  counter: { min: { x: -13.5, y: 0,   z: 11.75 }, max: { x: -10.5, y: 1, z: 12.25 } },  // counter AABB
  npcAnchor: { x: -12, y: 1.1, z: 13 },  // shopkeep stands here, behind counter
  facing: 0,                              // yaw 0 = faces -Z (north, into arena interior)
}
```

The counter is a physical barrier: players can walk up to it but not through it. The shopkeep entity (Issue #92 territory) will use the counter as a non-LOS-blocking but collision-blocking interaction surface.

## Weapon Pickup Safe Volume

```ts
weaponPickupSafeVolume: {
  min: { x: -14.5, y: 0,  z: -14.5 },
  max: { x:  14.5, y: 10, z:  14.5 },
}
```

This volume is the inside-walls AABB minus a 0.5m margin from the walls (so weapons don't clip into wall colliders). It excludes the shopkeep stall area implicitly because dropped weapons are spawned by the dropping player's position — they only get respawned via this volume if they exit it.

**Rule:** any dropped weapon entity whose position leaves this AABB (or whose `y < 0`) is teleported to the dropping player's last grounded position, clamped into the volume. Implementation details are in the weapon-pickup feature, not this issue — but the ArenaSpec exposes the volume so that system has the data it needs.

## Lighting Plan

Ultra-low-poly aesthetic — no shadows, no fancy GI, no skybox texture. Three lights total:

| Light | Type | Color | Intensity | Position |
|---|---|---|---|---|
| Ambient | `AmbientLight` | `0xffffff` | `0.35` | (any) |
| Sky/Ground tint | `HemisphereLight` | sky `0x87ceeb`, ground `0x556b2f` | `0.5` | `(0, 50, 0)` |
| Sun | `DirectionalLight` | `0xfff5e0` (warm white) | `0.7` | `(15, 25, 10)` (looks at origin) |

`HemisphereLight` is the new addition — it gives surfaces facing up a sky-tint and surfaces facing down a ground-tint, which makes the low-poly geometry read cleanly without any texture work.

**No shadows in v1.** Adding `castShadow = true` requires shadow map setup, perf tuning, and biases — premature for a 9-collider arena where the visual style doesn't demand it.

**Background:** keep `scene.background = 0x87ceeb` (current default). No skybox cubemap. The hemisphere light + flat sky color reads as "stylized daytime."

**Where lights live:** the v0 lighting setup is hardcoded in `src/core/World.ts`. For v1, lights are owned by `createArena()` — they're part of the map, not the engine. Move the existing two lights out of `World.ts` and into `createArena.ts`, and add the hemisphere light there.

## Authoring: Code, Not Assets

For MVP we author maps in TypeScript:

- Pros: zero asset pipeline, full type safety, easy to grep, easy to diff.
- Cons: no Blender preview, no non-coder map authoring.

Once we have multiple maps and gameplay-driven layout iteration, we'll revisit (likely glTF + a thin loader). For v1, code is correct.

## `createArena()` Interface

The function takes a `GameWorld`, mutates it (adds lights + meshes + colliders), and returns an `ArenaSpec` describing the runtime state of the arena. The spec is stored on `GameWorld.arena` so other systems (spawn, weapon-pickup, shopkeep AI) can query it without re-importing the file.

```ts
// src/arena/types.ts

export interface Vec3 { x: number; y: number; z: number; }

export interface Volume3D {
  min: Vec3;
  max: Vec3;
}

export interface SpawnPoint {
  id: string;       // "s1" .. "s6"
  position: Vec3;   // capsule-center y (matches SPAWN_HEIGHT)
  facing: number;   // yaw in radians; 0 = -Z (north)
}

export interface ShopkeepStallSpec {
  counter: Volume3D;        // AABB of the counter prop
  npcAnchor: Vec3;          // where the shopkeep entity stands
  facing: number;           // yaw the shopkeep faces (toward arena interior)
}

export interface ArenaSpec {
  name: 'arena_v1';
  groundHeight: number;             // top surface y of ground plane = 0.1
  bounds: Volume3D;                 // outer playable AABB (inside walls)
  spawnPoints: SpawnPoint[];        // 6 points, see table above
  shopkeepStall: ShopkeepStallSpec;
  weaponPickupSafeVolume: Volume3D; // dropped weapons that exit are respawned in-bounds
}

// src/arena/createArena.ts
export declare function createArena(world: GameWorld): ArenaSpec;
```

Wiring (in `main.ts`):

```ts
const arena = createArena(world);
world.arena = arena;  // GameWorld gains optional `arena?: ArenaSpec` field

// Replace hardcoded { x: 0, y: SPAWN_HEIGHT, z: 0 } player spawn:
const spawn = arena.spawnPoints[0];
const { eid: playerEid, mesh: playerMesh } = createPlayer(world, spawn.position);
// (player yaw applied via cameraController if/when API exists; otherwise default 0)
```

## Dependencies

- **#86 Character controller** — required for spawn snap-to-ground. v1 implementation can ship before #86 lands by hard-coding `y = SPAWN_HEIGHT` in spawn points (which works because v1 ground is flat). Snap-to-ground becomes a follow-up tweak after #86.
- No other dependencies. No combat / animation / FSM changes needed.

## Out of Scope for v1

- Shopkeep NPC entity & dialogue — separate issue (#92-ish).
- Weapon pickup spawning / despawning — separate feature.
- Music / ambient SFX — separate feature.
- Multiple arenas / map selection — separate feature.
- Skybox texture / day-night cycle — separate feature.
- Shadows — separate feature, post-MVP.
- Pits, jump pads, height variation — explicitly deferred to v2 maps.
