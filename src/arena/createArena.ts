import * as THREE from 'three';
import type { GameWorld } from '../core/types';
import { CHARACTER_CONTROLLER_OFFSET, GROUND_TOP_Y } from '../core/types';
import type { ArenaSpec, SpawnPoint, Vec3 } from './types';
import {
  clearSpawnPoints,
  registerSpawnPoint,
} from '../world/SpawnPoints';

/**
 * Arena v1 — `createArena()` (issues #91 / #112).
 *
 * Builds the entire v1 arena:
 *   1. The lighting rig (issue #117 — already shipped, kept verbatim below).
 *   2. The 9 static props from `docs/arena-v1.md` § *Static Geometry Inventory*
 *      (ground, 4 walls, 2 pillars, shop counter, shop back wall) as
 *      `THREE.BoxGeometry` meshes plus matching Rapier `RigidBodyType.Fixed`
 *      cuboid colliders with **identical** half-extents.
 *   3. The 6 spawn points from § *Spawn Points* — exposed both via the
 *      returned `ArenaSpec.spawnPoints` (string-id, `facing` field — arena
 *      type) and registered into `src/world/SpawnPoints.ts`'s registry
 *      (numeric-id, `yaw` field — that registry is what `processRespawns` /
 *      `createPlayer` consult). The arena owns spawn-point ground truth,
 *      so we `clearSpawnPoints()` first to wipe any placeholders.
 *   4. The shopkeep stall AABB / NPC anchor and the weapon-pickup safe
 *      volume per the design doc.
 *
 * Lights:
 *   1. `AmbientLight(0xffffff, 0.35)` — subtle global fill so unlit faces
 *      aren't pure black.
 *   2. `HemisphereLight(0x87ceeb sky, 0x556b2f ground, 0.5)` — sky-tint up,
 *      ground-tint down. Sky color matches `scene.background`; ground color
 *      matches the olive-green arena floor. This is the new addition for v1
 *      and is what makes low-poly geometry read cleanly without textures.
 *   3. `DirectionalLight(0xfff5e0 warm white, 0.7)` — the "sun", angled
 *      from `(15, 25, 10)` toward the origin so vertical surfaces get a
 *      warm-side / cool-side read against the cool hemisphere fill.
 *
 * **No shadows.** `castShadow` / `receiveShadow` / `renderer.shadowMap` are
 * deliberately not enabled — they require shadow-camera tuning, biases, and
 * a perf budget the low-poly aesthetic doesn't warrant.
 *
 * **Background** is owned by `World.ts` (`scene.background = 0x87ceeb`),
 * not this function — it's an engine default, not map data.
 *
 * **Mesh / collider 1:1.** Three.js `BoxGeometry(w, h, d)` takes full extents.
 * Rapier `cuboid(hx, hy, hz)` takes half-extents. So for every prop we pass
 * `(size.x / 2, size.y / 2, size.z / 2)` to `cuboid`. Helper `addStaticBox`
 * enforces this.
 *
 * **Ground top stays at `y = 0.1`.** This is `GROUND_TOP_Y` from
 * `core/types.ts` and the feet-origin spawn math depends on it. Don't
 * change the ground cuboid's center / size without updating that constant.
 */
