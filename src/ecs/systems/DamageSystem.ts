import { defineQuery, removeEntity } from 'bitecs';
import type { GameWorld } from '../../core/types';
import {
  DamageEvent,
  CombatStateComponent,
  Health,
  Stamina,
} from '../components';
import { CombatState } from '../../combat/states';
import { AttackDirection, BlockDirection } from '../../combat/directions';
import { weaponConfigMap } from './TracerSystem';

// ─── Queries ─────────────────────────────────────────────────────────────────

const damageEventQuery = defineQuery([DamageEvent]);

// ─── Direction matching ──────────────────────────────────────────────────────

/**
 * Check if the target's block direction counters the attack direction.
 * Left attacks are blocked by Right blocks and vice versa.
 * Overhead is blocked by Top, Underhand by Bottom, Stab by any.
 */
function doesBlockCounter(
  attackDir: AttackDirection,
  blockDir: BlockDirection,
): boolean {
  switch (attackDir) {
    case AttackDirection.Left:
      return blockDir === BlockDirection.Right;
    case AttackDirection.Right:
      return blockDir === BlockDirection.Left;
    case AttackDirection.Overhead:
      return blockDir === BlockDirection.Top;
    case AttackDirection.Underhand:
      return blockDir === BlockDirection.Bottom;
    case AttackDirection.Stab:
      // Stab can be blocked by any active block direction
      return true;
    default:
      return false;
  }
}

// ─── System ──────────────────────────────────────────────────────────────────

/**
 * DamageSystem — runs in fixedUpdate, immediately after TracerSystem.
 *
 * Processes all pending DamageEvent entities:
 * - Checks if target is blocking the correct direction → block/parry
 * - Otherwise applies damage and pushes target into HitStun
 * - Removes processed DamageEvent entities
 */
export function DamageSystem(world: GameWorld, _dt: number): void {
  const events = damageEventQuery(world.ecs);

  for (let i = 0; i < events.length; i++) {
    const eventEid = events[i];

    // Skip already-processed events (defensive)
    if (DamageEvent.processed[eventEid] === 1) {
      removeEntity(world.ecs, eventEid);
      continue;
    }

    const targetEid = DamageEvent.targetEid[eventEid];
    const attackerEid = DamageEvent.attackerEid[eventEid];
    const damage = DamageEvent.damage[eventEid];
    const attackDir = DamageEvent.attackDirection[eventEid] as AttackDirection;

    const targetState = CombatStateComponent.state[targetEid] as CombatState;
    const targetBlockDir = CombatStateComponent.blockDirection[targetEid] as BlockDirection;

    // Check for parry (ParryWindow + correct direction)
    if (
      targetState === CombatState.ParryWindow &&
      doesBlockCounter(attackDir, targetBlockDir)
    ) {
      handleParry(attackerEid);
    }
    // Check for block (Block state + correct direction)
    else if (
      targetState === CombatState.Block &&
      doesBlockCounter(attackDir, targetBlockDir)
    ) {
      handleBlock(targetEid, attackerEid);
    }
    // Unblocked hit — apply damage
    else {
      handleHit(targetEid, attackerEid, damage);
    }

    // Mark processed and remove event entity
    DamageEvent.processed[eventEid] = 1;
    removeEntity(world.ecs, eventEid);
  }
}

/**
 * Successful parry — no damage, attacker enters longer Stunned recovery.
 */
function handleParry(attackerEid: number): void {
  const weaponId = CombatStateComponent.weaponId[attackerEid];
  const config = weaponConfigMap.get(weaponId);
  const stunTicks = config?.parryStunTicks ?? 40;

  // Attacker → Stunned with parry penalty
  CombatStateComponent.state[attackerEid] = CombatState.Stunned;
  CombatStateComponent.ticksRemaining[attackerEid] = stunTicks;
}

/**
 * Successful block — no damage, drain target stamina, attacker → Recovery.
 */
function handleBlock(targetEid: number, attackerEid: number): void {
  const weaponId = CombatStateComponent.weaponId[attackerEid];
  const config = weaponConfigMap.get(weaponId);
  const staminaDrain = config?.blockStaminaDrain ?? 25;

  // Drain blocker's stamina
  Stamina.current[targetEid] = Math.max(
    0,
    Stamina.current[targetEid] - staminaDrain,
  );

  // Attacker bounces into Recovery
  CombatStateComponent.state[attackerEid] = CombatState.Recovery;
  const attackDir = CombatStateComponent.attackDirection[attackerEid] as AttackDirection;
  const recoveryTicks = config?.recovery[attackDir] ?? 25;
  CombatStateComponent.ticksRemaining[attackerEid] = recoveryTicks;
}

/**
 * Unblocked hit — apply damage, push target into HitStun.
 */
function handleHit(targetEid: number, attackerEid: number, damage: number): void {
  // Apply damage
  Health.current[targetEid] = Math.max(0, Health.current[targetEid] - damage);

  // Push target into HitStun
  const weaponId = CombatStateComponent.weaponId[attackerEid];
  const config = weaponConfigMap.get(weaponId);
  const hitStunTicks = config?.hitStunTicks ?? 30;

  CombatStateComponent.state[targetEid] = CombatState.HitStun;
  CombatStateComponent.ticksRemaining[targetEid] = hitStunTicks;
}
