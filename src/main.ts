import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { World } from './core/World';
import { GameLoop } from './core/GameLoop';
import { PhysicsSystem } from './ecs/systems/PhysicsSystem';
import { TracerSystem } from './ecs/systems/TracerSystem';
import { DamageSystem } from './ecs/systems/DamageSystem';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';

/** Create the test arena scene: ground plane, scattered boxes, lights */
function createTestArena(world: World): void {
  const { scene, rapierWorld } = world;

  // --- Ground plane (50x50) with checkerboard material ---
  const groundSize = 50;
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize, 50, 50);
  // Create a simple checkerboard via vertex colors
  const colors: number[] = [];
  const posAttr = groundGeo.getAttribute('position');
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getY(i); // PlaneGeometry lies in XY before rotation
    const checker = (Math.floor(x + groundSize / 2) + Math.floor(z + groundSize / 2)) % 2;
    if (checker === 0) {
      colors.push(0.35, 0.35, 0.38);
    } else {
      colors.push(0.25, 0.25, 0.28);
    }
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  scene.add(ground);

  // Ground collider (static)
  const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const groundBody = rapierWorld.createRigidBody(groundBodyDesc);
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(groundSize / 2, 0.1, groundSize / 2);
  rapierWorld.createCollider(groundColliderDesc, groundBody);

  // --- Scattered box primitives (5-8 boxes) ---
  const boxConfigs = [
    { pos: [5, 0.5, -3], size: [1, 1, 1] },
    { pos: [-8, 1, 6], size: [2, 2, 2] },
    { pos: [12, 0.75, 10], size: [1.5, 1.5, 1.5] },
    { pos: [-4, 1.5, -12], size: [1, 3, 1] },
    { pos: [0, 0.5, -8], size: [3, 1, 1] },
    { pos: [-15, 1, -5], size: [2, 2, 1] },
    { pos: [8, 0.5, 15], size: [1, 1, 2] },
  ];

  const boxColors = [0x8b4513, 0x556b2f, 0x4a4a5a, 0x6b3a3a, 0x3a5a3a, 0x5a4a3a, 0x3a4a6b];

  for (let i = 0; i < boxConfigs.length; i++) {
    const cfg = boxConfigs[i];
    const [sx, sy, sz] = cfg.size;
    const [px, py, pz] = cfg.pos;

    // Three.js mesh
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({ color: boxColors[i] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py + sy / 2, pz);
    scene.add(mesh);

    // Rapier static collider
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(px, py + sy / 2, pz);
    const body = rapierWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2);
    rapierWorld.createCollider(colliderDesc, body);
  }

  // --- Lighting ---
  // Directional light (no shadows per spec)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Ambient light for fill
  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container');

  // Initialize the World singleton (handles Rapier WASM init)
  const world = World.getInstance();
  await world.init(container);

  // Build the test arena
  createTestArena(world);

  // Initialize debug renderers
  const tracerDebugRenderer = new TracerDebugRenderer(world.scene);

  // Create and start the game loop
  const gameLoop = new GameLoop({
    fixedUpdate(dt: number) {
      PhysicsSystem(world, dt);
      TracerSystem(world, dt);
      DamageSystem(world, dt);
    },
    update(_dt: number) {
      // Variable-rate work (animation blending, etc.) — nothing yet
    },
    render(_alpha: number) {
      tracerDebugRenderer.update();
      world.renderer.render(world.scene, world.camera);
    },
  });

  gameLoop.start();

  // HMR cleanup for Vite
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      gameLoop.stop();
      tracerDebugRenderer.dispose();
      world.dispose();
    });
  }
}

main().catch((err) => {
  console.error('Failed to initialize BladeBoyz:', err);
});
