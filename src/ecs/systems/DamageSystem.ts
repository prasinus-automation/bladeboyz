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
  BodyRegion,
} from '../components';
import { CombatState } from '../../combat/states';
import { AttackDirection, BlockDirection } from '../../combat/directions';
import { fsmRegistry } from '../../combat/CombatFSM';
import { weaponConfigMap } from './TracerSystem';
import { getCurrentFixedTick } from '../../core/tickCounter';
import type { WeaponConfig } from '../../weapons/WeaponConfig';
import { EventBus } from '../../events/EventBus';

/** HitReact stagger duration (~200ms at 60Hz) */
const HITREACT_DURATION_TICKS = 12;

/**
 * Per-victim attribution record — issue #130. Maps `victimEid` → most-recent
 * attacker info, tagged with the tick the damage was applied. `processDeaths`
 * reads this map to credit a kill; entries older than the attribution window
 * are treated as "no killer" (kill is environmental / suicide).
 *
 * Side-table because bitECS components can't hold the full quad of
 * (attacker, weaponId, bodyRegion, tick) without four parallel typed arrays.
 * Cleared by `clearDamageAttribution` during test reset.
 */
export interface DamageAttribution {
  attackerEid: number;
  weaponId: number;
  bodyRegion: BodyRegion;
  tick: number;
}

const attributionByVictim = new Map<number, DamageAttribution>();

/** Window after the last hit during which a kill is still credited. 5 s @ 60 Hz. */
export const ATTRIBUTION_WINDOW_TICKS = 300;

/**
 * Look up the killer for a given victim, if there's a recent enough
 * `DamageAttribution`. Returns null when no record exists or the record is
 * older than ATTRIBUTION_WINDOW_TICKS.
 */
export function getDamageAttribution(
  victimEid: number,
  currentTick: number,
): DamageAttribution | null {
  const rec = attributionByVictim.get(victimEid);
  if (!rec) return null;
  if (currentTick - rec.tick > ATTRIBUTION_WINDOW_TICKS) return null;
  return rec;
}

/** Test helper — drop all attribution records. */
export function clearDamageAttribution(): void {
  attributionByVictim.clear();
}

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
    const bodyRegion = DamageEvent.bodyRegion[eventEid] as BodyRegion;

    const targetState = CombatStateComponent.state[targetEid] as CombatState;
    const targetBlockDir = CombatStateComponent.blockDirection[targetEid] as BlockDirection;

    // FSM v2 (#135): Block + ParryWindow collapsed into a single `Blocking`
    // state. The parry-vs-block decision now reads `parryActive` from the
    // FSM instead of two separate ECS state values. Direct lookup keeps
    // DamageSystem's existing direct-write style (issue E migrates this
    // whole branch to dispatch FSM inputs).
    const targetFsm = fsmRegistry.get(targetEid);
    const targetIsBlocking = targetState === CombatState.Blocking;
    const targetIsParrying = targetFsm?.parryActive ?? false;

    if (
      targetIsBlocking &&
      targetIsParrying &&
      doesBlockCounter(attackDir, targetBlockDir)
    ) {
      handleParry(attackerEid);
    } else if (
      targetIsBlocking &&
      doesBlockCounter(attackDir, targetBlockDir)
    ) {
      handleBlock(targetEid, attackerEid);
    } else {
      // Unblocked hit (incl. mismatched block direction) — apply damage.
      handleHit(world, targetEid, attackerEid, damage, attackDir, bodyRegion);
    }

    // Mark processed and remove event entity
    DamageEvent.processed[eventEid] = 1;
    removeEntity(world.ecs, eventEid);
  }
}

/**
 * Successful parry — no damage, attacker enters longer HitStun penalty.
 *
 * FSM v2 (#135): `Stunned` was collapsed into `HitStun`. Issue E will
 * dispatch `WasParried` to the attacker's FSM here instead of writing
 * `CombatStateComponent.state` directly.
 */
function handleParry(attackerEid: number): void {
  const weaponId = CombatStateComponent.weaponId[attackerEid];
  const config = weaponConfigMap.get(weaponId);
  const stunTicks = config?.parryStunTicks ?? 40;

  CombatStateComponent.state[attackerEid] = CombatState.HitStun;
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
 * Unblocked hit — apply damage, push target into HitStun, populate HitReactComp,
 * record attribution, and emit a `DamageDealt` event on the EventBus.
 *
 * Attribution and event emission moved here in #130 so every successful hit
 * (whether or not it kills) feeds the kill-credit pipeline. `processDeaths`
 * reads the attribution map on the same tick the kill is detected.
 */
function handleHit(
  world: GameWorld,
  targetEid: number,
  attackerEid: number,
  damage: number,
  attackDir: AttackDirection,
  bodyRegion: BodyRegion,
): void {
  const tick = getCurrentFixedTick();
  const hpBefore = Health.current[targetEid];

  // Apply damage
  const hpAfter = Math.max(0, hpBefore - damage);
  Health.current[targetEid] = hpAfter;
  // Use the actual delta (capped at hpBefore) so the event reports what was
  // really subtracted, not the raw weapon damage when the victim was at 1 HP.
  const appliedAmount = hpBefore - hpAfter;

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

  // Record kill-attribution. processDeaths reads this same tick to credit
  // a kill. Overwrite any older record — only the most-recent attacker is
  // credited (Mordhau / Chivalry convention).
  attributionByVictim.set(targetEid, {
    attackerEid,
    weaponId,
    bodyRegion,
    tick,
  });

  // Emit DamageDealt — fires for every hit, lethal or not. Killfeed +
  // FloatingDamage HUD subscribe; DeathEvent is emitted separately by
  // processDeaths only on lethal hits.
  EventBus.emit('DamageDealt', {
    victimEid: targetEid,
    attackerEid,
    amount: appliedAmount,
    bodyRegion,
    weaponId,
    attackDirection: attackDir,
    isLethal: hpAfter <= 0 && Health.max[targetEid] > 0,
    tick,
  });
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
