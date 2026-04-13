import { defineComponent, Types } from 'bitecs';

/** 3D position in world space */
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Rotation as Euler angles (radians) */
export const Rotation = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Linear velocity */
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/**
 * Combat state component for bitECS.
 *
 * bitECS only supports numeric values, so:
 * - `state` is a CombatStateEnum value
 * - `ticksRemaining` is the timer for the current state
 * - `attackDirection` is an AttackDirection enum value
 * - `weaponId` references a WeaponConfig in the weaponRegistry
 * - `turncap` is the current turncap in rad/tick (written each tick by CombatSystem)
 *
 * The actual CombatFSM instances are stored in a Map<entityId, CombatFSM>
 * since bitECS can't store object references.
 */
export const CombatState = defineComponent({
  /** Current CombatStateEnum value */
  state: Types.ui8,
  /** Ticks remaining in current timed state */
  ticksRemaining: Types.ui16,
  /** Current AttackDirection */
  attackDirection: Types.ui8,
  /** Weapon config ID (references weaponRegistry) */
  weaponId: Types.ui16,
  /** Current turncap in rad/tick (written by CombatSystem each tick) */
  turncap: Types.f32,
});
