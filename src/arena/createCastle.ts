/**
 * `createCastle` — the Arena v2 centerpiece (issue #208, parent #205).
 *
 * A low-poly medieval castle built on the 36×36 m stone plateau delivered by
 * #207. Everything is flat-colored `BoxGeometry` + `MeshStandardMaterial` with
 * 1:1 Rapier fixed cuboid colliders via the shared `addStaticBox` helper — no
 * glTF, no textures, no shadows, no CSG.
 *
 * All geometry is placed RELATIVE to `origin` (the plateau center at its flat
 * top, `{ x: 0, y: PLATEAU_TOP_Y, z: 0 }`), so re-tuning the plateau moves the
 * whole castle. `origin.y` is the courtyard floor; heights below are expressed
 * relative to it (e.g. the rampart walkway is at `origin.y + WALL_HEIGHT`).
 *
 * ── Layout (top-down; +Z is "south", toward the gate / main path) ───────────
 *
 *        -Z (north)
 *     ┌───────────────────┐   T = corner tower (4×4, parapet to +9 m)
 *     │ T ─── N wall ─── T │   G = gate tower (3×3) flanking a 4 m opening
 *     │ │               │ │   K = keep (8×8, roof reachable by ext. stair)
 *     │ W    K    stair E │   ═ = rampart walkway (wall top, y=+6)
 *     │ │  stair↑       │ │   staircases climb courtyard floor → ramparts
 *     │ T ─G─[gate]─G─ T │
 *     └───────────────────┘
 *        +Z (south, gate faces the dirt path + market stall)
 *
 * ── Verticality contract ────────────────────────────────────────────────────
 * The wall tops ARE the ramparts: a `WALL_THICKNESS`-wide walkway with a low
 * outer parapet. Two courtyard staircases (stacked boxes, step rise ≤ the
 * character controller's `AUTOSTEP_MAX_HEIGHT` so plain W climbs them) reach the
 * ramparts; the full wall circuit — including over the gate lintel and across
 * every tower platform — is walkable, and the open inner edge lets you drop back
 * into the courtyard. Pinned by `createCastle.test.ts`.
 */

import type { GameWorld } from '../core/types';
import { AUTOSTEP_MAX_HEIGHT } from '../core/types';
import type { Vec3 } from './types';
import { addStaticBox, type StaticHandle } from './addStaticBox';

/* ────────────────────────────────────────────────────────────────────────
 * Dimensions — the file people re-tune. All heights are relative to
 * `origin.y` (courtyard floor = plateau top). All XZ are relative to origin.
 * ──────────────────────────────────────────────────────────────────────── */

/** Curtain-wall footprint half-extent → a 30×30 m castle inside the 36×36 plateau. */
export const WALL_HALF = 15;
/** Curtain-wall height. Wall top (the rampart walkway) sits at `origin.y + WALL_HEIGHT`. */
export const WALL_HEIGHT = 6;
/** Curtain-wall thickness. The wall top IS the rampart walkway, so ≥1.2 m to fight on. */
export const WALL_THICKNESS = 1.2;

/** Low outer-edge parapet on the ramparts (cover; leave the inner edge open). */
export const PARAPET_HEIGHT = 0.8;
export const PARAPET_THICKNESS = 0.3;

/** Half-width of the gate opening → a 4 m-wide entrance. */
export const GATE_HALF_WIDTH = 2;
/** Clear height of the gate opening (opening runs floor → `origin.y + GATE_CLEAR_HEIGHT`). */
export const GATE_CLEAR_HEIGHT = 4.5;
/** Gate tower footprint (square) flanking the opening. */
export const GATE_TOWER_SIZE = 3;

/** Corner tower footprint (square). */
export const CORNER_TOWER_SIZE = 4;
/** Corner tower parapet rises this far above the walkway → ~9 m tall, above the walls. */
export const CORNER_TOWER_PARAPET_RISE = 3;

/** Central keep footprint (square) and height (roof reachable by external stair). */
export const KEEP_SIZE = 8;
export const KEEP_HEIGHT = 6;

