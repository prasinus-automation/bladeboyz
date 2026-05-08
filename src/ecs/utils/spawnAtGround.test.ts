import { describe, it, expect, vi } from 'vitest';
import { spawnAtGround } from './spawnAtGround';
import { CHARACTER_CONTROLLER_OFFSET, GROUND_TOP_Y } from '../../core/types';

/**
 * Tests for spawnAtGround helper. Mocks Rapier's raycast API; we don't
 * need a real physics world — only the ray/Vector3 constructors and the
 * `physicsWorld.castRay` shape.
 */

function makeMockWorld(opts: {
  hit?: { timeOfImpact: number } | null;
  noCastRay?: boolean;
} = {}) {
  return {
    rapier: {
      Vector3: vi.fn().mockImplementation((x: number, y: number, z: number) => ({ x, y, z })),
      Ray: vi.fn().mockImplementation((origin: any, dir: any) => ({ origin, dir })),
    },
    physicsWorld: opts.noCastRay
      ? ({} as any)
      : {
          castRay: vi.fn().mockReturnValue(opts.hit ?? null),
        },
  };
}

describe('spawnAtGround', () => {
  it('returns ground hit + epsilon when raycast hits', () => {
    // Hit at y = 0.1 (top of ground). origin y=50, dir=-Y, toi = 49.9.
    const world = makeMockWorld({ hit: { timeOfImpact: 49.9 } });
    const result = spawnAtGround(world as any, 0, 0);

    // 50 - 49.9 = 0.1 = GROUND_TOP_Y
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
    expect(result.y).toBeCloseTo(GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET, 5);
  });

  it('passes through (x, z) unchanged', () => {
    const world = makeMockWorld({ hit: { timeOfImpact: 49.9 } });
    const result = spawnAtGround(world as any, 5.5, -3.2);
    expect(result.x).toBe(5.5);
    expect(result.z).toBe(-3.2);
  });

  it('falls back to GROUND_TOP_Y + offset when raycast misses', () => {
    const world = makeMockWorld({ hit: null });
    const result = spawnAtGround(world as any, 0, 0);
    expect(result.y).toBeCloseTo(GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET, 5);
  });

  it('falls back when physicsWorld has no castRay (mocked tests)', () => {
    const world = makeMockWorld({ noCastRay: true });
    const result = spawnAtGround(world as any, 0, 0);
    expect(result.y).toBeCloseTo(GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET, 5);
  });

  it('falls back if Rapier constructors throw', () => {
    const world: any = {
      rapier: {
        Vector3: vi.fn().mockImplementation(() => {
          throw new Error('boom');
        }),
        Ray: vi.fn(),
      },
      physicsWorld: { castRay: vi.fn() },
    };
    const result = spawnAtGround(world, 0, 0);
    expect(result.y).toBeCloseTo(GROUND_TOP_Y + CHARACTER_CONTROLLER_OFFSET, 5);
  });

  it('handles elevated terrain correctly', () => {
    // Terrain top at y = 5 → toi = 45 from origin y=50
    const world = makeMockWorld({ hit: { timeOfImpact: 45 } });
    const result = spawnAtGround(world as any, 0, 0);
    expect(result.y).toBeCloseTo(5 + CHARACTER_CONTROLLER_OFFSET, 5);
  });

  it('casts the ray from y=50 looking straight down', () => {
    const world = makeMockWorld({ hit: { timeOfImpact: 49.9 } });
    spawnAtGround(world as any, 7, -3);

    // First Vector3 call = origin
    const v3Calls = (world.rapier.Vector3 as any).mock.calls;
    expect(v3Calls[0]).toEqual([7, 50, -3]);
    // Second Vector3 call = downward direction
    expect(v3Calls[1]).toEqual([0, -1, 0]);
  });
});
