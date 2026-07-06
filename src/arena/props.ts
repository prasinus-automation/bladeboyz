/**
 * `addMedievalProps` — map-wide medieval dressing for Arena v2 (issue #208).
 *
 * Scattered decorative clusters OUTSIDE the castle: a redressed market stall on
 * the gatehouse approach (where `ArenaSpec.shopkeepStall` puts the shopkeep),
 * plus carts, hay bales, fence lines, a ruined wall, and barrels along the open
 * grass. Same rules as the castle: flat-colored `BoxGeometry` + 1:1 Rapier
 * cuboid colliders via `addStaticBox`, no textures/shadows.
 *
 * Ground y at each spot comes from the shared terrain sampler
 * (`getGroundHeightAt`), so props rest on the real (variable-height) surface.
 *
 * Collider policy (issue #208): any prop ≥0.4 m tall gets its 1:1 collider;
 * purely decorative items under ~0.3 m (cart wheels, thin fence rails) SKIP the
 * collider — the character controller autosteps over them anyway — and are
 * added as bare meshes. Each such choice is called out inline.
 */

import * as THREE from 'three';
import type { GameWorld } from '../core/types';
import type { ArenaSpec, Vec3 } from './types';
import { getGroundHeightAt } from './types';
import { addStaticBox, type StaticHandle } from './addStaticBox';

/* ── Colors (warm / earthy flat tints) ── */
const COLOR_WOOD = 0x6e4a2a; // cart, stall counter, posts
const COLOR_WOOD_LIGHT = 0x8a6a3a; // barrels
const COLOR_HAY = 0xc9a227; // hay bales
const COLOR_CLOTH = 0x9c3b2e; // market awning
const COLOR_STONE = 0x8a8a8a; // ruined wall fragments
const COLOR_FENCE = 0x5a3f22; // fence posts/rails

/**
 * Add every medieval prop cluster to the world. Returns the placed static-box
 * handles (colliders); bare decorative meshes are added to the scene but not
 * returned (nothing to tear down beyond the scene, and they hold no body).
 */
export function addMedievalProps(
  world: GameWorld,
  arena: ArenaSpec,
): StaticHandle[] {
  const handles: StaticHandle[] = [];

  // ground(x,z): terrain surface y at a world XZ (variable-height per #206).
  const ground = (x: number, z: number): number =>
    getGroundHeightAt(arena, x, z);

  // Collidable box resting on the ground: center.y = ground + height/2.
  const prop = (x: number, z: number, size: Vec3, color: number): void => {
    handles.push(
      addStaticBox(world, { x, y: ground(x, z) + size.y / 2, z }, size, color),
    );
  };

  // Decorative-only box (no collider) — under ~0.3 m tall / walk-over trim.
  const decor = (x: number, z: number, size: Vec3, color: number): void => {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, ground(x, z) + size.y / 2, z);
    world.scene.add(mesh);
  };

  /* ── Market stall (redressed shopkeep) on the gatehouse approach ──
   * Built at the shopkeep stall's counter XZ so the vendor stands behind it.
   * createArenaV2 authors the counter AABB but no geometry — this is it. */
  {
    const stall = arena.shopkeepStall.npcAnchor;
    // Counter faces -Z (toward the castle gate), vendor stands at +Z of it.
    const cx = stall.x;
    const cz = stall.z - 1; // counter just in front of the NPC anchor
    prop(cx, cz, { x: 3, y: 1, z: 0.5 }, COLOR_WOOD); // counter
    prop(cx - 1.4, cz, { x: 0.2, y: 2.2, z: 0.2 }, COLOR_WOOD); // post L
    prop(cx + 1.4, cz, { x: 0.2, y: 2.2, z: 0.2 }, COLOR_WOOD); // post R
    // Awning roof — raised, so place at a fixed height above the ground.
    {
      const g = ground(cx, cz);
      const geo = new THREE.BoxGeometry(3.4, 0.2, 1.4);
      const mat = new THREE.MeshStandardMaterial({ color: COLOR_CLOTH });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, g + 2.3, cz + 0.3);
      world.scene.add(mesh);
    }
    prop(cx + 1.8, cz + 0.2, { x: 0.6, y: 0.9, z: 0.6 }, COLOR_WOOD_LIGHT); // barrel
  }

  /* ── Cart (grass, off the +X/+Z quadrant) ── */
  {
    const x = 30;
    const z = 14;
    prop(x, z, { x: 2.5, y: 0.6, z: 1.4 }, COLOR_WOOD); // bed
    prop(x - 1.4, z, { x: 0.3, y: 0.9, z: 0.3 }, COLOR_WOOD); // front stake
    // Wheels are <0.3 m of ground clearance visual trim → decorative only.
    decor(x - 0.9, z + 0.75, { x: 0.2, y: 0.1, z: 0.05 }, COLOR_FENCE);
    decor(x - 0.9, z - 0.75, { x: 0.2, y: 0.1, z: 0.05 }, COLOR_FENCE);
  }

  /* ── Hay bales (stacked cubes) ── */
  {
    const x = -27;
    const z = 16;
    prop(x, z, { x: 1, y: 1, z: 1 }, COLOR_HAY);
    prop(x + 1.1, z, { x: 1, y: 1, z: 1 }, COLOR_HAY);
    // Top bale — rest it on the lower two (ground + 1 m).
    {
      const g = ground(x + 0.55, z);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: COLOR_HAY });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + 0.55, g + 1.5, z);
      world.scene.add(mesh);
      // No collider on the raised bale — it sits on collidable bales below and
      // is out of reach as an obstacle; keeps the cluster cheap.
    }
  }

  /* ── Fence line (posts + rails) ── */
  {
    const z = -30;
    const x0 = 20;
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * 2;
      prop(x, z, { x: 0.15, y: 1.2, z: 0.15 }, COLOR_FENCE); // post (collidable)
      if (i < 3) {
        // Rail spans between posts, ~0.15 m thick → decorative (no collider).
        const g = ground(x + 1, z);
        const geo = new THREE.BoxGeometry(2, 0.15, 0.1);
        const mat = new THREE.MeshStandardMaterial({ color: COLOR_FENCE });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x + 1, g + 0.8, z);
        world.scene.add(mesh);
      }
    }
  }

  /* ── Ruined wall fragments (broken heights) ── */
  {
    const x = -34;
    const z = -14;
    prop(x, z, { x: 1.2, y: 2.2, z: 0.8 }, COLOR_STONE);
    prop(x + 1.4, z + 0.3, { x: 1.2, y: 1.3, z: 0.8 }, COLOR_STONE);
    prop(x + 2.7, z - 0.2, { x: 1.2, y: 0.7, z: 0.8 }, COLOR_STONE);
  }

  /* ── Barrels cluster ── */
  {
    const x = 34;
    const z = 6;
    prop(x, z, { x: 0.6, y: 0.9, z: 0.6 }, COLOR_WOOD_LIGHT);
    prop(x + 0.8, z + 0.2, { x: 0.6, y: 0.9, z: 0.6 }, COLOR_WOOD_LIGHT);
    prop(x + 0.4, z - 0.7, { x: 0.6, y: 0.9, z: 0.6 }, COLOR_WOOD_LIGHT);
  }

  return handles;
}
