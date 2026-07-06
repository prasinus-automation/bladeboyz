import * as THREE from 'three';
import type { GameWorld } from '../core/types';
import { CHARACTER_CONTROLLER_OFFSET } from '../core/types';
import type { ArenaSpec, SpawnPoint } from './types';
import { addStaticBox } from './addStaticBox';
import { createTerrainCollider, sampleTerrainHeight } from './terrain';
import {
  MAP_SIZE,
  MAP_HALF,
  TERRAIN_RESOLUTION,
  TERRAIN_SPEC_V2,
  TERRAIN_HANDLE_V2,
  ZONE_COLORS,
  sampleTerrainZone,
  ARENA_V2_SPAWNS,
  PLATEAU_TOP_Y,
  spawnGroundY,
} from './arenaV2Spec';
import { clearSpawnPoints, registerSpawnPoint } from '../world/SpawnPoints';

/* ────────────────────────────────────────────────────────────────────────
 * Boundary-wall geometry (exported so the arena test can assert the terrain
 * along every wall line stays below the wall top — see the invariant below).
 * ──────────────────────────────────────────────────────────────────────── */

const COLOR_WALL = 0x8a8a8a;
const WALL_THICKNESS = 0.5;
/**
 * Wall height. The top surface (`WALL_TOP_Y`) must clear the tallest terrain
 * along any wall line by more than the autostep height, or a perimeter hill
 * lets a player step over the wall and off the edge of the heightfield (which
 * ends exactly at ±50 — there is no collider past it). Tallest wall-line
 * terrain today is ≈2.6 m (east hill), so a 5 m top leaves a ~2.4 m lip.
 */
const WALL_HEIGHT = 6;
/** Center y of the wall box; base sits below the terrain, top stands proud. */
const WALL_CENTER_Y = 2;
/** Absolute world-y of the wall's top surface (= center + half height). */
export const WALL_TOP_Y = WALL_CENTER_Y + WALL_HEIGHT / 2; // 5.0

/**
 * Arena v2 — `createArenaV2()` (issue #207 / parent #205).
 *
 * The 100×100 m medieval outdoor map. Builds, in order:
 *   1. The lighting rig — same ambient + hemisphere fill as v1, with the
 *      directional "sun" repositioned to (60, 80, 40) for the larger footprint.
 *      **No shadows** (kept in lockstep with v1, pinned by createArenaV2.test).
 *   2. The terrain — one Rapier heightfield collider (`createTerrainCollider`)
 *      plus a displaced, flat-shaded, vertex-colored `PlaneGeometry` visual
 *      mesh. Both sample `TERRAIN_SPEC_V2` at the SAME grid points, so the
 *      visible surface and the collision surface are byte-for-byte parallel
 *      (a dropped entity rests exactly on the mesh).
 *   3. The 4 boundary walls at ±50.25 (top surface at y=5, standing proud of
 *      the terrain along every wall line) via the shared `addStaticBox` helper.
 *   4. The 10 spawn points — registered into `world/SpawnPoints.ts` and
 *      returned on the `ArenaSpec`. Spawn y is resolved from the terrain
 *      sampler, so respawns land on the real surface.
 *
 * The central plateau (36×36 m flat top at y≈4) is authored in `arenaV2Spec.ts`
 * and left bare here — it is the foundation the follow-up castle issue (#208)
 * builds on. See `docs/arena-v2.md` for the plateau contract.
 *
 * Colors / material zones are per-vertex on the terrain mesh (no textures):
 * grass (olive), dirt (path brown), stone (plateau). `sampleTerrainZone(x, z)`
 * is the shared pure zone function so a future minimap/server can reproduce it.
 */
