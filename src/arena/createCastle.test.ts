import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  createCastle,
  stepRise,
  RAMPART_STAIR,
  KEEP_STAIR,
  WALL_HALF,
  WALL_HEIGHT,
  WALL_THICKNESS,
  GATE_HALF_WIDTH,
  GATE_CLEAR_HEIGHT,
  CORNER_TOWER_SIZE,
  CORNER_TOWER_PARAPET_RISE,
} from './createCastle';
import { PLATEAU_TOP_Y } from './arenaV2Spec';
import type { GameWorld } from '../core/types';
import { AUTOSTEP_MAX_HEIGHT, AUTOSTEP_MIN_WIDTH } from '../core/types';

/**
 * Tests for `createCastle()` — the Arena v2 castle (issue #208).
 *
 * A lightweight Rapier mock captures every fixed body + cuboid collider so we
 * can reconstruct each placed box as `{ center, halfExtents }` and assert the
 * walkability + containment invariants that stand in for the manual
 * play-through (this environment is headless). THREE runs natively.
 */

interface CapturedBody {
  translation: { x: number; y: number; z: number };
  handle: number;
}
interface CapturedCollider {
  args: number[];
  bodyHandle: number;
}

function createRapierMock() {
  const bodies: CapturedBody[] = [];
  const colliders: CapturedCollider[] = [];
  let nextHandle = 1;
  function makeRigidBodyDesc() {
    const desc: any = {
      type: 'fixed',
      translation: { x: 0, y: 0, z: 0 },
      setTranslation(x: number, y: number, z: number) {
        desc.translation = { x, y, z };
        return desc;
      },
    };
    return desc;
  }
  return {
    bodies,
    colliders,
    rapier: {
      RigidBodyDesc: { fixed: () => makeRigidBodyDesc() },
      ColliderDesc: {
        cuboid: (hx: number, hy: number, hz: number) => ({
          shape: 'cuboid' as const,
          args: [hx, hy, hz],
        }),
      },
    } as unknown as GameWorld['rapier'],
    physicsWorld: {
      createRigidBody: vi.fn((desc: any) => {
        const handle = nextHandle++;
        bodies.push({ translation: desc.translation, handle });
        return { handle };
      }),
      createCollider: vi.fn((desc: any, body: any) => {
        colliders.push({ args: desc.args, bodyHandle: body.handle });
        return { handle: nextHandle++ };
      }),
    } as unknown as GameWorld['physicsWorld'],
  };
}

function makeWorldFixture() {
  const rapierMock = createRapierMock();
  return {
    rapierMock,
    world: {
      scene: new THREE.Scene(),
      ecs: {} as GameWorld['ecs'],
      renderer: {} as GameWorld['renderer'],
      rapier: rapierMock.rapier,
      physicsWorld: rapierMock.physicsWorld,
      camera: new THREE.PerspectiveCamera(),
      playerEntity: -1,
    } as GameWorld,
  };
}

/** Reconstruct placed boxes as center + half-extents by pairing body↔collider. */
interface Box {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}
function reconstructBoxes(
  rapierMock: ReturnType<typeof createRapierMock>,
): Box[] {
  const bodyById = new Map(rapierMock.bodies.map((b) => [b.handle, b]));
  return rapierMock.colliders.map((c) => {
    const b = bodyById.get(c.bodyHandle)!;
    return {
      cx: b.translation.x,
      cy: b.translation.y,
      cz: b.translation.z,
      hx: c.args[0],
      hy: c.args[1],
      hz: c.args[2],
    };
  });
}

const ORIGIN = { x: 0, y: PLATEAU_TOP_Y, z: 0 };

