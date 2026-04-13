import { defineComponent, Types } from 'bitecs';
import type * as THREE from 'three';

/* ─── bitECS components (numbers only) ─── */

/** World-space position */
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Previous tick position (for interpolation) */
export const PreviousPosition = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Euler rotation (radians) */
export const Rotation = defineComponent({
  x: Types.f32, // pitch
  y: Types.f32, // yaw
  z: Types.f32, // roll
});

/** Previous tick rotation (for interpolation) */
export const PreviousRotation = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Velocity vector */
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Tag: entity is the local player */
export const Player = defineComponent();

/** Alias for Player tag (used by character model subsystem) */
export const IsPlayer = Player;

/** Physics body reference (index into lookup table) */
export const PhysicsBody = defineComponent({
  bodyHandle: Types.ui32,
  colliderHandle: Types.ui32,
});

/** Movement state flags */
export const MovementState = defineComponent({
  /** 1 = grounded, 0 = airborne */
  grounded: Types.ui8,
  /** 1 = sprinting */
  sprinting: Types.ui8,
  /** 1 = crouching */
  crouching: Types.ui8,
  /** Current speed factor (0..1, for acceleration ramp) */
  speedFactor: Types.f32,
});

/**
 * CharacterModel — stores a numeric ID used to look up
 * the Three.js Group in the meshRegistry.
 */
export const CharacterModel = defineComponent({
  /** Key into meshRegistry */
  id: Types.ui32,
});

/**
 * Hitboxes — stores Rapier collider handles for each body region.
 * Handles are u32 indices into the Rapier world.
 * A value of 0xFFFFFFFF means "no collider".
 */
export const Hitboxes = defineComponent({
  head: Types.ui32,
  torso: Types.ui32,
  armLeft: Types.ui32,
  armRight: Types.ui32,
  legLeft: Types.ui32,
  legRight: Types.ui32,
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

/**
 * Combat state — mirrors the combat FSM's current state.
 * Written by the CombatSystem (fixedUpdate), read by the AnimationSystem (update).
 *
 * - state: CombatState enum value
 * - direction: AttackDirection or BlockDirection (context-dependent on state)
 * - phaseElapsed: ticks elapsed in current phase
 * - phaseTotal: total ticks for current phase (from weapon config)
 * - weaponId: index into weaponRegistry for timing lookups
 */
export const CombatStateComp = defineComponent({
  state: Types.ui8,
  direction: Types.ui8,
  phaseElapsed: Types.ui16,
  phaseTotal: Types.ui16,
  weaponId: Types.ui8,
});

/**
 * Animation state — tracks blending progress for the animation system.
 *
 * - upperBlend: 0..1 progress of upper body blend to target pose
 * - lowerBlend: 0..1 progress of lower body blend to target pose
 * - movementState: MovementState enum value (derived from velocity)
 * - walkCycle: accumulated walk cycle phase (radians, wraps at 2*PI)
 * - prevCombatState: previous combat state for transition detection
 * - prevDirection: previous direction for transition detection
 */
export const AnimationComp = defineComponent({
  upperBlend: Types.f32,
  lowerBlend: Types.f32,
  movementState: Types.ui8,
  walkCycle: Types.f32,
  prevCombatState: Types.ui8,
  prevDirection: Types.ui8,
});

/* ─── Lookup tables for non-numeric data ─── */

export interface CharacterModelData {
  group: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Record<string, THREE.Bone>;
}

/** Map<entityId, Three.js group + skeleton data> */
export const meshRegistry = new Map<number, CharacterModelData>();

/** Map<entityId, per-region Rapier collider refs> */
export const hitboxColliderRegistry = new Map<
  number,
  Map<BodyRegion, import('@dimforge/rapier3d-compat').Collider>
>();

/* ─── Body region enum ─── */

export const enum BodyRegion {
  Head = 0,
  Torso = 1,
  ArmLeft = 2,
  ArmRight = 3,
  LegLeft = 4,
  LegRight = 5,
}
