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
   │  S6      H3(0,-46)        S5      │
   │      S7                      S4   │   H = hill (peak height)
   │                                   │   S = spawn point
   │ H4          ┌────────┐         H2 │   ▓ = stone plateau (castle site)
-X │(-44,14)     │▓▓▓▓▓▓▓▓│  S3  (44,  │ +X
   │ S8 ─────────┤▓ PLAT ▓├──────── -14│      cardinal dirt paths ── ─── ──
   │             │▓ y=4  ▓│            │
   │      S9     └────────┘      S2    │
   │                                   │
   │  S10     H1(0,46)         S1      │
   └──────────────────────────────────┘
            +Z (south)
   Boundary walls at x,z = ±50.25 (stone, 4 m tall)
```

## Terrain features

Grid: `resolution = 128` → 129×129 vertices, ~0.78 m cells, ~33k triangles.
Base (flat) height **0.5 m**. Features are summed analytically on top.

| Feature | Center (x,z) | Size | Peak/top height |
|---|---|---|---|
| **Central plateau** | (0, 0) | flat top ±18 (36×36 m), skirt +8 | **y = 4.0** |
| Hill H1 | (0, 46) | radius 12 | 0.5 + 6 = 6.5 |
| Hill H2 | (44, −14) | radius 11 | 0.5 + 5 = 5.5 |
| Hill H3 | (0, −46) | radius 12 | 0.5 + 7 = 7.5 |
| Hill H4 | (−44, 14) | radius 10 | 0.5 + 4 = 4.5 |

Max terrain height (7.5 m) + any future tower stays far under the #206 raycast
origin (`max(50, bounds.max.y + 20) = 50`), so `spawnAtGround` always hits.

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
  4 m tall (center y = 1.5), color `0x8a8a8a`. Built via the shared
  `addStaticBox` helper.
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

## Out of scope (follow-ups)

Castle + medieval props (#208, builds on the plateau), bot pathfinding,
minimap, water, fog.
