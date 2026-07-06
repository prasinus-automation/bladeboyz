/**
 * Arena v2 — shared, PURE map data (issue #207 / parent #205).
 *
 * This module is the single source of truth for the Arena v2 terrain shape,
 * material-zone map, and spawn table. It is deliberately free of any Three.js
 * or Rapier runtime imports so it can be imported by BOTH:
 *   - the client builder `createArenaV2.ts` (meshes + colliders), and
 *   - the headless server `server/room.ts` (spawn table only, x/z/yaw).
 *
 * `./terrain` has no runtime dependencies (its `RAPIER`/`GameWorld` imports are
 * type-only), so importing `sampleTerrainHeight` here keeps this module pure —
 * safe to bundle into the Node server (see `server/room.ts`).
 *
 * ─── Determinism ───
 * Every function here is a pure function of its inputs. No `Math.random`, no
 * `Date.now()` — the G7 forbidden-patterns lint and the networking docs both
 * require it. The terrain height sampler is the networking seam: client and
 * server resolve ground-y from the SAME `TERRAIN_SPEC_V2`.
 */

import {
  sampleTerrainHeight,
  makeTerrainHandle,
  type TerrainSpec,
  type TerrainHandle,
} from './terrain';
import { yawTowards } from '../utils/math';

/* ────────────────────────────────────────────────────────────────────────
 * Map dimensions
 * ──────────────────────────────────────────────────────────────────────── */

/** Physical footprint of the map along X and Z (meters). */
export const MAP_SIZE = 100;
/** Half of {@link MAP_SIZE}; the walkable field is (-50 .. +50) on each axis. */
export const MAP_HALF = MAP_SIZE / 2;
/**
 * Heightfield grid cells per axis. Vertices per axis = resolution + 1 = 129,
 * so ~0.78 m cells and ~33k triangles — cheap for a single heightfield.
 */
export const TERRAIN_RESOLUTION = 128;

/* ────────────────────────────────────────────────────────────────────────
 * Central plateau — the castle foundation (CONTRACT for issue #208)
 *
 * The follow-up castle issue builds walls/keep on EXACTLY this footprint.
 * These numbers are the contract; they are documented in docs/arena-v2.md.
 * ──────────────────────────────────────────────────────────────────────── */

/** Flat ground height everywhere before features are summed on top. */
export const BASE_HEIGHT = 0.5;
/** Half-extent of the flat plateau top along X and Z → a 36×36 m square. */
export const PLATEAU_HALF_EXTENT = 18;
/** Smoothstep skirt width beyond the flat top → outer skirt radius ≈ 26 m. */
export const PLATEAU_SKIRT_FALLOFF = 8;
/** Height ADDED above the base at the flat top. */
export const PLATEAU_RISE = 3.5;
/** Absolute world-y of the flat plateau top (= BASE_HEIGHT + PLATEAU_RISE). */
export const PLATEAU_TOP_Y = BASE_HEIGHT + PLATEAU_RISE; // 4.0

/* ────────────────────────────────────────────────────────────────────────
 * Terrain spec
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The authored Arena v2 terrain: a flat base, one central plateau, and four
 * perimeter hills for sightline breaks + verticality. All heights stay well
 * under the #206 raycast origin (max(50, bounds.max.y + 20) = 50), leaving
 * ample headroom for the follow-up castle's towers on top of the plateau.
 */
export const TERRAIN_SPEC_V2: TerrainSpec = {
  sizeX: MAP_SIZE,
  sizeZ: MAP_SIZE,
  resolution: TERRAIN_RESOLUTION,
  baseHeight: BASE_HEIGHT,
  features: [
    // Central plateau (castle foundation). 36×36 flat top at y=4.0.
    {
      kind: 'plateau',
      x: 0,
      z: 0,
      radiusX: PLATEAU_HALF_EXTENT,
      radiusZ: PLATEAU_HALF_EXTENT,
      falloff: PLATEAU_SKIRT_FALLOFF,
      height: PLATEAU_RISE,
    },
    // Four perimeter hills, placed in the angular GAPS between spawn points
    // (spawns sit on a radius-39 ring) so no spawn lands on a steep flank.
    //
    // BOUNDARY-WALL CLEARANCE (issue #207 QA): the north/south hills sit on the
    // wall-perpendicular axis, so their terrain height at the wall line (z=±50)
    // must stay well under the boundary wall's top surface (WALL_TOP_Y ≈ 5 in
    // createArenaV2.ts) — otherwise the terrain overtops the wall and a player
    // can walk off the edge of the collidable world. With center at z=±44 and
    // radius 10 the height at the wall line is ≈1.9 m (base 0.5 + ~1.4), leaving
    // a ~3 m un-climbable lip. The east/west hills are offset OFF the wall axis
    // so their wall-line height stays ≈2.6 m. `createArenaV2.test.ts` pins the
    // invariant `sampleTerrainHeight + autostep < WALL_TOP_Y` along every wall.
    { kind: 'hill', x: 0, z: 44, radius: 10, height: 4 },
    { kind: 'hill', x: 44, z: -14, radius: 11, height: 5 },
    { kind: 'hill', x: 0, z: -44, radius: 10, height: 4 },
    { kind: 'hill', x: -44, z: 14, radius: 10, height: 4 },
  ],
};

