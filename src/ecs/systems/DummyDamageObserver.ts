import * as THREE from 'three';
import { defineQuery } from 'bitecs';
import type { GameWorld } from '../../core/types';
import { DamageEvent, meshRegistry, BodyRegion } from '../components';
import { activeDummies, recordDummyHit } from '../entities/createDummy';
import type { FloatingDamage } from '../../hud/FloatingDamage';

const BODY_REGION_NAMES: Record<number, string> = {
  [BodyRegion.Head]: 'HEAD',
  [BodyRegion.Torso]: 'TORSO',
  [BodyRegion.ArmLeft]: 'ARM',
  [BodyRegion.ArmRight]: 'ARM',
  [BodyRegion.LegLeft]: 'LEG',
  [BodyRegion.LegRight]: 'LEG',
};

const damageEventQuery = defineQuery([DamageEvent]);

/**
 * DummyDamageObserver — runs BEFORE DamageSystem to peek at incoming damage
 * events and spawn floating damage numbers + record hit times for dummies.
 *
 * Does NOT consume or modify events — it's read-only.
 */
export function createDummyDamageObserver(
  world: GameWorld,
  floatingDamage: FloatingDamage,
): (dt: number) => void {
  const _worldPos = new THREE.Vector3();

  return function DummyDamageObserver(_dt: number): void {
    const events = damageEventQuery(world.ecs);

    for (let i = 0; i < events.length; i++) {
      const eventEid = events[i];
      if (DamageEvent.processed[eventEid] === 1) continue;

      const targetEid = DamageEvent.targetEid[eventEid];

      // Only handle dummy targets
      if (!activeDummies.includes(targetEid)) continue;

      const damage = DamageEvent.damage[eventEid];
      const region = DamageEvent.bodyRegion[eventEid] as BodyRegion;
      const regionName = BODY_REGION_NAMES[region] ?? 'BODY';

      // Get world position of the hit target
      const modelData = meshRegistry.get(targetEid);
      if (modelData) {
        _worldPos.setFromMatrixPosition(modelData.group.matrixWorld);
        // Offset upward to head area for visibility
        _worldPos.y += 1.8;
      } else {
        _worldPos.set(0, 2, 0);
      }

      floatingDamage.spawn(damage, regionName, _worldPos);
      recordDummyHit(targetEid);
    }
  };
}
