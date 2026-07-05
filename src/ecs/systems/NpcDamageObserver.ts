import * as THREE from 'three';
import { hasComponent } from 'bitecs';
import type { GameWorld } from '../../core/types';
import { meshRegistry, BodyRegion, IsNPC, IsTrainingDummy } from '../components';
import { recordNpcHit } from '../entities/createTrainingDummy';
import { EventBus } from '../../events/EventBus';
import type { FloatingDamage } from '../../hud/FloatingDamage';

const BODY_REGION_NAMES: Record<number, string> = {
  [BodyRegion.Head]: 'HEAD',
  [BodyRegion.Torso]: 'TORSO',
  [BodyRegion.ArmLeft]: 'ARM',
  [BodyRegion.ArmRight]: 'ARM',
  [BodyRegion.LegLeft]: 'LEG',
  [BodyRegion.LegRight]: 'LEG',
};

/**
 * NpcDamageObserver — spawns floating damage numbers + records auto-regen
 * hit times for NPCs.
 *
 * HISTORY / WHY EVENTBUS: the original implementation polled `DamageEvent`
 * ECS entities from the fixed-update loop. That NEVER worked in production:
 * main.ts runs this observer BEFORE `TracerSystem` (which creates the
 * events), and `DamageSystem` removes them in the same tick — so by the
 * time the observer ran on the next tick, every event was gone. The
 * fallout was the "damage doesn't work" bug: `recordNpcHit` never fired,
 * `tickTrainingDummyHealthReset` believed the dummy had been unhit for 3 s
 * on every single tick, and instantly healed all damage back. Floating
 * damage numbers never appeared either.
 *
 * Subscribing to the `DamageDealt` EventBus payload (emitted by
 * `DamageSystem.handleHit`, flushed at end of tick) is ordering-immune:
 * the handler fires the same tick the damage lands, regardless of where
 * any system sits in the fixedUpdate sequence.
 *
 * Floating numbers fire for **any entity tagged `IsNPC`**; auto-regen
 * book-keeping (`recordNpcHit`) only for `IsTrainingDummy`.
 *
 * Returns a per-tick function for call-site compatibility — it's a no-op
 * (all work happens in the subscription), kept so main.ts's fixedUpdate
 * sequence doesn't need to change shape.
 */
export function createNpcDamageObserver(
  world: GameWorld,
  floatingDamage: FloatingDamage,
): (dt: number) => void {
  const _worldPos = new THREE.Vector3();

  EventBus.on('DamageDealt', (payload) => {
    const targetEid = payload.victimEid;

    // Only handle NPC targets. Hits on the player flow through HealthBar /
    // DeathScreen, not floating damage numbers.
    if (!hasComponent(world.ecs, IsNPC, targetEid)) return;

    const regionName = BODY_REGION_NAMES[payload.bodyRegion] ?? 'BODY';

    // Get world position of the hit target
    const modelData = meshRegistry.get(targetEid);
    if (modelData) {
      _worldPos.setFromMatrixPosition(modelData.group.matrixWorld);
      // Offset upward to head area for visibility
      _worldPos.y += 1.8;
    } else {
      _worldPos.set(0, 2, 0);
    }

    floatingDamage.spawn(payload.amount, regionName, _worldPos);
    // Auto-regen tick book-keeping. The regen pass in
    // `tickTrainingDummyHealthReset` is gated by the `IsTrainingDummy`
    // query so non-regen NPCs (bots) are unaffected.
    if (hasComponent(world.ecs, IsTrainingDummy, targetEid)) {
      recordNpcHit(targetEid);
    }
  });

  return function NpcDamageObserver(_dt: number): void {
    // Intentionally empty — see docstring. Work happens in the
    // EventBus subscription above.
  };
}