describe('createCastle (Arena v2 castle, #208)', () => {
  let world: GameWorld;
  let rapierMock: ReturnType<typeof createRapierMock>;

  beforeEach(() => {
    const fixture = makeWorldFixture();
    world = fixture.world;
    rapierMock = fixture.rapierMock;
  });

  /* ── Stair rise (the acceptance-required unit test) ── */
  describe('stairs are climbable with plain W', () => {
    it('every staircase step rise ≤ AUTOSTEP_MAX_HEIGHT', () => {
      for (const spec of [RAMPART_STAIR, KEEP_STAIR]) {
        expect(stepRise(spec)).toBeLessThanOrEqual(AUTOSTEP_MAX_HEIGHT);
      }
    });

    it('every staircase tread ≥ AUTOSTEP_MIN_WIDTH (autostep needs clearance)', () => {
      for (const spec of [RAMPART_STAIR, KEEP_STAIR]) {
        expect(spec.tread).toBeGreaterThanOrEqual(AUTOSTEP_MIN_WIDTH);
      }
    });

    it('the two rampart staircases climb exactly to the wall top (WALL_HEIGHT)', () => {
      expect(RAMPART_STAIR.totalRise).toBe(WALL_HEIGHT);
      // Top step top-surface = floor + stepCount*rise = floor + WALL_HEIGHT.
      const topSurface = RAMPART_STAIR.stepCount * stepRise(RAMPART_STAIR);
      expect(topSurface).toBeCloseTo(WALL_HEIGHT, 6);
    });
  });

  /* ── Geometry inventory ── */
  it('places boxes and returns one handle per placed box', () => {
    const handles = createCastle(world, ORIGIN);
    expect(handles.length).toBeGreaterThan(0);
    // Every placed box = 1 body + 1 collider + 1 mesh.
    expect(rapierMock.bodies).toHaveLength(handles.length);
    expect(rapierMock.colliders).toHaveLength(handles.length);
    const meshes = world.scene.children.filter((c) => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(handles.length);
  });

  /* ── Ramparts: wall tops form a continuous walkway at one height ── */
  it('the curtain wall / tower / lintel tops all sit at the rampart height', () => {
    createCastle(world, ORIGIN);
    const boxes = reconstructBoxes(rapierMock);
    const rampartY = ORIGIN.y + WALL_HEIGHT;
    // The structural boxes that FORM the walkway are the tall ones (height =
    // WALL_HEIGHT) plus the gate lintel. Their top surface must equal rampartY
    // so the circuit is level and continuous — no lip to trip the controller.
    const wallHeightBoxes = boxes.filter(
      (b) => Math.abs(b.hy * 2 - WALL_HEIGHT) < 1e-6,
    );
    expect(wallHeightBoxes.length).toBeGreaterThanOrEqual(9); // 3 solid walls + 2 segs + 2 gate towers + 4 corner towers
    for (const b of wallHeightBoxes) {
      expect(b.cy + b.hy).toBeCloseTo(rampartY, 6);
    }
  });

  /* ── Gate opening is genuinely open (no invisible wall) ── */
  it('the gate opening is clear below the lintel — no collider blocks it', () => {
    createCastle(world, ORIGIN);
    const boxes = reconstructBoxes(rapierMock);
    // Opening AABB: |x| < GATE_HALF_WIDTH, floor < y < floor+GATE_CLEAR_HEIGHT,
    // straddling the south wall line (z ≈ +WALL_HALF). Shrink by an epsilon so
    // boxes that merely TOUCH the opening (lintel bottom, gate-tower sides) do
    // not count as blocking.
    const eps = 1e-3;
    const oMinX = -GATE_HALF_WIDTH + eps;
    const oMaxX = GATE_HALF_WIDTH - eps;
    const oMinY = ORIGIN.y + eps;
    const oMaxY = ORIGIN.y + GATE_CLEAR_HEIGHT - eps;
    const oMinZ = WALL_HALF - WALL_THICKNESS; // through the wall band
    const oMaxZ = WALL_HALF + WALL_THICKNESS;
    const overlaps = (b: Box): boolean =>
      b.cx - b.hx < oMaxX &&
      b.cx + b.hx > oMinX &&
      b.cy - b.hy < oMaxY &&
      b.cy + b.hy > oMinY &&
      b.cz - b.hz < oMaxZ &&
      b.cz + b.hz > oMinZ;
    expect(boxes.some(overlaps)).toBe(false);
  });

  /* ── Containment ── */
  it('the whole castle sits on the plateau flat top and under the safe-volume ceiling', () => {
    createCastle(world, ORIGIN);
    const boxes = reconstructBoxes(rapierMock);
    // Plateau flat top is |x|,|z| ≤ 18 (PLATEAU_HALF_EXTENT). Curtain walls at
    // ±15 with 4×4 corner towers reach ±17 → must stay on the flat top.
    // weaponPickupSafeVolume y-max is 20; tallest tower parapet must clear it.
    const maxParapetTop = ORIGIN.y + WALL_HEIGHT + CORNER_TOWER_PARAPET_RISE; // 13
    expect(maxParapetTop).toBeLessThan(20);
    for (const b of boxes) {
      expect(Math.abs(b.cx) + b.hx).toBeLessThanOrEqual(18);
      expect(Math.abs(b.cz) + b.hz).toBeLessThanOrEqual(18);
      expect(b.cy - b.hy).toBeGreaterThanOrEqual(0); // never below ground
      expect(b.cy + b.hy).toBeLessThanOrEqual(20); // under the safe-volume ceiling
    }
  });

  /* ── Corner towers stand above the walls ── */
  it('corner tower parapets rise above the rampart (tower silhouette)', () => {
    createCastle(world, ORIGIN);
    const boxes = reconstructBoxes(rapierMock);
    const rampartY = ORIGIN.y + WALL_HEIGHT;
    // Corner parapets are the height-3 boxes that START at the rampart (bottom
    // == rampartY) — the `>= rampartY` guard excludes staircase steps that
    // happen to be 3 m tall but rise from the courtyard floor.
    const tallParapets = boxes.filter(
      (b) =>
        Math.abs(b.hy * 2 - CORNER_TOWER_PARAPET_RISE) < 1e-6 &&
        b.cy - b.hy >= rampartY - 1e-6,
    );
    // 4 towers × 2 outer-edge parapets.
    expect(tallParapets.length).toBe(8);
    for (const b of tallParapets) {
      expect(b.cy + b.hy).toBeGreaterThan(rampartY);
    }
  });

  /* ── Origin-relative: castle translates with its origin ── */
  it('is placed relative to origin (offset origin shifts every box by the same delta)', () => {
    const a = makeWorldFixture();
    createCastle(a.world, ORIGIN);
    const boxesA = reconstructBoxes(a.rapierMock);

    const b = makeWorldFixture();
    createCastle(b.world, { x: ORIGIN.x + 5, y: ORIGIN.y, z: ORIGIN.z - 7 });
    const boxesB = reconstructBoxes(b.rapierMock);

    expect(boxesA).toHaveLength(boxesB.length);
    for (let i = 0; i < boxesA.length; i++) {
      expect(boxesB[i].cx - boxesA[i].cx).toBeCloseTo(5, 6);
      expect(boxesB[i].cz - boxesA[i].cz).toBeCloseTo(-7, 6);
      expect(boxesB[i].cy - boxesA[i].cy).toBeCloseTo(0, 6);
    }
  });
});
