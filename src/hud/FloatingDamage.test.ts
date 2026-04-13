import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FloatingDamage } from './FloatingDamage';

describe('FloatingDamage', () => {
  let camera: THREE.PerspectiveCamera;
  let floatingDamage: FloatingDamage;

  beforeEach(() => {
    // Clean up
    const existing = document.getElementById('floating-damage-container');
    if (existing) existing.remove();

    camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 1.6, -5);
    camera.updateMatrixWorld(true);

    floatingDamage = new FloatingDamage(camera);
  });

  it('should create the container div', () => {
    const container = document.getElementById('floating-damage-container');
    expect(container).not.toBeNull();
    expect(container!.style.pointerEvents).toBe('none');
  });

  it('should spawn a damage number element', () => {
    const pos = new THREE.Vector3(0, 1.5, -3);
    floatingDamage.spawn(50, 'HEAD', pos);

    const container = document.getElementById('floating-damage-container');
    expect(container!.children.length).toBe(1);
    expect(container!.children[0].textContent).toBe('50 HEAD');
  });

  it('should spawn multiple damage numbers', () => {
    floatingDamage.spawn(50, 'HEAD', new THREE.Vector3(0, 2, -3));
    floatingDamage.spawn(35, 'TORSO', new THREE.Vector3(0, 1, -3));
    floatingDamage.spawn(25, 'LEG', new THREE.Vector3(0, 0.5, -3));

    const container = document.getElementById('floating-damage-container');
    expect(container!.children.length).toBe(3);
  });

  it('should clean up on dispose', () => {
    floatingDamage.dispose();
    const container = document.getElementById('floating-damage-container');
    expect(container).toBeNull();
  });
});
