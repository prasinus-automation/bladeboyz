import { addEntity, addComponent, removeEntity } from 'bitecs';
import * as THREE from 'three';
import { Position, WeaponPickup } from '../components';
import { weaponIdToName } from '../systems/CombatSystem';
import { weaponModelFactories } from '../../rendering/WeaponModels';
import { pickupRegistry, type PickupData } from '../../inventory/PickupRegistry';
import type { GameWorld } from '../../core/types';

/**
 * Arguments for `createWeaponPickup`.
 */
export interface CreateWeaponPickupArgs {
  /** Canonical weapon name — must be a key in `weaponModelFactories`. */
  weaponName: string;
  /** World-space spawn position (top-of-ground). */
  position: { x: number; y: number; z: number };
  /** Tick the pickup was spawned. */
  spawnTick: number;
  /** Tick the pickup will be auto-despawned (consumed by #A2). */
  despawnTick: number;
}

/**
 * Build the ground-pickup mesh for a weapon.
 *
 * **Stub for #B.** Sub-issue #B will implement this in `WeaponModels.ts`
 * with proper ground-flat orientation, weapon-specific tilt, and spin
 * animation hooks. For #109 (foundation), we just call the existing
 * `weaponModelFactories[weaponName]` and lay the group flat so a pickup
 * is visible at the requested position.
 *
 * Materials are collected here (not in `createWeaponPickup`) so #B can
 * cache shader uniforms / clones for blink-fade without leaking factory
 * details upstream.
 */
function createGroundPickupModel(weaponName: string): {
  group: THREE.Group;
  materials: THREE.Material[];
} {
  const factory = weaponModelFactories[weaponName];
  if (!factory) {
    throw new Error(
      `createGroundPickupModel: unknown weapon "${weaponName}" — not in weaponModelFactories`,
    );
  }
  const { group } = factory();
  // Lay flat. #B will replace with weapon-specific orientation tuning.
  group.rotation.x = -Math.PI / 2;

  const materials: THREE.Material[] = [];
  group.traverse((obj) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = (obj as any).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && !materials.includes(m)) materials.push(m);
      }
    } else if (!materials.includes(mat)) {
      materials.push(mat);
    }
  });

  return { group, materials };
}

/**
 * Spawn a ground weapon pickup entity.
 *
 * Foundation only — this just stands up the entity, components, mesh, and
 * registry entry. Drop-on-death, proximity pickup, KeyE wiring, and
 * despawn-timer behavior all live in #A2. Visual tuning (flat orientation
 * polish, spin, blink/fade) lives in #B.
 *
 * @returns the new entity id
 */
export function createWeaponPickup(
  world: GameWorld,
  args: CreateWeaponPickupArgs,
): number {
  const { weaponName, position, spawnTick, despawnTick } = args;

  const eid = addEntity(world.ecs);

  addComponent(world.ecs, Position, eid);
  addComponent(world.ecs, WeaponPickup, eid);

  Position.x[eid] = position.x;
  Position.y[eid] = position.y;
  Position.z[eid] = position.z;

  // Resolve numeric weapon id from CombatSystem's id↔name table.
  // -1 → 0 fallback so the typed-array write doesn't blow up; consumers
  // should always go through `pickupRegistry.weaponName` for the source of truth.
  const weaponIdx = weaponIdToName.indexOf(weaponName);
  WeaponPickup.weaponId[eid] = weaponIdx >= 0 ? weaponIdx : 0;
  WeaponPickup.spawnTick[eid] = spawnTick;
  WeaponPickup.despawnTick[eid] = despawnTick;

  const { group, materials } = createGroundPickupModel(weaponName);
  group.position.set(position.x, position.y, position.z);
  world.scene.add(group);

  const data: PickupData = { weaponName, group, materials };
  pickupRegistry.set(eid, data);

  return eid;
}

/**
 * Remove a weapon pickup entity and clean up its scene mesh, geometries,
 * materials, and registry entry. Mirrors `removeDummy` / `removeShopkeep`.
 *
 * Safe to call with an unknown eid — no-op if not in `pickupRegistry`.
 */
export function removeWeaponPickup(world: GameWorld, eid: number): void {
  const data = pickupRegistry.get(eid);
  if (data) {
    world.scene.remove(data.group);
    data.group.traverse((obj) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = obj as any;
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mat = o.material;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
        else mat.dispose();
      }
    });
    pickupRegistry.delete(eid);
  }
  removeEntity(world.ecs, eid);
}
