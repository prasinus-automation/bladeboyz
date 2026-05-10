import { describe, it, expect, beforeEach } from 'vitest';
import { Position } from '../components';
import { shopkeepRegistry } from '../entities/createShopkeep';
import {
  interactionSystem,
  getNearbyInteractable,
  clearInteractionCache,
} from './InteractionSystem';

/**
 * InteractionSystem tests — verifies proximity selection logic without
 * touching Three.js, Rapier, or actual entity factories. Direct writes
 * to Position TypedArrays + shopkeepRegistry are enough.
 */

const PLAYER_EID = 1;

function placePlayer(x: number, y: number, z: number): void {
  Position.x[PLAYER_EID] = x;
  Position.y[PLAYER_EID] = y;
  Position.z[PLAYER_EID] = z;
}

function placeShopkeep(eid: number, x: number, y: number, z: number, radius = 2.5): void {
  Position.x[eid] = x;
  Position.y[eid] = y;
  Position.z[eid] = z;
  shopkeepRegistry.set(eid, { name: `Shop${eid}`, interactRadius: radius });
}

describe('InteractionSystem', () => {
  beforeEach(() => {
    shopkeepRegistry.clear();
    clearInteractionCache();
    placePlayer(0, 0, 0);
  });

  describe('getNearbyInteractable', () => {
    it('returns null when no shopkeep is registered', () => {
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();
    });

    it('returns null when shopkeep is outside the interact radius', () => {
      placeShopkeep(10, 5, 0, 0); // 5m away, radius 2.5m
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();
    });

    it('returns the shopkeep id when within radius', () => {
      placeShopkeep(10, 1.5, 0, 0); // 1.5m away, radius 2.5m
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBe(10);
    });

    it('returns the nearest of multiple in-range shopkeeps', () => {
      placeShopkeep(10, 1.5, 0, 0); // 1.5m away
      placeShopkeep(11, 1.0, 0, 0); // 1.0m away ← closer
      placeShopkeep(12, 2.0, 0, 0); // 2.0m away
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBe(11);
    });

    it('uses 3D distance, not 2D', () => {
      // Within ground-plane (XZ) reach but vertically far away
      placeShopkeep(10, 1.0, 5.0, 0, 2.5); // dy=5 → distance > 2.5
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();
    });

    it('respects per-shopkeep interactRadius', () => {
      // Out of radius for shop 10 (1.0m), but in radius for shop 11 (5.0m)
      placeShopkeep(10, 3.0, 0, 0, /* radius */ 1.0);
      placeShopkeep(11, 4.0, 0, 0, /* radius */ 5.0);
      interactionSystem(PLAYER_EID);
      // Shop 11 is the only in-range option even though it's farther
      expect(getNearbyInteractable(PLAYER_EID)).toBe(11);
    });

    it('updates cached value across consecutive ticks', () => {
      placeShopkeep(10, 1.5, 0, 0);
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBe(10);

      // Move player away
      placePlayer(20, 0, 20);
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();

      // Move player back
      placePlayer(0, 0, 0);
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBe(10);
    });

    it('returns null without calling tick first', () => {
      placeShopkeep(10, 1.0, 0, 0);
      // No call to interactionSystem
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();
    });
  });

  describe('clearInteractionCache', () => {
    it('clears all entries when called without an arg', () => {
      placeShopkeep(10, 1.0, 0, 0);
      interactionSystem(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBe(10);
      clearInteractionCache();
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();
    });

    it('clears only the specified player when given an eid', () => {
      placeShopkeep(10, 1.0, 0, 0);
      interactionSystem(PLAYER_EID);
      // Tick a different player too
      Position.x[2] = 0;
      Position.y[2] = 0;
      Position.z[2] = 0;
      interactionSystem(2);
      clearInteractionCache(PLAYER_EID);
      expect(getNearbyInteractable(PLAYER_EID)).toBeNull();
      expect(getNearbyInteractable(2)).toBe(10);
    });
  });
});
