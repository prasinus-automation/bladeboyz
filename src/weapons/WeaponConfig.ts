import type * as THREE from 'three';

/** Data-driven weapon configuration. All timing in ticks (1 tick = 1/60s). */
export interface WeaponConfig {
  name: string;
  /** Damage per hit by region */
  damage: {
    head: number;
    torso: number;
    arms: number;
    legs: number;
  };
  /** Phase durations in ticks */
  windup: number;
  release: number;
  recovery: number;
  /** Stamina cost per swing */
  staminaCost: number;
  /** Tracer points in weapon local space (base → tip) */
  tracerPoints: THREE.Vector3[];
  /** Weapon reach (units) */
  reach: number;
}
