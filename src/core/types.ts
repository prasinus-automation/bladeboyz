import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';
import type { IWorld } from 'bitecs';

/** Callbacks the game loop invokes each frame */
export interface GameLoopCallbacks {
  /** Called at fixed 60Hz for physics/game logic. dt is always TICK_DURATION (in seconds). */
  fixedUpdate(dt: number): void;
  /** Called once per frame with variable delta time (in seconds). */
  update(dt: number): void;
  /** Called once per frame with interpolation alpha for smooth rendering. */
  render(alpha: number): void;
}

/** The core game world state accessible by all systems */
export interface WorldState {
  ecs: IWorld;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  rapierWorld: RAPIER.World;
  assetRegistry: Map<string, unknown>;
}
