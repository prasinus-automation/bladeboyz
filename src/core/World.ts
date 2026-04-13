import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from 'bitecs';
import type { GameWorld } from './types';

/**
 * Initialize and return the GameWorld singleton.
 * Must be called after Rapier WASM is initialized.
 */
export function createGameWorld(): GameWorld {
  const ecs = createWorld();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  // Ambient + directional light for flat-shaded look
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
  const physicsWorld = new RAPIER.World(gravity);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 2, 5);
  camera.lookAt(0, 1, 0);

  return { ecs, scene, rapier: RAPIER, physicsWorld, renderer, camera };
}