/**
 * Staircase generation spec. `rise = totalRise / stepCount` is the per-step
 * height; it MUST stay ≤ `AUTOSTEP_MAX_HEIGHT` (0.3) so the kinematic character
 * controller climbs it with plain W and zero special code. Enforced by
 * `createCastle.test.ts` for every spec below.
 */
export interface StairSpec {
  /** Total vertical climb (courtyard floor → destination top). */
  totalRise: number;
  /** Number of steps. `rise = totalRise / stepCount`. */
  stepCount: number;
  /** Depth of each step tread along the run axis (≥ AUTOSTEP_MIN_WIDTH; ≥0.4 comfortable). */
  tread: number;
  /** Walkable width across the run. */
  width: number;
}

/** Per-step rise for a stair spec. Kept ≤ AUTOSTEP_MAX_HEIGHT (asserted in tests). */
export function stepRise(spec: StairSpec): number {
  return spec.totalRise / spec.stepCount;
}

/** Ramparts are WALL_HEIGHT above the floor; 24×0.25 = 6 m, rise 0.25 ≤ 0.3. */
export const RAMPART_STAIR: StairSpec = {
  totalRise: WALL_HEIGHT,
  stepCount: 24,
  tread: 0.5,
  width: 2,
};

/** Keep roof is KEEP_HEIGHT above the floor; 24×0.25 = 6 m, rise 0.25 ≤ 0.3. */
export const KEEP_STAIR: StairSpec = {
  totalRise: KEEP_HEIGHT,
  stepCount: 24,
  tread: 0.4,
  width: 2,
};

/* ── Colors (flat, earthy / stone) ── */
const COLOR_STONE = 0x8a8a8a; // curtain walls, towers, parapets
const COLOR_STONE_DARK = 0x6f6f6f; // keep (slightly darker to read as a distinct mass)
const COLOR_WOOD = 0x6e4a2a; // crates / stair treads accents
const COLOR_WELL = 0x777777; // well ring

/* ────────────────────────────────────────────────────────────────────────
 * Stair builder — stacked axis-aligned boxes, each a solid riser from the
 * floor up to that step's top. Adjacent step tops differ by exactly `rise`,
 * so the controller autosteps them. Returns the placed handles.
 * ──────────────────────────────────────────────────────────────────────── */

interface StairPlacement {
  spec: StairSpec;
  floorY: number; // absolute y of the courtyard floor (bottom of step 0)
  /** Coordinate along the run axis where step 0's NEAR edge starts. */
  start: number;
  runAxis: 'x' | 'z';
  /** +1 ascends toward increasing coordinate, -1 toward decreasing. */
  runDir: 1 | -1;
  /** Fixed center coordinate on the other horizontal axis. */
  lateral: number;
  color: number;
}

