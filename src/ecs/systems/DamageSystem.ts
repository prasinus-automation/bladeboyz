import { defineQuery, hasComponent, removeEntity } from 'bitecs';
import type { GameWorld } from '../../core/types';
import {
  DamageEvent,
  CombatStateComponent,
  HitReactComp,
  Health,
  Position,
  Rotation,
  Stamina,
} from '../components';
import { CombatState } from '../../combat/states';
import { AttackDirection, BlockDirection } from '../../combat/directions';
import { weaponConfigMap } from './TracerSystem';
import { getCurrentFixedTick } from '../../core/tickCounter';
import type { WeaponConfig } from '../../weapons/WeaponConfig';

/** HitReact stagger duration (~200ms at 60Hz) */
const HITREACT_DURATION_TICKS = 12;

// ─── Queries ─────────────────────────────────────────────────────────────────

const damageEventQuery = defineQuery([DamageEvent]);

// ─── Direction matching ──────────────────────────────────────────────────────

/**
 * Check if the target's block direction counters the attack direction.
 * Left attacks are blocked by Right blocks and vice versa.
 * Overhead is blocked by Top; Stab is blocked by any active block direction.
 *
 * FSM v2 (#88, #131): `Underhand` is gone — vertical-down swings now resolve
 * to `Stab`, so the old `Underhand → Bottom` mapping is unreachable. The
 * `Bottom` block direction is preserved (UI still shows the bottom wedge),
 * but it doesn't counter any attack on its own — it's a defensive choice.
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
      handleHit(world, targetEid, attackerEid, damage, attackDir);
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
 * Unblocked hit — apply damage, push target into HitStun, populate HitReactComp.
 */
function handleHit(
  world: GameWorld,
  targetEid: number,
  attackerEid: number,
  damage: number,
  attackDir: AttackDirection,
): void {
  // Apply damage
  Health.current[targetEid] = Math.max(0, Health.current[targetEid] - damage);

  // Push target into HitStun
  const weaponId = CombatStateComponent.weaponId[attackerEid];
  const config = weaponConfigMap.get(weaponId);
  const hitStunTicks = config?.hitStunTicks ?? 30;

  CombatStateComponent.state[targetEid] = CombatState.HitStun;
  CombatStateComponent.ticksRemaining[targetEid] = hitStunTicks;

  // Populate HitReactComp on the target so AnimationSystem can drive a
  // directional stagger lean. Skip if target doesn't have the component
  // (e.g. legacy entities or test fixtures).
  if (hasComponent(world.ecs, HitReactComp, targetEid)) {
    populateHitReact(targetEid, attackerEid, damage, attackDir, config);
  }
}

/**
 * Compute body-local hit direction (unit vector pointing FROM attacker
 * TO target) and write it onto the target's HitReactComp.
 *
 * `dirLocal` is in the target's local frame: x=right, y=up, z=forward(-Z).
 * Magnitude is `damage / weapon.maxDamage(direction)` clamped to [0, 1].
 */
function populateHitReact(
  targetEid: number,
  attackerEid: number,
  damage: number,
  attackDir: AttackDirection,
  config: WeaponConfig | undefined,
): void {
  // World-space delta from attacker → target.
  const dx = Position.x[targetEid] - Position.x[attackerEid];
  const dy = Position.y[targetEid] - Position.y[attackerEid];
  const dz = Position.z[targetEid] - Position.z[attackerEid];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Default: zero vector if attacker and target overlap exactly. Animation
  // systems should treat magnitude=0 as "no directional bias".
  let lx = 0;
  let ly = 0;
  let lz = 0;

  if (len > 1e-6) {
    // Unit world-space direction.
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;

    // Rotate into target's body-local space by -yaw (around Y axis).
    // Forward = -Z convention: yaw=0 looks down -Z.
    const yaw = Rotation.y[targetEid];
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    lx = ux * cos + uz * sin;
    ly = uy;
    lz = -ux * sin + uz * cos;
  }

  // Normalize magnitude: damage / max possible damage for this direction.
  // Use the head value as the per-direction max (head is the highest tier
  // in every WeaponConfig today). Clamp to [0, 1].
  let magnitude = 0;
  if (config) {
    const dirDamage = config.damage[attackDir];
    const maxDamage = Math.max(dirDamage.head, dirDamage.torso, dirDamage.limb);
    if (maxDamage > 0) {
      magnitude = Math.min(1, damage / maxDamage);
    }
  }

  HitReactComp.dirX[targetEid] = lx;
  HitReactComp.dirY[targetEid] = ly;
  HitReactComp.dirZ[targetEid] = lz;
  HitReactComp.magnitude[targetEid] = magnitude;
  HitReactComp.spawnedAtTick[targetEid] = getCurrentFixedTick();
  HitReactComp.durationTicks[targetEid] = HITREACT_DURATION_TICKS;
  HitReactComp.active[targetEid] = 1;
}
