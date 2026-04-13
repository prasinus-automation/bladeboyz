import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, type IWorld } from 'bitecs';
import type { WorldState } from './types';

let instance: World | null = null;

export class World implements WorldState {
  ecs!: IWorld;
  scene!: THREE.Scene;
  renderer!: THREE.WebGLRenderer;
  camera!: THREE.PerspectiveCamera;
  rapierWorld!: RAPIER.World;
  assetRegistry: Map<string, unknown> = new Map();

  private constructor() {
    // Use async init() instead
  }

  static getInstance(): World {
    if (!instance) {
      instance = new World();
    }
    return instance;
  }

  async init(container: HTMLElement): Promise<void> {
    // Initialize Rapier WASM first — must happen before any physics usage
    await RAPIER.init();

    // bitECS world
    this.ecs = createWorld();

    // Three.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Resize handler
    window.addEventListener('resize', this.onResize);

    // Rapier physics world with gravity
    const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
    this.rapierWorld = new RAPIER.World(gravity);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /** Clean disposal for HMR compatibility */
  dispose(): void {
    window.removeEventListener('resize', this.onResize);

    // Dispose all Three.js objects in the scene
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    this.renderer.domElement.remove();

    // Free Rapier world
    this.rapierWorld.free();

    instance = null;
  }
}
