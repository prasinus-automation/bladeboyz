import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from 'bitecs';
import type { GameWorld } from './types';
import { DEFAULT_FOV, CAMERA_NEAR, CAMERA_FAR, GRAVITY } from './types';

/**
 * Initialize the game world: ECS, Three.js scene, Rapier physics, camera.
 */
export async function createGameWorld(canvas?: HTMLCanvasElement): Promise<GameWorld> {
  // Initialize Rapier WASM
  await RAPIER.init();

  // ECS world
  const ecs = createWorld();

  // Three.js
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // sky blue

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!canvas) {
    document.body.appendChild(renderer.domElement);
  }

  const camera = new THREE.PerspectiveCamera(
    DEFAULT_FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_NEAR,
    CAMERA_FAR,
  );

  // Rapier physics world
  const gravity = new RAPIER.Vector3(0, GRAVITY, 0);
  const physicsWorld = new RAPIER.World(gravity);

  // Ambient + directional light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Handle resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    ecs,
    scene,
    renderer,
    rapier: RAPIER,
    physicsWorld,
    camera,
    playerEntity: -1,
  };
}
