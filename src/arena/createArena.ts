import * as THREE from 'three';
import type { GameWorld } from '../core/types';
import type { ArenaSpec } from './types';

/**
 * Arena v1 — `createArena()` (issue #91).
 *
 * **This is the lighting-only stub** (issue #117). It adds the v1 lighting
 * rig and returns a placeholder `ArenaSpec`. The geometry sub-issue (#112)
 * fills in ground / walls / pillars / obstacles / spawn-points / shopkeep
 * stall and the populated `ArenaSpec` fields, **without touching this
 * lighting block**. Once both ship, this file owns the entire arena.
 *
 * Design doc: `docs/arena-v1.md` § *Lighting Plan*. The exact values below
 * (color, intensity, position) come straight from that table — change here
 * AND in the doc together.
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
 * a perf budget the low-poly aesthetic doesn't warrant. See `docs/arena-v1.md`.
 *
 * **Background** is owned by `World.ts` (`scene.background = 0x87ceeb`),
 * not this function — it's an engine default, not map data.
 */
export function createArena(world: GameWorld): ArenaSpec {
  // ─── Ambient ───
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  world.scene.add(ambient);

  // ─── Hemisphere (sky/ground tint) ───
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
  hemi.position.set(0, 50, 0);
  world.scene.add(hemi);

  // ─── Directional ("sun") ───
  const sun = new THREE.DirectionalLight(0xfff5e0, 0.7);
  sun.position.set(15, 25, 10);
  // Aim at origin. Three.js requires the target be added to the scene for
  // its world matrix to update; otherwise the light points in a default
  // direction regardless of `target.position`.
  sun.target.position.set(0, 0, 0);
  world.scene.add(sun);
  world.scene.add(sun.target);

  // ─── ArenaSpec stub ───
  // Geometry, spawn points, and shopkeep stall data are owned by #112.
  // Keep `groundHeight: 0.1` consistent with `SPAWN_HEIGHT` math in
  // `core/types.ts`; the rest are zero-volume placeholders so consumers
  // can read the field shape without crashing on `undefined` access.
  const zeroVolume = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  };
  return {
    name: 'arena_v1',
    groundHeight: 0.1,
    bounds: zeroVolume,
    spawnPoints: [],
    shopkeepStall: {
      counter: zeroVolume,
      npcAnchor: { x: 0, y: 0, z: 0 },
      facing: 0,
    },
    weaponPickupSafeVolume: zeroVolume,
  };
}