/** Ready-to-query handle (spec + bound pure sampler) for `ArenaSpec.terrain`. */
export const TERRAIN_HANDLE_V2: TerrainHandle = makeTerrainHandle(TERRAIN_SPEC_V2);

/* ────────────────────────────────────────────────────────────────────────
 * Material zones — per-vertex color regions (no textures)
 * ──────────────────────────────────────────────────────────────────────── */

export type TerrainZone = 'grass' | 'dirt' | 'stone';

/** Zone → flat vertex color. Grass matches the hemisphere ground tint. */
export const ZONE_COLORS: Record<TerrainZone, number> = {
  grass: 0x556b2f, // olive green (matches HemisphereLight ground color)
  dirt: 0x7c5a34, // path brown
  stone: 0x8a8a8a, // plateau / castle-grounds grey
};

/** Half-width of a dirt path corridor (meters). */
export const PATH_HALF_WIDTH = 3;
/** Distance from center at which a cardinal path begins (just past the plateau). */
export const PATH_INNER_RADIUS = 22;
/**
 * Distance OUTSIDE the flat-top rectangle within which the ground still reads
 * as stone (covers the flat top plus the inner half of the skirt).
 */
const PLATEAU_STONE_SKIRT = 4;

/**
 * Material zone at world (x, z) — a PURE function of the authored layout, so a
 * future minimap or server can reproduce it. Precedence: stone > dirt > grass.
 *
 * - stone: the central plateau (flat top + inner skirt) — the castle grounds.
 * - dirt:  four cardinal paths radiating from the plateau to the map edges.
 * - grass: everything else.
 */
export function sampleTerrainZone(x: number, z: number): TerrainZone {
  const dx = Math.max(0, Math.abs(x) - PLATEAU_HALF_EXTENT);
  const dz = Math.max(0, Math.abs(z) - PLATEAU_HALF_EXTENT);
  const dPlateau = Math.hypot(dx, dz);
  if (dPlateau <= PLATEAU_STONE_SKIRT) return 'stone';

  // Cardinal dirt paths (±X and ±Z corridors), beyond the plateau.
  if (Math.abs(z) <= PATH_HALF_WIDTH && Math.abs(x) >= PATH_INNER_RADIUS) {
    return 'dirt';
  }
  if (Math.abs(x) <= PATH_HALF_WIDTH && Math.abs(z) >= PATH_INNER_RADIUS) {
    return 'dirt';
  }
  return 'grass';
}

/* ────────────────────────────────────────────────────────────────────────
 * Spawn table (x / z / yaw) — shared client↔server, NO y
 *
 * Y is resolved at runtime from `sampleTerrainHeight(TERRAIN_SPEC_V2, x, z)`
 * (client: createArenaV2; server: clients resolve it from the shared function
 * per #206's NetworkSystem fix). Keeping y OUT of this table is what lets the
 * server own the exact same array without importing terrain height math.
 *
 * All 10 spawns sit on a radius-39 ring in OPEN, flat terrain: outside the
 * plateau footprint (bot AI can't path around the future castle) and clear of
 * every hill flank. `yaw = yawTowards(x, z)` faces each spawn toward map center
 * (origin). NOTE: the naive `atan2(-x, -z)` faces AWAY from center under this
 * project's `forward = (-sin yaw, -cos yaw)` convention — see #211/#212.
 * ──────────────────────────────────────────────────────────────────────── */

/** A spawn location without y — shape-compatible with `NetSpawn`. */
export interface ArenaV2Spawn {
  x: number;
  z: number;
  yaw: number;
}

export const ARENA_V2_SPAWNS: ArenaV2Spawn[] = [
  { x: 12, z: 37, yaw: yawTowards(12, 37) },
  { x: 32, z: 23, yaw: yawTowards(32, 23) },
  { x: 39, z: 0, yaw: yawTowards(39, 0) },
  { x: 32, z: -23, yaw: yawTowards(32, -23) },
  { x: 12, z: -37, yaw: yawTowards(12, -37) },
  { x: -12, z: -37, yaw: yawTowards(-12, -37) },
  { x: -32, z: -23, yaw: yawTowards(-32, -23) },
  { x: -39, z: 0, yaw: yawTowards(-39, 0) },
  { x: -32, z: 23, yaw: yawTowards(-32, 23) },
  { x: -12, z: 37, yaw: yawTowards(-12, 37) },
];

/**
 * Resolve the ground-contact y for a spawn: terrain height plus the character
 * controller skin offset. Kept here (not in the shared no-y table) so the
 * server never needs terrain math.
 */
export function spawnGroundY(x: number, z: number, offset: number): number {
  return sampleTerrainHeight(TERRAIN_SPEC_V2, x, z) + offset;
}
