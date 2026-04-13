import { createGameWorld } from './core/World';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './input/InputManager';
import { CameraController } from './rendering/CameraController';
import { createMovementSystem } from './ecs/systems/MovementSystem';
import { createPlayer } from './ecs/entities/createPlayer';
import { createArena } from './ecs/entities/createArena';
import { DebugOverlay } from './hud/DebugOverlay';
import { TracerSystem } from './ecs/systems/TracerSystem';
import { DamageSystem } from './ecs/systems/DamageSystem';
import { TracerDebugRenderer } from './rendering/TracerDebugRenderer';
import { FIXED_TIMESTEP } from './core/types';
import { Position } from './ecs/components';

async function main(): Promise<void> {
  // Initialize game world
  const world = await createGameWorld();
  document.body.prepend(world.renderer.domElement);

  // Input manager
  const input = new InputManager(world.renderer.domElement);

  // Camera controller
  const cameraController = new CameraController(world.camera, input);

  // Create arena
  createArena(world);

  // Create player
  const { eid: playerEid, mesh: playerMesh } = createPlayer(world, { x: 0, y: 0.1, z: 0 });
  world.playerEntity = playerEid;
  cameraController.setPlayerMesh(playerMesh);

  // Create movement system
  const movementSystem = createMovementSystem(world, input, cameraController);

  // Debug overlay
  const debugOverlay = new DebugOverlay();

  // Initialize debug renderers
  const tracerDebugRenderer = new TracerDebugRenderer(world.scene);

  // Click-to-play handler
  const overlay = document.getElementById('click-to-play');
  if (overlay) {
    overlay.addEventListener('click', () => {
      input.requestPointerLock();
    });
    // Also re-lock on canvas click
    world.renderer.domElement.addEventListener('click', () => {
      if (!input.isPointerLocked) {
        input.requestPointerLock();
      }
    });
  }

  // Game loop
  const loop = new GameLoop();

  // Process camera input once per frame, before fixed updates.
  // This prevents mouse delta from being applied N times when multiple
  // fixedUpdate ticks run in a single frame.
  loop.onFrameStart = () => {
    cameraController.processInput();
  };

  loop.fixedUpdate = (_dt: number) => {
    // Movement system
    movementSystem(FIXED_TIMESTEP);

    // Step physics
    world.physicsWorld.step();

    // Tracer hit detection + damage resolution
    TracerSystem(world, FIXED_TIMESTEP);
    DamageSystem(world, FIXED_TIMESTEP);

    // Sync player mesh position with ECS
    playerMesh.position.set(
      Position.x[playerEid],
      Position.y[playerEid],
      Position.z[playerEid],
    );
  };

  loop.update = (dt: number) => {
    debugOverlay.update(dt, playerEid, cameraController);
  };

  loop.render = (alpha: number) => {
    tracerDebugRenderer.update();
    cameraController.updateCamera(playerEid, alpha);
    world.renderer.render(world.scene, world.camera);
  };

  loop.onFrameEnd = () => {
    input.resetFrameDeltas();
  };

  loop.start();
}

main().catch(console.error);
