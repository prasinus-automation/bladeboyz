import * as THREE from 'three';
import { defineQuery, hasComponent } from 'bitecs';
import type { GameWorld } from '../../core/types';
import {
  DamageEvent,
  meshRegistry,
  BodyRegion,
  IsNPC,
  IsTrainingDummy,
} from '../components';
import { recordNpcHit } from '../entities/createTrainingDummy';
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
 * NpcDamageObserver — runs BEFORE DamageSystem to peek at incoming damage
 * events and spawn floating damage numbers + record hit times for NPCs.
 *
 * Floating numbers fire for **any entity tagged `IsNPC`** (training dummies,
 * future warmup bots, future shopkeeps). Auto-regen book-keeping
 * (`recordNpcHit`) is also recorded for any NPC, but
 * `tickTrainingDummyHealthReset` only acts on entities tagged
 * `IsTrainingDummy` — recording a hit on a bot is harmless because the
 * regen path is tag-gated.
 *
 * Does NOT consume or modify events — it's read-only. DamageSystem still
 * does the actual HP mutation.
 *
 * Renamed from `DummyDamageObserver` per `docs/training-dummies-and-bots-spec.md` §6.
 */
export function createNpcDamageObserver(
  world: GameWorld,
  floatingDamage: FloatingDamage,
): (dt: number) => void {
  const _worldPos = new THREE.Vector3();

  return function NpcDamageObserver(_dt: number): void {
    const events = damageEventQuery(world.ecs);

    for (let i = 0; i < events.length; i++) {
      const eventEid = events[i];
      if (DamageEvent.processed[eventEid] === 1) continue;

      const targetEid = DamageEvent.targetEid[eventEid];

      // Only handle NPC targets. Hits on the player flow through HealthBar /
      // DeathScreen, not floating damage numbers.
      if (!hasComponent(world.ecs, IsNPC, targetEid)) continue;

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
      // Auto-regen tick book-keeping. Records for every NPC; the regen
      // pass in `tickTrainingDummyHealthReset` is gated by the
      // `IsTrainingDummy` query so non-regen NPCs (bots) are unaffected.
      if (hasComponent(world.ecs, IsTrainingDummy, targetEid)) {
        recordNpcHit(targetEid);
      }
    }
  };
}
