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