function buildStaircase(
  world: GameWorld,
  handles: StaticHandle[],
  p: StairPlacement,
): void {
  const rise = stepRise(p.spec);
  for (let i = 0; i < p.spec.stepCount; i++) {
    // Each step is a solid riser from the floor to its top; adjacent tops
    // differ by exactly `rise`, so the controller autosteps between them.
    const height = (i + 1) * rise;
    const centerY = p.floorY + height / 2;
    // Center of this step along the run axis (near edge + i treads + half tread).
    const alongCenter = p.start + p.runDir * (i * p.spec.tread + p.spec.tread / 2);

    const center: Vec3 =
      p.runAxis === 'x'
        ? { x: alongCenter, y: centerY, z: p.lateral }
        : { x: p.lateral, y: centerY, z: alongCenter };
    const size =
      p.runAxis === 'x'
        ? { x: p.spec.tread, y: height, z: p.spec.width }
        : { x: p.spec.width, y: height, z: p.spec.tread };

    handles.push(addStaticBox(world, center, size, p.color));
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * createCastle
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Build the castle at `origin` (plateau center, at its flat top). Returns the
 * placed mesh/body handles for disposal (HMR / arena teardown).
 */
export function createCastle(world: GameWorld, origin: Vec3): StaticHandle[] {
  const handles: StaticHandle[] = [];
  const box = (center: Vec3, size: Vec3, color: number): void => {
    handles.push(addStaticBox(world, center, size, color));
  };

  const floorY = origin.y; // courtyard floor = plateau top
  const rampartY = floorY + WALL_HEIGHT; // wall top / walkway surface
  const wallCenterY = floorY + WALL_HEIGHT / 2;
  const ox = origin.x;
  const oz = origin.z;

  /* ── Curtain walls ──
   * N / E / W are solid; the S (+Z) wall is segmented around the gate. Each
   * wall spans the full 30 m and the corner towers overlap the junctions, so
   * the rampart walkway is continuous around the circuit. */

  // North wall (z = -WALL_HALF), runs along X.
  box(
    { x: ox, y: wallCenterY, z: oz - WALL_HALF },
    { x: WALL_HALF * 2, y: WALL_HEIGHT, z: WALL_THICKNESS },
    COLOR_STONE,
  );
  // East wall (x = +WALL_HALF), runs along Z.
  box(
    { x: ox + WALL_HALF, y: wallCenterY, z: oz },
    { x: WALL_THICKNESS, y: WALL_HEIGHT, z: WALL_HALF * 2 },
    COLOR_STONE,
  );
  // West wall (x = -WALL_HALF), runs along Z.
  box(
    { x: ox - WALL_HALF, y: wallCenterY, z: oz },
    { x: WALL_THICKNESS, y: WALL_HEIGHT, z: WALL_HALF * 2 },
    COLOR_STONE,
  );

  /* ── South wall + gatehouse (z = +WALL_HALF) ──
   * Built as segments around the opening (NO CSG): left segment, right
   * segment, two gate towers flanking the gap, and a lintel bridging the top
   * so the rampart walkway crosses the gate. */
  const gateTowerHalf = GATE_TOWER_SIZE / 2; // 1.5
  // Inner edge of each gate tower (nearest the opening) is at ±(GATE_HALF_WIDTH).
  const gateTowerCenterX = GATE_HALF_WIDTH + gateTowerHalf; // 3.5
  const gateTowerOuterX = GATE_HALF_WIDTH + GATE_TOWER_SIZE; // 5 (= wall-segment inner end)

  // Left wall segment: x from -WALL_HALF to -gateTowerOuterX.
  {
    const len = WALL_HALF - gateTowerOuterX; // 10
    box(
      { x: ox - (gateTowerOuterX + WALL_HALF) / 2, y: wallCenterY, z: oz + WALL_HALF },
      { x: len, y: WALL_HEIGHT, z: WALL_THICKNESS },
      COLOR_STONE,
    );
  }
  // Right wall segment: x from +gateTowerOuterX to +WALL_HALF.
  {
    const len = WALL_HALF - gateTowerOuterX; // 10
    box(
      { x: ox + (gateTowerOuterX + WALL_HALF) / 2, y: wallCenterY, z: oz + WALL_HALF },
      { x: len, y: WALL_HEIGHT, z: WALL_THICKNESS },
      COLOR_STONE,
    );
  }
  // Two gate towers (3×3), solid shafts to the rampart level (walkable top).
  for (const sx of [-1, 1] as const) {
    box(
      { x: ox + sx * gateTowerCenterX, y: wallCenterY, z: oz + WALL_HALF },
      { x: GATE_TOWER_SIZE, y: WALL_HEIGHT, z: GATE_TOWER_SIZE },
      COLOR_STONE,
    );
    // Outer-face parapet giving the gatehouse a taller silhouette (does not
    // block the walkway — sits on the +Z lip only).
    box(
      {
        x: ox + sx * gateTowerCenterX,
        y: rampartY + PARAPET_HEIGHT,
        z: oz + WALL_HALF + gateTowerHalf - PARAPET_THICKNESS / 2,
      },
      { x: GATE_TOWER_SIZE, y: PARAPET_HEIGHT * 2, z: PARAPET_THICKNESS },
      COLOR_STONE,
    );
  }
  // Lintel over the opening: bridges the two gate towers so the walkway is
  // continuous. Bottom at the opening's clear height, top at the rampart.
  {
    const lintelBottom = floorY + GATE_CLEAR_HEIGHT; // 8.5 abs (relative +4.5)
    const lintelHeight = rampartY - lintelBottom; // 1.5
    box(
      {
        x: ox,
        y: lintelBottom + lintelHeight / 2,
        z: oz + WALL_HALF,
      },
      { x: GATE_HALF_WIDTH * 2, y: lintelHeight, z: GATE_TOWER_SIZE },
      COLOR_STONE,
    );
  }

  /* ── Outer-edge rampart parapets (low cover) ──
   * On the OUTER lip of each wall only; the inner edge is left open so a fight
   * on the ramparts can spill back into the courtyard. */
  const parapetCenterY = rampartY + PARAPET_HEIGHT / 2;
  const outerLip = WALL_HALF + WALL_THICKNESS / 2 - PARAPET_THICKNESS / 2; // 15.45
  // North (-Z) outer edge.
  box(
    { x: ox, y: parapetCenterY, z: oz - outerLip },
    { x: WALL_HALF * 2, y: PARAPET_HEIGHT, z: PARAPET_THICKNESS },
    COLOR_STONE,
  );
  // East (+X) and West (-X) outer edges.
  for (const sx of [-1, 1] as const) {
    box(
      { x: ox + sx * outerLip, y: parapetCenterY, z: oz },
      { x: PARAPET_THICKNESS, y: PARAPET_HEIGHT, z: WALL_HALF * 2 },
      COLOR_STONE,
    );
  }
  // South (+Z) outer edge, split around the gate towers (left + right).
  for (const sx of [-1, 1] as const) {
    const len = WALL_HALF - gateTowerOuterX; // 10
    box(
      {
        x: ox + sx * ((gateTowerOuterX + WALL_HALF) / 2),
        y: parapetCenterY,
        z: oz + outerLip,
      },
      { x: len, y: PARAPET_HEIGHT, z: PARAPET_THICKNESS },
      COLOR_STONE,
    );
  }

  /* ── Corner towers (4×4) ──
   * Solid shafts whose top is level with the rampart walkway (walk straight
   * on), plus an L-shaped parapet on the two OUTER edges rising ~3 m above the
   * walkway → ~9 m tall silhouette, open platform reachable from the ramparts. */
  const cornerHalf = CORNER_TOWER_SIZE / 2; // 2
  const cornerParapetCenterY = rampartY + CORNER_TOWER_PARAPET_RISE / 2;
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const cx = ox + sx * WALL_HALF;
      const cz = oz + sz * WALL_HALF;
      // Shaft to rampart level.
      box(
        { x: cx, y: wallCenterY, z: cz },
        { x: CORNER_TOWER_SIZE, y: WALL_HEIGHT, z: CORNER_TOWER_SIZE },
        COLOR_STONE,
      );
      // Outer +X/-X edge parapet.
      box(
        {
          x: cx + sx * (cornerHalf - PARAPET_THICKNESS / 2),
          y: cornerParapetCenterY,
          z: cz,
        },
        { x: PARAPET_THICKNESS, y: CORNER_TOWER_PARAPET_RISE, z: CORNER_TOWER_SIZE },
        COLOR_STONE,
      );
      // Outer +Z/-Z edge parapet.
      box(
        {
          x: cx,
          y: cornerParapetCenterY,
          z: cz + sz * (cornerHalf - PARAPET_THICKNESS / 2),
        },
        { x: CORNER_TOWER_SIZE, y: CORNER_TOWER_PARAPET_RISE, z: PARAPET_THICKNESS },
        COLOR_STONE,
      );
    }
  }

  /* ── Two rampart staircases (courtyard floor → ramparts) ──
   * Against the inner faces of the W and E walls, so they don't clutter the
   * central fighting floor. Tops land flush with the wall-top walkway. */
  const innerWallX = WALL_HALF - WALL_THICKNESS / 2; // 14.4 (inner face)
  // West staircase: hugs the W wall inner face, ascends +Z.
  buildStaircase(world, handles, {
    spec: RAMPART_STAIR,
    floorY,
    start: oz - 6, // near edge of step 0
    runAxis: 'z',
    runDir: 1,
    lateral: ox - innerWallX + RAMPART_STAIR.width / 2, // tucked against W wall
    color: COLOR_STONE,
  });
  // East staircase: hugs the E wall inner face, ascends -Z.
  buildStaircase(world, handles, {
    spec: RAMPART_STAIR,
    floorY,
    start: oz + 6,
    runAxis: 'z',
    runDir: -1,
    lateral: ox + innerWallX - RAMPART_STAIR.width / 2, // tucked against E wall
    color: COLOR_STONE,
  });

  /* ── Central keep (8×8) + external stair to its roof ── */
  const keepCenterY = floorY + KEEP_HEIGHT / 2;
  box(
    { x: ox, y: keepCenterY, z: oz },
    { x: KEEP_SIZE, y: KEEP_HEIGHT, z: KEEP_SIZE },
    COLOR_STONE_DARK,
  );
  // External stair on the keep's -Z face, ascending +Z up to the roof. The top
  // step lands flush with the keep's -Z wall at roof height.
  const keepHalf = KEEP_SIZE / 2; // 4
  const keepStairRun = KEEP_STAIR.stepCount * KEEP_STAIR.tread; // 9.6
  buildStaircase(world, handles, {
    spec: KEEP_STAIR,
    floorY,
    start: oz - keepHalf - keepStairRun, // bottom, out in the courtyard
    runAxis: 'z',
    runDir: 1,
    lateral: ox,
    color: COLOR_STONE_DARK,
  });

  /* ── Courtyard dressing: a well + crate/barrel clusters ── */
  // Well: a 2×2 stone ring (four low walls) offset toward +X/+Z corner of the
  // courtyard so it doesn't crowd the keep or stairs.
  const wellX = ox + 8;
  const wellZ = oz + 8;
  const wellH = 0.9;
  const wellCenterY = floorY + wellH / 2;
  const wellHalf = 1; // 2×2 footprint
  const wellWall = 0.3;
  box(
    { x: wellX, y: wellCenterY, z: wellZ - wellHalf + wellWall / 2 },
    { x: wellHalf * 2, y: wellH, z: wellWall },
    COLOR_WELL,
  );
  box(
    { x: wellX, y: wellCenterY, z: wellZ + wellHalf - wellWall / 2 },
    { x: wellHalf * 2, y: wellH, z: wellWall },
    COLOR_WELL,
  );
  box(
    { x: wellX - wellHalf + wellWall / 2, y: wellCenterY, z: wellZ },
    { x: wellWall, y: wellH, z: wellHalf * 2 - wellWall * 2 },
    COLOR_WELL,
  );
  box(
    { x: wellX + wellHalf - wellWall / 2, y: wellCenterY, z: wellZ },
    { x: wellWall, y: wellH, z: wellHalf * 2 - wellWall * 2 },
    COLOR_WELL,
  );

  // Crate clusters (1 m cubes) in two courtyard pockets, clear of the stairs.
  const crate = (cx: number, cz: number, cy: number): void =>
    box({ x: cx, y: floorY + 0.5 + cy, z: cz }, { x: 1, y: 1, z: 1 }, COLOR_WOOD);
  // Cluster A near the -X/+Z pocket.
  crate(ox - 9, oz + 9, 0);
  crate(ox - 8, oz + 10, 0);
  crate(ox - 8.5, oz + 9.2, 1); // stacked on top
  // Cluster B near the +X/-Z pocket.
  crate(ox + 9, oz - 9, 0);
  crate(ox + 10, oz - 8.2, 0);

  return handles;
}