export function createArenaV2(world: GameWorld): ArenaSpec {
  // ─── Lighting ───
  // Ambient + hemisphere fill carry over from v1 verbatim. The directional
  // sun moves out to (60, 80, 40) so the whole 100 m field is lit from the
  // same angle; intensity/colors unchanged.
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  world.scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
  hemi.position.set(0, 50, 0);
  world.scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff5e0, 0.7);
  sun.position.set(60, 80, 40);
  sun.target.position.set(0, 0, 0);
  world.scene.add(sun);
  world.scene.add(sun.target);

  // ─── Terrain collider (Rapier heightfield) ───
  createTerrainCollider(world, TERRAIN_SPEC_V2);

  // ─── Terrain visual mesh ───
  // PlaneGeometry with `TERRAIN_RESOLUTION` segments has vertices at exactly
  // the same grid as buildTerrainHeights (`x = (col/res - 0.5)*size`), so the
  // mesh and collider are same-source — no ±cell/2 drift. We displace y and
  // assign the vertex color IN THE SAME LOOP so zone color and height can
  // never disagree.
  const geo = new THREE.PlaneGeometry(
    MAP_SIZE,
    MAP_SIZE,
    TERRAIN_RESOLUTION,
    TERRAIN_RESOLUTION,
  );
  // Lay the plane flat in the XZ plane. `geometry.rotateX` BAKES the rotation
  // into the position attribute, so afterward getX/getZ return world x/z
  // directly (the mesh itself is placed at the origin with no transform).
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, sampleTerrainHeight(TERRAIN_SPEC_V2, x, z));
    c.setHex(ZONE_COLORS[sampleTerrainZone(x, z)]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // flatShading ignores vertex normals, but we compute them anyway so the mesh
  // is well-formed if the material is ever switched to smooth shading.
  geo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
  });
  const terrainMesh = new THREE.Mesh(geo, terrainMat);
  world.scene.add(terrainMesh);

  // ─── Boundary walls ───
  // Stone-grey walls at ±50.25 (half-thickness 0.25 → inside face at ±50).
  // 6 m tall, centered at y=2 so the base sits 1 m below the terrain edge and
  // the top (WALL_TOP_Y = 5) stands proud of every point of terrain along the
  // wall lines — the perimeter hills top out at ≈2.6 m there, leaving a ~2.4 m
  // un-climbable lip so a player can never step over the wall and off the map.
  const WALL_SPAN = MAP_SIZE + WALL_THICKNESS; // overlap corners, no seam
  const wallOffset = MAP_HALF + WALL_THICKNESS / 2; // 50.25
  addStaticBox(
    world,
    { x: 0, y: WALL_CENTER_Y, z: -wallOffset },
    { x: WALL_SPAN, y: WALL_HEIGHT, z: WALL_THICKNESS },
    COLOR_WALL,
  );
  addStaticBox(
    world,
    { x: 0, y: WALL_CENTER_Y, z: wallOffset },
    { x: WALL_SPAN, y: WALL_HEIGHT, z: WALL_THICKNESS },
    COLOR_WALL,
  );
  addStaticBox(
    world,
    { x: wallOffset, y: WALL_CENTER_Y, z: 0 },
    { x: WALL_THICKNESS, y: WALL_HEIGHT, z: WALL_SPAN },
    COLOR_WALL,
  );
  addStaticBox(
    world,
    { x: -wallOffset, y: WALL_CENTER_Y, z: 0 },
    { x: WALL_THICKNESS, y: WALL_HEIGHT, z: WALL_SPAN },
    COLOR_WALL,
  );

  // ─── Spawn points ───
  // Resolve each spawn's y from the terrain sampler + the controller skin
  // offset (same rule as spawnAtGround). The x/z/yaw come from the shared
  // ARENA_V2_SPAWNS table, which the server imports verbatim (no y) — that
  // shared source is what keeps the client and server spawn tables in lockstep.
  const spawnPoints: SpawnPoint[] = ARENA_V2_SPAWNS.map((s, i) => ({
    id: `s${i + 1}`,
    position: {
      x: s.x,
      // Shared with the server-facing sampler — same formula, one source.
      y: spawnGroundY(s.x, s.z, CHARACTER_CONTROLLER_OFFSET),
      z: s.z,
    },
    facing: s.yaw,
  }));

  // Mirror into the world spawn-point registry (numeric ids 1..N; 0 stays the
  // "no spawn point" sentinel). The arena owns spawn ground truth, so clear
  // any placeholders / prior-arena points first.
  clearSpawnPoints();
  for (let i = 0; i < spawnPoints.length; i++) {
    const sp = spawnPoints[i];
    registerSpawnPoint({
      id: i + 1,
      position: { x: sp.position.x, y: sp.position.y, z: sp.position.z },
      yaw: sp.facing,
    });
  }

  // ─── ArenaSpec ───
  // bounds: inside-walls AABB (±50) with generous vertical headroom (0..30) —
  // above any terrain feature + future towers, below the #206 raycast origin.
  const bounds = {
    min: { x: -MAP_HALF, y: 0, z: -MAP_HALF },
    max: { x: MAP_HALF, y: 30, z: MAP_HALF },
  };

  // Shopkeep stall near (not on) the plateau's +Z approach. createShopkeep
  // ground-snaps in #206, so only x/z matter for the NPC; the counter prop is
  // placed on the flat grass just outside the plateau skirt.
  const stallZ = 33;
  const stallGroundY = sampleTerrainHeight(TERRAIN_SPEC_V2, 0, stallZ);
  const shopkeepStall = {
    counter: {
      min: { x: -1.5, y: stallGroundY, z: stallZ - 0.25 },
      max: { x: 1.5, y: stallGroundY + 1, z: stallZ + 0.25 },
    },
    npcAnchor: {
      x: 0,
      y: stallGroundY + CHARACTER_CONTROLLER_OFFSET,
      z: stallZ + 1,
    },
    facing: Math.PI, // face -Z toward the plateau / map center
  };

  // Weapon-pickup safe volume: inside-walls minus a 0.5 m margin. The y-max is
  // 20 (not v1's 10) so the plateau (≈4) plus future ramparts stay contained.
  const weaponPickupSafeVolume = {
    min: { x: -(MAP_HALF - 0.5), y: 0, z: -(MAP_HALF - 0.5) },
    max: { x: MAP_HALF - 0.5, y: 20, z: MAP_HALF - 0.5 },
  };

  return {
    name: 'arena_v2',
    // Flat-ground fallback is unused when `terrain` is set, but keep it at the
    // plateau top as a sane non-zero value for any code that reads it directly.
    groundHeight: PLATEAU_TOP_Y,
    terrain: TERRAIN_HANDLE_V2,
    bounds,
    spawnPoints,
    shopkeepStall,
    weaponPickupSafeVolume,
  };
}
