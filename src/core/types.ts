import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { IWorld } from 'bitecs';
import type { ArenaSpec } from '../arena/types';

/* ────────────────────────────────────────────────────────────────────────────
 * Spatial conventions (issue #86 / #104)
 *
 * Feet-origin: All character ECS `Position` values represent the entity's
 * FEET — the point of contact with the ground. The character mesh's root
 * bone sits at y=0 in local space, so `meshGroup.position = ECS Position`
 * with NO offset.
 *
 * Capsule offset: Rapier capsule colliders are constructed with their
 * geometric center at the local origin. To make the bottom hemisphere of
 * the capsule sit at the body origin (= feet), the collider must be offset
 * upward via `ColliderDesc.capsule(...).setTranslation(0, R+H, 0)` where
 * R = CAPSULE_RADIUS and H = CAPSULE_HALF_HEIGHT. With this offset, body
 * translation = feet position. No +1.0 magic numbers in factories.
 *
 * Forward = -Z (Three.js convention). Yaw=0 looks down -Z.
 *
 * Ground top: arena ground is a fixed cuboid centered at y=0 with
 * half-height 0.1, so its top surface is at y = 0.1 = GROUND_TOP_Y.
 * ──────────────────────────────────────────────────────────────────────── */

/** Core game world containing all subsystem references */
export interface GameWorld {
  ecs: IWorld;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  rapier: typeof RAPIER;
  physicsWorld: RAPIER.World;
  camera: THREE.PerspectiveCamera;
  playerEntity: number;
  /**
   * Runtime arena spec (geometry bounds, spawn points, shopkeep stall, etc.).
   * Optional because tests may construct a `GameWorld` without an arena, but
   * production always populates this immediately after `createArena()` runs
   * in `main.ts`. Issue #112 / #91.
   */
  arena?: ArenaSpec;
}

/** Tick-rate constants */
export const FIXED_TIMESTEP = 1 / 60; // 60Hz
export const MAX_SUBSTEPS = 5;

/**
 * Movement speed constants (units/s).
 *
 * Tuned for arcade feel (2026-07 goal pass): quick base movement + a real
 * sprint gap so closing/opening distance is a decision, not a formality.
 * Swing WEIGHT comes from the combat turncaps, not from slow feet.
 */
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 7.5;
export const CROUCH_SPEED = 2.2;
export const SPRINT_MULTIPLIER = SPRINT_SPEED / WALK_SPEED;
export const CROUCH_MULTIPLIER = CROUCH_SPEED / WALK_SPEED;

/** Capsule collider dimensions (player + dummy) */
export const CAPSULE_HALF_HEIGHT = 0.7;
export const CAPSULE_RADIUS = 0.3;

/** Top surface of the arena ground cuboid (feet rest here on flat ground). */
export const GROUND_TOP_Y = 0.1;

/**
 * Legacy alias for `GROUND_TOP_Y`. The old `SPAWN_HEIGHT` was the capsule
 * **center** (0.1 + 0.7 + 0.3 = 1.1) and only worked because the capsule
 * collider had no offset. After issue #104 adopted feet-origin, the
 * collider is offset upward inside the body, so spawn height = feet Y =
 * GROUND_TOP_Y. Kept as an export only so a stray older import still
 * compiles for one cycle. New code should use `spawnAtGround()`.
 *
 * @deprecated Use `spawnAtGround(world, x, z)` or `GROUND_TOP_Y` directly.
 */
export const SPAWN_HEIGHT = GROUND_TOP_Y;

/**
 * Physics constants. GRAVITY is deliberately super-terrestrial (-22) with a
 * matching JUMP_VELOCITY (9): apex ≈ 1.84 m, airtime ≈ 0.82 s — a bouncy
 * arcade hop that still comes down fast enough to not feel floaty. Jump is
 * edge-triggered with no cooldown, so bunny-hopping around swings is a
 * legitimate (and encouraged) movement skill.
 */
export const GRAVITY = -22.0;
export const JUMP_VELOCITY = 9.0;
export const GROUND_CAST_DISTANCE = 0.15;
export const CHARACTER_CONTROLLER_OFFSET = 0.02;

/**
 * Jump forgiveness (#goal-2026-07 movement-feel pass). A jump pressed up
 * to JUMP_BUFFER_TICKS before landing fires on the landing tick instead of
 * being eaten mid-air; a jump pressed up to COYOTE_TICKS after walking off
 * an edge still fires. Both are standard platformer input-forgiveness —
 * without them bhop chains drop whenever a press lands a frame early/late,
 * which reads as "the game ignored my jump".
 */
export const JUMP_BUFFER_TICKS = 4; // ~67ms
export const COYOTE_TICKS = 3; // 50ms

/** Slope handling for the kinematic character controller */
export const MAX_SLOPE_CLIMB_ANGLE = (45 * Math.PI) / 180;
export const MIN_SLOPE_SLIDE_ANGLE = (30 * Math.PI) / 180;

/** Step / snap-to-ground tuning for the kinematic character controller */
export const AUTOSTEP_MAX_HEIGHT = 0.3;
export const AUTOSTEP_MIN_WIDTH = 0.2;
export const SNAP_TO_GROUND_DISTANCE = 0.3;

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

/**
 * Acceleration: time to reach full speed in seconds. Cut 0.075 → 0.04 in
 * the #goal-2026-07 movement-feel pass — 75ms (4.5 ticks) of ramp read as
 * input lag on direction changes; 40ms keeps a hint of weight without the
 * mush. Deceleration is 2× this rate (see MovementSystem).
 */
export const ACCELERATION_TIME = 0.04; // 40ms
