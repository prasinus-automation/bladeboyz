import RAPIER from '@dimforge/rapier3d-compat';
import { createGameWorld } from './core/World';
import { startGameLoop } from './core/GameLoop';
import { createPlayer } from './ecs/entities/createPlayer';
import { createDummy } from './ecs/entities/createDummy';
import { hitboxSystem } from './ecs/systems/HitboxSystem';
import { DebugRenderer } from './rendering/DebugRenderer';

async function main(): Promise<void> {
  // Rapier WASM must be initialized before anything else
  await RAPIER.init();

  const world = createGameWorld();

  const appEl = document.getElementById('app')!;
  appEl.appendChild(world.renderer.domElement);

  // Handle window resize
  window.addEventListener('resize', () => {
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
    world.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Create entities
  createPlayer(world, 0x4488cc);
  createDummy(world, 0, 0, -3, 0xcc4444);

  // Debug renderer (F3 for hitbox wireframes)
  const debugRenderer = new DebugRenderer(world);

  // Add a ground plane for reference
  {
    const THREE = await import('three');
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x556b2f }),
    );
    ground.rotation.x = -Math.PI / 2;
    world.scene.add(ground);
  }

  // Start game loop
  startGameLoop({
    fixedUpdate(_dt: number) {
      world.physicsWorld.step();
      hitboxSystem(world);
    },
    update(_dt: number) {
      // Variable-rate updates (animation blending, etc.) go here
    },
    render(_alpha: number) {
      debugRenderer.update();
      world.renderer.render(world.scene, world.camera);
    },
  });
}

main().catch(console.error);
