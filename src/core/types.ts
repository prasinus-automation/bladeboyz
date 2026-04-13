import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { IWorld } from 'bitecs';

/** Core game world containing all subsystem references */
export interface GameWorld {
  ecs: IWorld;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  rapier: typeof RAPIER;
  physicsWorld: RAPIER.World;
  camera: THREE.PerspectiveCamera;
  playerEntity: number;
}

/** Tick-rate constants */
export const FIXED_TIMESTEP = 1 / 60; // 60Hz
export const MAX_SUBSTEPS = 5;

/** Movement speed constants (units/s) */
export const WALK_SPEED = 4.0;
export const SPRINT_SPEED = 6.5;
export const CROUCH_SPEED = 2.0;
export const SPRINT_MULTIPLIER = SPRINT_SPEED / WALK_SPEED;
export const CROUCH_MULTIPLIER = CROUCH_SPEED / WALK_SPEED;

/** Physics constants */
export const GRAVITY = -20.0;
export const JUMP_VELOCITY = 8.0;
export const GROUND_CAST_DISTANCE = 0.15;
export const CHARACTER_CONTROLLER_OFFSET = 0.02;

/** Camera constants */
export const DEFAULT_FOV = 78;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 1000;
export const EYE_HEIGHT = 1.6;
export const CROUCH_EYE_HEIGHT = 1.0;
export const MOUSE_SENSITIVITY = 0.002;
export const MAX_PITCH = Math.PI / 2 - 0.01; // ~89 degrees
export const THIRD_PERSON_DISTANCE = 5.0;
export const THIRD_PERSON_MIN_DISTANCE = 2.0;
export const THIRD_PERSON_MAX_DISTANCE = 15.0;

/** Acceleration: time to reach full speed in seconds */
export const ACCELERATION_TIME = 0.075; // 75ms
