import { defineComponent, Types } from 'bitecs';

/** 3D position */
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

/** Rotation (euler angles in radians) */
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

/** Velocity */
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
});

/** Player tag — marks entity as the local player */
export const Player = defineComponent();

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

/** Health */
export const Health = defineComponent({
  current: Types.f32,
  max: Types.f32,
});
