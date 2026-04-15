import { describe, it, expect } from 'vitest';
import { colliderToHitbox, weaponBoneMap, weaponConfigMap } from './TracerSystem';

/**
 * Tests for damage pipeline wiring — verifies that TracerSystem side-maps
 * are importable and have the correct types. Full integration tests
 * (with Rapier WASM) would test createHitboxes populating colliderToHitbox.
 */

describe('Damage pipeline side-maps', () => {
  it('colliderToHitbox is an exported Map', () => {
    expect(colliderToHitbox).toBeInstanceOf(Map);
  });

  it('weaponBoneMap is an exported Map', () => {
    expect(weaponBoneMap).toBeInstanceOf(Map);
  });

  it('weaponConfigMap is an exported Map', () => {
    expect(weaponConfigMap).toBeInstanceOf(Map);
  });

  it('colliderToHitbox.set stores ownerEid and bodyRegion', () => {
    colliderToHitbox.set(999, { ownerEid: 1, bodyRegion: 0 });
    const entry = colliderToHitbox.get(999);
    expect(entry).toEqual({ ownerEid: 1, bodyRegion: 0 });
    colliderToHitbox.delete(999); // cleanup
  });
});
