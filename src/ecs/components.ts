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
