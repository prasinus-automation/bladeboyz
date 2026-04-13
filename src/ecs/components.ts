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
 * Combat state component — tracks current FSM state and attack info.
 * bitECS only supports numeric values, so states/directions are enum ints.
 */
export const CombatStateComponent = defineComponent({
  /** Current CombatState enum value */
  state: Types.ui8,
  /** Current AttackDirection enum value */
  attackDirection: Types.ui8,
  /** Current BlockDirection enum value */
  blockDirection: Types.ui8,
  /** Ticks remaining in current state */
  ticksRemaining: Types.ui16,
  /** Weapon config index (maps to side-table) */
  weaponId: Types.ui8,
});

/** Health component */
export const Health = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

/** Stamina component */
export const Stamina = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

/**
 * Hitbox component — marks an entity as having hitbox sensor colliders.
 * The ownerEid links a hitbox collider entity back to its parent combatant.
 * bodyRegion stores the BodyRegion enum value.
 */
export const Hitbox = defineComponent({
  /** Entity ID of the combatant who owns this hitbox */
  ownerEid: Types.ui32,
  /** BodyRegion enum value */
  bodyRegion: Types.ui8,
  /** Rapier collider handle for lookup */
  colliderHandle: Types.ui32,
});

/**
 * TracerTag — marks an entity as participating in tracer-based hit detection.
 * Actual tracer state (previous positions, hit set) is stored in a side-map
 * because bitECS components can't hold arrays/objects.
 */
export const TracerTag = defineComponent();

/**
 * DamageEvent component — written by TracerSystem, consumed by DamageSystem.
 * Represents a pending damage event to be processed in the same tick.
 */
export const DamageEvent = defineComponent({
  /** Entity receiving damage */
  targetEid: Types.ui32,
  /** Entity dealing damage */
  attackerEid: Types.ui32,
  /** Raw damage amount */
  damage: Types.f32,
  /** BodyRegion hit */
  bodyRegion: Types.ui8,
  /** AttackDirection of the attack */
  attackDirection: Types.ui8,
  /** Whether this event has been processed (1 = processed) */
  processed: Types.ui8,
});
