import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { IWorld } from 'bitecs';

/** Centralized game world holding all subsystem references */
export interface GameWorld {
  ecs: IWorld;
  scene: THREE.Scene;
  rapier: typeof RAPIER;
  physicsWorld: RAPIER.World;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
}
