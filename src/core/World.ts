import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, addEntity } from 'bitecs';
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

  // Reserve entity 0 as the NULL entity (never used for anything real).
  // The event schema documents `eid 0` as the "no entity" sentinel —
  // `DeathEvent.killerEid === 0` means environmental death, `BotBrain
  // .targetEid === 0` would mean no target, `getDisplayName(0)` renders
  // "the void". Without this reservation the FIRST real entity (the local
  // player, in practice) got id 0 and every one of those checks
  // misclassified it — most visibly: player kills paid no gold because
  // `awardGoldOnKill` mapped killerEid 0 to "environmental". Standard ECS
  // null-entity convention; do not remove or reuse this entity.
  addEntity(ecs);

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

  // Lights are owned by `createArena()` (Arena v1, #117) — they're map data,
  // not engine data. Background stays here because it's a fallback / engine
  // default; the arena light rig assumes `scene.background = 0x87ceeb`.

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