export function createArena(world: GameWorld): ArenaSpec {
  // ─── Lighting (issue #117) ───
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  world.scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
  hemi.position.set(0, 50, 0);
  world.scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff5e0, 0.7);
  sun.position.set(15, 25, 10);
  // Aim at origin. Three.js requires the target be added to the scene for
  // its world matrix to update; otherwise the light points in a default
  // direction regardless of `target.position`.
  sun.target.position.set(0, 0, 0);
  world.scene.add(sun);
  world.scene.add(sun.target);

  // ─── Static geometry (issue #112) ───
  // Tiny helper: every prop is a BoxGeometry mesh + Rapier static cuboid
  // with half-extents = (w/2, h/2, d/2). Keeps the body of createArena
  // readable as a sequence of "place box at center with size and color".
  function addStaticBox(
    center: Vec3,
    size: { x: number; y: number; z: number },
    color: number,
  ): void {
    // Visual mesh
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(center.x, center.y, center.z);
    world.scene.add(mesh);

    // Rapier static collider with matching half-extents
    const bodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(
      center.x,
      center.y,
      center.z,
    );
    const body = world.physicsWorld.createRigidBody(bodyDesc);
    const colliderDesc = world.rapier.ColliderDesc.cuboid(
      size.x / 2,
      size.y / 2,
      size.z / 2,
    );
    world.physicsWorld.createCollider(colliderDesc, body);
  }

  // Colors — kept inline rather than as named constants because they're
  // visual-tuning values, not architectural choices. If we extract a palette
  // it should live in a separate `src/arena/palette.ts`.
  const COLOR_GROUND = 0x556b2f; // olive
  const COLOR_WALL = 0x6b6b5a; // warm grey
  const COLOR_PILLAR = 0x8a8a8a; // light grey
  const COLOR_WOOD = 0x6e4a2a; // wood brown (shop counter + back wall)

  // 1. Ground — top surface at y = 0.1 = GROUND_TOP_Y. Keep this exact.
  addStaticBox({ x: 0, y: 0, z: 0 }, { x: 30, y: 0.2, z: 30 }, COLOR_GROUND);

  // 2-5. Perimeter walls — slight overlap into corners so there's no seam.
  addStaticBox({ x: 0, y: 1, z: -15.25 }, { x: 30.5, y: 2, z: 0.5 }, COLOR_WALL);
  addStaticBox({ x: 0, y: 1, z: 15.25 }, { x: 30.5, y: 2, z: 0.5 }, COLOR_WALL);
  addStaticBox({ x: 15.25, y: 1, z: 0 }, { x: 0.5, y: 2, z: 30.5 }, COLOR_WALL);
  addStaticBox({ x: -15.25, y: 1, z: 0 }, { x: 0.5, y: 2, z: 30.5 }, COLOR_WALL);

  // 6-7. Cover pillars at (±5, 0). Mirror-symmetric across z=0; they break
  // line-of-sight through the central killing floor without sealing it.
  addStaticBox({ x: -5, y: 1.5, z: 0 }, { x: 2, y: 3, z: 2 }, COLOR_PILLAR);
  addStaticBox({ x: 5, y: 1.5, z: 0 }, { x: 2, y: 3, z: 2 }, COLOR_PILLAR);

  // 8. Shop counter (waist-high, in the SW corner, faces north into arena).
  addStaticBox({ x: -12, y: 0.5, z: 12 }, { x: 3, y: 1, z: 0.5 }, COLOR_WOOD);

  // 9. Shop back wall — hides the SW corner behind the shopkeep stall.
  addStaticBox({ x: -13.25, y: 1.5, z: 12 }, { x: 0.5, y: 3, z: 4 }, COLOR_WOOD);

  // ─── Spawn points (issue #112) ───
  // SpawnPoint table from docs/arena-v1.md § *Spawn Points*. Yaw computed
  // from `Math.atan2(-deltaX, -deltaZ)` so each spawn faces the arena
  // center. The `y = 0.1` matches `GROUND_TOP_Y` (feet origin); when the
  // character controller eventually does spawn snap-to-ground (#86) it'll
  // raycast from these positions. v1 ground is flat so the static value
  // works directly.
  // Spawn Y must sit `CHARACTER_CONTROLLER_OFFSET` above the ground top —
  // otherwise the player's capsule bottom is flush with the floor at
  // spawn, Rapier's kinematic character controller can't establish its
  // required collision skin, and `computeColliderMovement` clamps every
  // axis (including horizontal) to zero. `spawnAtGround()` already
  // follows this convention; arena spawn points were the lone outlier.
  const SPAWN_Y = GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET;
  // Computed exactly from the architect note: atan2(7, 9) etc. Using
  // `as const` so TypeScript infers tuple types and we keep the table
  // literal for review.
  const spawnPoints: SpawnPoint[] = [
    {
      id: 's1',
      position: { x: -13, y: SPAWN_Y, z: 0 },
      facing: Math.PI / 2, // faces +X (east) toward center
    },
    {
      id: 's2',
      position: { x: -7, y: SPAWN_Y, z: -9 },
      facing: Math.atan2(7, 9),
    },
    {
      id: 's3',
      position: { x: 7, y: SPAWN_Y, z: -9 },
      facing: Math.atan2(-7, 9),
    },
    {
      id: 's4',
      position: { x: 13, y: SPAWN_Y, z: 0 },
      facing: -Math.PI / 2, // faces -X (west) toward center
    },
    {
      id: 's5',
      position: { x: -7, y: SPAWN_Y, z: 9 },
      facing: Math.atan2(7, -9),
    },
    {
      id: 's6',
      position: { x: 7, y: SPAWN_Y, z: 9 },
      facing: Math.atan2(-7, -9),
    },
  ];

  // Mirror the spawn points into `src/world/SpawnPoints.ts`'s registry —
  // that's what `processRespawns` and `createPlayer` consult. We `clear()`
  // first because the arena owns the spawn-point ground truth: stale
  // placeholders from `seedPlaceholderSpawnPoints()` (or a previous
  // createArena call in tests) would otherwise pollute selection.
  //
  // Numeric id is index+1 so 0 stays the "no spawn point" sentinel that
  // `RespawnEvent.spawnPointId` relies on. The arena `SpawnPoint.id` is
  // a string ("s1".."s6"); the world registry's id is a number; we
  // translate here once.
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
  // `bounds` is the inside-walls AABB. With the perimeter walls at
  // x = ±15.25 (center) and half-thickness 0.25, the inside face is at
  // x = ±15. Same for z. Y bounds are 0 (ground) to 10 (arbitrary headroom
  // — high enough that any ballistic motion stays clamped above the floor).
  const bounds = {
    min: { x: -15, y: 0, z: -15 },
    max: { x: 15, y: 10, z: 15 },
  };

  // The shop counter prop is centered at (-12, 0.5, 12) with size
  // (3, 1, 0.5), so the AABB is (x, y, z) ∈ ([-13.5, -10.5], [0, 1],
  // [11.75, 12.25]). NPC anchor sits BEHIND the counter at (-12, 0.1, 13)
  // — feet on ground, looking north (yaw 0 = -Z).
  const shopkeepStall = {
    counter: {
      min: { x: -13.5, y: 0, z: 11.75 },
      max: { x: -10.5, y: 1, z: 12.25 },
    },
    npcAnchor: { x: -12, y: SPAWN_Y, z: 13 },
    facing: 0, // 0 = facing -Z (north / arena interior)
  };

  // Inside-walls AABB minus a 0.5m margin (so dropped weapons don't clip
  // wall colliders). The Y range is 0..10 to match `bounds`.
  const weaponPickupSafeVolume = {
    min: { x: -14.5, y: 0, z: -14.5 },
    max: { x: 14.5, y: 10, z: 14.5 },
  };

  return {
    name: 'arena_v1',
    groundHeight: 0.1,
    bounds,
    spawnPoints,
    shopkeepStall,
    weaponPickupSafeVolume,
  };
}
