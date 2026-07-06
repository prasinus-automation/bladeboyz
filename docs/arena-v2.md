# Arena v2 — 100×100 m medieval map (issue #207 / parent #205)

Arena v2 is the second BladeBoyz map: a 100×100 m (~11× the v1 area) outdoor
medieval field built on the terrain engine from #206. It replaces Arena v1 as
the map the game boots into (`src/main.ts` → `createArenaV2`). Arena v1
(`createArena.ts`) is kept for its tests and as a small flat reference arena.

**Slices:** this issue delivers terrain, ground visuals + material zones,
boundary walls, lighting, spawns, and the client/server switchover. The
**castle** (keep, curtain walls, gatehouse, props) is a follow-up issue (#208)
that builds on the central plateau defined below.

## Source of truth

| Concern | File |
|---|---|
| Terrain spec, zones, spawn table (pure data) | `src/arena/arenaV2Spec.ts` |
| Client builder (meshes, colliders, lights) | `src/arena/createArenaV2.ts` |
| Shared static-box helper | `src/arena/addStaticBox.ts` |
| Server spawn table (imports the shared list) | `server/room.ts` |

`arenaV2Spec.ts` has **no** Three.js/Rapier runtime imports, so the headless
server bundles it for the spawn table without pulling in the renderer.

## Layout (top-down, +Z is "south" / toward camera, -Z "north")

```
            -Z (north)
   ┌──────────────────────────────────┐
   │  S6      H3(0,-44)        S5      │
   │      S7                      S4   │   H = hill (peak height)
   │                                   │   S = spawn point
   │ H4          ┌────────┐         H2 │   ▓ = stone plateau (castle site)
-X │(-44,14)     │▓▓▓▓▓▓▓▓│  S3  (44,  │ +X
   │ S8 ─────────┤▓ PLAT ▓├──────── -14│      cardinal dirt paths ── ─── ──
   │             │▓ y=4  ▓│            │
   │      S9     └────────┘      S2    │
   │                                   │
   │  S10     H1(0,44)         S1      │
   └──────────────────────────────────┘
            +Z (south)
   Boundary walls at x,z = ±50.25 (stone, 6 m tall, top y=5)
```

## Terrain features

Grid: `resolution = 128` → 129×129 vertices, ~0.78 m cells, ~33k triangles.
Base (flat) height **0.5 m**. Features are summed analytically on top.

| Feature | Center (x,z) | Size | Peak/top height |
|---|---|---|---|
| **Central plateau** | (0, 0) | flat top ±18 (36×36 m), skirt +8 | **y = 4.0** |
| Hill H1 | (0, 44) | radius 10 | 0.5 + 4 = 4.5 |
| Hill H2 | (44, −14) | radius 11 | 0.5 + 5 = 5.5 |
| Hill H3 | (0, −44) | radius 10 | 0.5 + 4 = 4.5 |
| Hill H4 | (−44, 14) | radius 10 | 0.5 + 4 = 4.5 |

Max terrain height (5.5 m) + any future tower stays far under the #206 raycast
origin (`max(50, bounds.max.y + 20) = 50`), so `spawnAtGround` always hits.

**Boundary-wall clearance (issue #207 QA fix):** the north/south hills (H1/H3)
lie on the wall-perpendicular axis, so their height *at the wall line* (z = ±50)
must stay under the wall's top surface (`WALL_TOP_Y = 5`) — otherwise the raised
terrain overtops the buried wall and a player can walk off the edge of the
heightfield (there is no collider past ±50). With center z = ±44 / radius 10 the
wall-line height is ≈1.9 m, leaving a ~3 m un-climbable lip. The east/west hills
are offset off their wall axis, so their wall-line height stays ≈2.6 m. The
invariant `sampleTerrainHeight + AUTOSTEP_MAX_HEIGHT < WALL_TOP_Y` is asserted
along every wall line by `createArenaV2.test.ts`.

### Plateau contract (issue #208 depends on these EXACT numbers)

The castle issue builds walls/keep on this footprint. Pinned by
`arenaV2Spec.test.ts` — do not change without updating #208.

| Constant (`arenaV2Spec.ts`) | Value | Meaning |
|---|---|---|
| `PLATEAU_HALF_EXTENT` | 18 | flat top is `|x|,|z| ≤ 18` → **36×36 m** |
| `PLATEAU_SKIRT_FALLOFF` | 8 | smoothstep skirt → outer radius ≈ **26 m** |
| `PLATEAU_TOP_Y` | 4.0 | absolute world-y of the flat top |
| `BASE_HEIGHT` | 0.5 | surrounding grass height |

The plateau is a `plateau` terrain feature: full height on the flat top,
smoothstep ramp down across the skirt (a walkable slope up to the castle).

## Material zones (per-vertex colors — no textures)

`sampleTerrainZone(x, z)` is a **pure** function of the authored layout so a
future minimap or server can reproduce it. Precedence: stone > dirt > grass.

| Zone | Color | Where |
|---|---|---|
| **stone** `0x8a8a8a` | grey | the plateau (flat top + inner skirt), i.e. the castle grounds |
| **dirt** `0x7c5a34` | brown | four cardinal paths (±X, ±Z corridors, half-width 3 m) from the plateau out to the edges, starting at radius 22 |
| **grass** `0x556b2f` | olive | everything else (matches the hemisphere light's ground tint) |

Colors are written to the terrain mesh's `color` vertex attribute in the same
loop that displaces the vertex height, so zone and height can never disagree.
Material is `MeshStandardMaterial({ vertexColors: true, flatShading: true })`.

## Spawn points (10)

All spawns sit on a **radius-39 ring** in open, flat grass — outside the
plateau footprint (bot AI has no pathfinding around the future castle) and
clear of every hill flank. Yaw faces map center (`atan2(-x, -z)`). Y is
resolved at runtime from `sampleTerrainHeight + CHARACTER_CONTROLLER_OFFSET`
(≈ 0.52 m, since every spawn is on flat base terrain).

The **x/z/yaw** table lives in `ARENA_V2_SPAWNS` (`arenaV2Spec.ts`) and is
imported verbatim by both the client builder and the server. The table carries
**no y** — clients resolve ground-y from the shared terrain sampler (#206), so
the server never needs terrain math. A deep-equal test in `server/room.test.ts`
pins client↔server lockstep.

| id | x | z | id | x | z |
|----|-----|-----|----|-----|-----|
| s1 | 12 | 37 | s6 | −12 | −37 |
| s2 | 32 | 23 | s7 | −32 | −23 |
| s3 | 39 | 0 | s8 | −39 | 0 |
| s4 | 32 | −23 | s9 | −32 | 23 |
| s5 | 12 | −37 | s10 | −12 | 37 |

Respawn selection uses `selectSpawnPoint`, whose `minEnemyDistance` default (8)
is left unchanged: `processRespawns` is arena-agnostic and shared with v1's
tighter 30 m arena, so a global bump would over-constrain v1. With 10 spawns on
a 78 m-diameter ring the default already spreads respawns well; a per-arena
override (16 m for v2) is a reasonable future tweak once selection is
arena-aware.

## Boundary & spec

- **Walls:** 4 stone cuboids at `±50.25` (inside face at `±50`), 0.5 m thick,
  6 m tall (center y = 2 → top surface `WALL_TOP_Y = 5`), color `0x8a8a8a`.
  Built via the shared `addStaticBox` helper. The top clears the tallest
  wall-line terrain (≈2.6 m) by a ~2.4 m un-climbable lip so the wall genuinely
  bounds the map (see *Boundary-wall clearance* above).
- **bounds:** `{ min: (−50, 0, −50), max: (50, 30, 50) }`.
- **weaponPickupSafeVolume:** inside-walls minus 0.5 m; **y-max = 20** (so the
  plateau at 4 m + future ramparts stay contained — not v1's 10).
- **shopkeepStall:** on the flat grass just off the plateau's +Z approach,
  NPC anchor at `(0, ~0.52, 34)` facing −Z (toward the plateau). `createShopkeep`
  ground-snaps, so only x/z are authoritative.

## Lighting

Same rig as v1, sun repositioned for the larger field. **No shadows.**

- `AmbientLight(0xffffff, 0.35)`
- `HemisphereLight(0x87ceeb sky, 0x556b2f ground, 0.5)` at (0, 50, 0)
- `DirectionalLight(0xfff5e0, 0.7)` at **(60, 80, 40)** → origin

## Castle (#208) — the plateau centerpiece

Built by `src/arena/createCastle.ts` (`createCastle(world, origin)`) and the
map-wide props by `src/arena/props.ts` (`addMedievalProps(world, arena)`). Both
are composed from `src/main.ts` right after `createArenaV2` — **client-only**
geometry (flat-colored `BoxGeometry` + 1:1 Rapier fixed cuboid colliders via the
shared `addStaticBox` helper), so the headless server (which bundles only
`arenaV2Spec.ts`) never pulls them in. `createArenaV2` itself is unchanged.

`origin` is the plateau center at its flat top: `{ x: 0, y: PLATEAU_TOP_Y, z: 0 }`
(`PLATEAU_TOP_Y = 4.0`). Every castle box is placed relative to it, so re-tuning
the plateau moves the whole castle. All dimensions are named constants at the top
of `createCastle.ts`.

### Castle dimensions (constants in `createCastle.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `WALL_HALF` | 15 | curtain-wall footprint half-extent → **30×30 m** (inside the 36×36 plateau) |
| `WALL_HEIGHT` | 6 | wall height; **rampart walkway** at `origin.y + 6 = y≈10` |
| `WALL_THICKNESS` | 1.2 | wall top = the walkway (room to fight) |
| `PARAPET_HEIGHT` / `PARAPET_THICKNESS` | 0.8 / 0.3 | low cover on the **outer** rampart lip only (inner edge open → drop into courtyard) |
| `GATE_HALF_WIDTH` | 2 | gate opening = **4 m** wide |
| `GATE_CLEAR_HEIGHT` | 4.5 | gate opening clear height (floor → `y≈8.5`, lintel above) |
| `GATE_TOWER_SIZE` | 3 | two 3×3 towers flanking the gate |
| `CORNER_TOWER_SIZE` | 4 | four 4×4 corner towers (reach ±17 → on the flat top) |
| `CORNER_TOWER_PARAPET_RISE` | 3 | corner parapet rises to `y≈13` (~9 m tall silhouette) |
| `KEEP_SIZE` / `KEEP_HEIGHT` | 8 / 6 | central keep; roof at `y≈10`, reached by an external stair |
| `RAMPART_STAIR` | 24×0.25 | two courtyard staircases, step **rise 0.25 ≤ 0.3** (`AUTOSTEP_MAX_HEIGHT`), tread 0.5 |
| `KEEP_STAIR` | 24×0.25 | keep external stair, rise 0.25, tread 0.4 |

### Layout & verticality

- **Curtain walls**: N/E/W solid; the **S (+Z) wall is segmented** around the
  gate (left segment + right segment + two gate towers + a lintel bridging the
  top). No CSG — the opening is the gap between the two gate towers, and the
  lintel carries the rampart walkway across it. The gate faces +Z, toward the
  dirt path and the market stall.
- **Ramparts**: the wall tops form a **continuous, level walkway** at `y≈10`.
  Corner towers and gate towers are solid shafts topped flush with the walkway,
  so you can walk the full circuit — over the gate lintel and across every tower
  platform — and drop back into the courtyard over the open inner edge.
- **Corner towers** carry an L-shaped parapet on their two outer edges rising to
  `y≈13`, giving the ~9 m tower silhouette while leaving the platform walkable.
- **Stairs**: two staircases hug the inner faces of the W and E walls and climb
  the courtyard floor (`y≈4`) to the ramparts (`y≈10`); step rise 0.25 m climbs
  with plain W (no jump). A **unit test** (`createCastle.test.ts`) pins
  `stepRise ≤ AUTOSTEP_MAX_HEIGHT` for every stair spec.
- **Courtyard**: kept mostly open (fight arena). A central 8×8×6 m **keep** with
  an external stair to its roof, a stone **well** (+X/+Z pocket), and two
  **crate** clusters.

### Containment

Everything stays on the plateau flat top (`|x|,|z| ≤ 18`) and under the
`weaponPickupSafeVolume` ceiling (y-max 20): the tallest element is a corner
parapet at `y≈13`, so weapon drops on the ramparts (`y≈10`) are born inside the
safe volume. Pinned by `createCastle.test.ts`.

### Map-wide medieval props (`props.ts`)

A redressed **market stall** at the shopkeep counter location (`ShopkeepStallSpec`
on the +Z gatehouse approach — `createArenaV2` authors the AABB, this builds the
geometry), plus a cart, hay bales, a fence line, a ruined wall, and a barrel
cluster scattered on the open grass, clear of the spawn ring, paths, hills, and
plateau. Props rest on the terrain via `getGroundHeightAt`. **Collider policy**:
every prop ≥0.4 m tall gets its 1:1 collider; thin decorative trim (cart wheels,
fence rails, raised hay/awning) is mesh-only — the character controller autosteps
over it anyway.

## Out of scope (follow-ups)

Bot pathfinding around the castle (bots will bump walls — known limitation),
minimap, water, fog. Interior tower/keep rooms (open platforms only), working
gates/doors.
