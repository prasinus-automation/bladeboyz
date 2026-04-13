import * as THREE from 'three';
import type { GameWorld } from '../../core/types';

/**
 * Create a simple test arena — flat ground plane with some obstacles.
 */
export function createArena(world: GameWorld): void {
  // Ground plane (visual)
  const groundGeo = new THREE.PlaneGeometry(50, 50);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x556b2f });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  world.scene.add(ground);

  // Ground collider (physics)
  const groundBodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const groundBody = world.physicsWorld.createRigidBody(groundBodyDesc);
  const groundColliderDesc = world.rapier.ColliderDesc.cuboid(25, 0.1, 25);
  world.physicsWorld.createCollider(groundColliderDesc, groundBody);

  // Some box obstacles
  const boxPositions = [
    { x: 5, z: 5 },
    { x: -4, z: 3 },
    { x: 8, z: -6 },
    { x: -7, z: -4 },
  ];

  for (const pos of boxPositions) {
    const boxSize = 1 + Math.random() * 1.5;
    const height = 1 + Math.random() * 2;

    // Visual
    const boxGeo = new THREE.BoxGeometry(boxSize, height, boxSize);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x888888 + Math.floor(Math.random() * 0x444444),
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.position.set(pos.x, height / 2, pos.z);
    world.scene.add(boxMesh);

    // Physics
    const boxBodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, height / 2, pos.z);
    const boxBody = world.physicsWorld.createRigidBody(boxBodyDesc);
    const boxColliderDesc = world.rapier.ColliderDesc.cuboid(boxSize / 2, height / 2, boxSize / 2);
    world.physicsWorld.createCollider(boxColliderDesc, boxBody);
  }

  // Grid helper for orientation
  const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x333333);
  gridHelper.position.y = 0.01;
  world.scene.add(gridHelper);
}
