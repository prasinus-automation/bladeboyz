/**
 * HitReactSystem — clears expired HitReactComp entries.
 *
 * `DamageSystem.handleHit` populates `HitReactComp` on the target with
 * `spawnedAtTick` and `durationTicks`. Each fixed tick this system flips
 * `active` from 1 → 0 once `currentTick >= spawnedAtTick + durationTicks`,
 * so AnimationSystem can read `active` to decide whether to apply the
 * directional stagger lean.
 *
 * Tiny on purpose: a single ECS query and a comparison per active entry.
 */

import { defineQuery, type IWorld } from 'bitecs';
import { HitReactComp } from '../components';
import { getCurrentFixedTick } from '../../core/tickCounter';

const hitReactQuery = defineQuery([HitReactComp]);

/**
 * Tick the hit-react system once. Call from fixedUpdate after CombatSystem
 * (and after DamageSystem in the same tick — DamageSystem may have just
 * stamped a fresh entry, which we should NOT immediately clear).
 */
export function hitReactSystemTick(ecsWorld: IWorld): void {
  const tick = getCurrentFixedTick();
  const entities = hitReactQuery(ecsWorld);

  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    if (HitReactComp.active[eid] === 0) continue;

    const expiresAt =
      HitReactComp.spawnedAtTick[eid] + HitReactComp.durationTicks[eid];

    if (tick >= expiresAt) {
      HitReactComp.active[eid] = 0;
    }
  }
}
