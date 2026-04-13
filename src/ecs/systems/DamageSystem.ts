import { defineQuery, removeEntity } from 'bitecs';
import type { World } from '../../core/World';
import {
  DamageEvent,
  CombatStateComponent,
  Health,
  Stamina,
} from '../components';
import { CombatState, BlockDirection, AttackDirection } from '../../combat/states';
import { weaponConfigMap } from './TracerSystem';

// ─── Queries ─────────────────────────────────────────────────────────────────

const damageEventQuery = defineQuery([DamageEvent]);

// ─── Direction matching ──────────────────────────────────────────────────────

/**
 * Check if the target's block direction counters the attack direction.
 * Left attacks are blocked by Right blocks and vice versa.
 * Overhead is blocked by Up, Underhand by Down, Stab by any.
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
      return blockDir === BlockDirection.Up;
    case AttackDirection.Underhand:
      return blockDir === BlockDirection.Down;
    case AttackDirection.Stab:
      // Stab can be blocked by any active block direction
      return blockDir !== BlockDirection.None;
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
export function DamageSystem(world: World, _dt: number): void {
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
      handleParry(world, targetEid, attackerEid);
    }
    // Check for block (Block state + correct direction)
    else if (
      targetState === CombatState.Block &&
      doesBlockCounter(attackDir, targetBlockDir)
    ) {
      handleBlock(world, targetEid, attackerEid);
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
function handleParry(_world: World, _targetEid: number, attackerEid: number): void {
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
function handleBlock(_world: World, targetEid: number, attackerEid: number): void {
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
  const attackDir = CombatStateComponent.attackDirection[attackerEid];
  const timing = config?.timing[attackDir as keyof typeof config.timing];
  CombatStateComponent.ticksRemaining[attackerEid] = timing?.recoveryTicks ?? 25;
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
