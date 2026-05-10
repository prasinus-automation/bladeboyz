/**
 * PickupRegistry — side-table for ground weapon pickups.
 *
 * `WeaponPickup` (in `src/ecs/components.ts`) only stores numeric data
 * (weaponId, spawnTick, despawnTick) because bitECS components are
 * TypedArray-backed. The Three.js `Group` + cached `Material[]` for
 * blink/fade live here, mirroring the side-table pattern used by
 * `meshRegistry`, `fsmRegistry`, `inventoryRegistry`, and `shopkeepRegistry`.
 *
 * Foundation only — drop/pickup/despawn behavior is #A2; ground-flat
 * orientation, spin, blink/fade rendering is #B (see issue #94).
 */
import type * as THREE from 'three';

/**
 * Per-pickup data not representable in bitECS components.
 *
 * - `weaponName`: canonical key into `weaponConfigs` / `weaponModelFactories`.
 * - `group`: the rendered mesh (added to `world.scene` by the factory) — kept
 *   here so cleanup can `scene.remove()` and dispose without re-walking.
 * - `materials`: unique Three.js material instances on the group, cached so
 *   #B's blink/fade pass in the last 5s of life doesn't re-traverse every frame.
 */
export interface PickupData {
  weaponName: string;
  group: THREE.Group;
  materials: THREE.Material[];
}

/** Map<entityId, PickupData> — module-level, single-world (matches existing registries). */
export const pickupRegistry: Map<number, PickupData> = new Map();

/**
 * Reset all pickup registry state. Test helper — game code should not call this.
 */
export function resetPickupRegistry(): void {
  pickupRegistry.clear();
}
