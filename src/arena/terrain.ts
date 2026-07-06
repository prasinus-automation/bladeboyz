/**
 * Terrain engine — deterministic height sampling + Rapier heightfield builder
 * (Arena v2 foundation, issue #206 / parent #205).
 *
 * ─── Why deterministic + pure ───
 * Multiplayer v1 is live: `server/room.ts` validates damage claims by range,
 * and the doc-04 migration runs tracers server-side. Client and server must
 * agree on terrain geometry *exactly*, so `sampleTerrainHeight(spec, x, z)` is
 * a PURE function of its inputs — no `Math.random`, no `Date.now()`, no hidden
 * state (the G7 forbidden-patterns lint and the networking docs both apply).
 * It is the networking seam, the same pattern as `tryClaimPickup` in
 * `WeaponPickupSystem.ts`: the client resolves ground-y locally from the shared
 * function, and the authoritative server resolves the *same* value from the
 * *same* `TerrainSpec`.
 *
 * ─── Coordinate / Rapier conventions ───
 * A `TerrainSpec` describes a rectangle centered on the world origin spanning
 * `[-sizeX/2, +sizeX/2]` along world X and `[-sizeZ/2, +sizeZ/2]` along world Z.
 * Height is the sum of a flat `baseHeight` plus each analytic feature.
 *
 * Rapier heightfields (`ColliderDesc.heightfield(nrows, ncols, heights, scale)`)
 * are **centered on the body origin**; the `heights` matrix is **column-major**
 * with `(nrows+1) * (ncols+1)` entries. Parry (Rapier's geometry backend) maps
 * **columns → local X** and **rows → local Z**, and vertex `(row i, col j)` sits
 * at `x = (j/ncols - 0.5)*scale.x`, `z = (i/nrows - 0.5)*scale.z`,
 * `y = heights[j*(nrows+1)+i] * scale.y`. We build the heights array to match
 * that convention exactly and pin it with a raycast-parity test — the row/col ↔
 * x/z orientation is NOT intuitive, so it is verified, not trusted. We keep
 * `scale.y = 1` so stored heights are literal world heights, and place the body
 * at the world origin so heightfield-local y equals world y.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameWorld } from '../core/types';

/* ────────────────────────────────────────────────────────────────────────
 * Feature primitives
 *
 * Every feature is an analytic bump/ramp that is summed into the base height.
 * They all evaluate to 0 far from their footprint, so features compose by
 * simple addition and the order of `features` never matters.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A flat-topped raised region with a smoothstep falloff skirt. This is the
 * primitive the follow-up castle footprint sits on: the flat top gives the
 * keep a level foundation, the skirt is a walkable ramp up to it.
 */
export interface PlateauFeature {
  kind: 'plateau';
  /** Center of the flat top (world x/z). */
  x: number;
  z: number;
  /** Half-extent of the flat top along x / z (meters). Inside → full height. */
  radiusX: number;
  radiusZ: number;
  /** Smoothstep skirt width beyond the flat top (meters). 0 → vertical wall. */
  falloff: number;
  /** Height added at the flat top, above the base. */
  height: number;
}

/** A smooth radial bump (cosine falloff), peaking at its center. */
export interface HillFeature {
  kind: 'hill';
  /** Peak center (world x/z). */
  x: number;
  z: number;
  /** Radius at which the hill returns to 0 (meters). */
  radius: number;
  /** Peak height above the base. */
  height: number;
}

/**
 * A linear incline. Rises from 0 to `height` over `length` meters along the
 * `(dirX, dirZ)` axis (measured from the center), flat outside that band and
 * outside a `halfWidth` corridor perpendicular to the axis.
 */
export interface RampFeature {
  kind: 'ramp';
  /** Midpoint of the incline (world x/z). */
  x: number;
  z: number;
  /** Ascent direction (need not be normalized; normalized internally). */
  dirX: number;
  dirZ: number;
  /** Along-axis run over which the ramp rises 0 → height (meters). */
  length: number;
  /** Half-width of the ramp corridor perpendicular to the axis (meters). */
  halfWidth: number;
  /** Total rise across `length`. */
  height: number;
}

export type TerrainFeature = PlateauFeature | HillFeature | RampFeature;

/** Authored terrain description. Pure data — safe to ship to the server. */
export interface TerrainSpec {
  /** Physical extent along world X (meters). */
  sizeX: number;
  /** Physical extent along world Z (meters). */
  sizeZ: number;
  /**
   * Grid cells per axis for the Rapier heightfield. Vertices per axis is
   * `resolution + 1`. Higher → finer collision & smaller linear-interp error
   * versus the analytic `sampleTerrainHeight`.
   */
  resolution: number;
  /** Flat ground height applied everywhere before features. */
  baseHeight: number;
  /** Analytic features summed on top of the base. */
  features: TerrainFeature[];
}

/**
 * A ready-to-query terrain: the authored spec plus a bound sampling closure.
 * Stored on `ArenaSpec.terrain` so systems can resolve ground height without
 * importing map data. `sample` is exactly `sampleTerrainHeight(spec, …)`.
 */
export interface TerrainHandle {
  spec: TerrainSpec;
  sample: (x: number, z: number) => number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Pure math helpers (allocation-free)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Hermite smoothstep. Returns 0 for x≤edge0, 1 for x≥edge1, smooth between.
 *
 * Degenerate edge0===edge1 is a hard step and is treated as right-open — it
 * returns 0 AT the edge and 1 only strictly past it. That's what makes a
 * plateau with `falloff: 0` a vertical wall: on the flat top the distance-past-
 * edge is 0 → smoothstep 0 → weight `1 - 0 = 1` (full height); one epsilon
 * outside → smoothstep 1 → weight 0. A left-open `<` here would instead zero
 * the plateau on its own top.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x <= edge0 ? 0 : 1;
  let t = (x - edge0) / (edge1 - edge0);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/** Clamp v into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Height contribution of a single feature at (x, z). Always ≥ 0. */
function featureHeight(f: TerrainFeature, x: number, z: number): number {
  switch (f.kind) {
    case 'plateau': {
      // Distance OUTSIDE the flat-top rectangle (0 while inside it).
      const dx = Math.max(0, Math.abs(x - f.x) - f.radiusX);
      const dz = Math.max(0, Math.abs(z - f.z) - f.radiusZ);
      const d = Math.sqrt(dx * dx + dz * dz);
      // 1 on the flat top, smoothstep down to 0 across the skirt.
      const w = 1 - smoothstep(0, f.falloff, d);
      return f.height * w;
    }
    case 'hill': {
      const dx = x - f.x;
      const dz = z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= f.radius) return 0;
      // Cosine bump: peak at center, C¹-smooth zero at the rim.
      return f.height * 0.5 * (1 + Math.cos((Math.PI * d) / f.radius));
    }
    case 'ramp': {
      const len = Math.hypot(f.dirX, f.dirZ) || 1;
      const nx = f.dirX / len;
      const nz = f.dirZ / len;
      const rx = x - f.x;
      const rz = z - f.z;
      // Signed along-axis distance and perpendicular distance.
      const along = rx * nx + rz * nz;
      const perp = Math.abs(rx * -nz + rz * nx);
      if (perp > f.halfWidth) return 0;
      // Rise linearly 0→height across [-length/2, +length/2]; flat outside.
      const half = f.length / 2;
      const t = clamp((along + half) / f.length, 0, 1);
      return f.height * t;
    }
    default:
      return 0;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Pure, deterministic, allocation-free ground height at world (x, z).
 *
 * Defined for ALL (x, z): points outside the terrain rectangle are clamped to
 * the nearest edge before sampling, so the function returns the edge height
 * (no NaN, no extrapolation). Same (spec, x, z) → same output, every time.
 */
export function sampleTerrainHeight(
  spec: TerrainSpec,
  x: number,
  z: number,
): number {
  const halfX = spec.sizeX / 2;
  const halfZ = spec.sizeZ / 2;
  const cx = clamp(x, -halfX, halfX);
  const cz = clamp(z, -halfZ, halfZ);

  let h = spec.baseHeight;
  for (let i = 0; i < spec.features.length; i++) {
    h += featureHeight(spec.features[i], cx, cz);
  }
  return h;
}

/**
 * Build the column-major height grid for a Rapier heightfield collider.
 *
 * Length is `(resolution+1)²` — Rapier's `nrows`/`ncols` count the heights
 * matrix's rows/cols (i.e. VERTICES per axis = `resolution+1`), not cells.
 * Vertex `(row i, col j)` — index `j*(resolution+1)+i` — is sampled at world
 * `x = (j/res - 0.5)*sizeX`, `z = (i/res - 0.5)*sizeZ`, matching parry's
 * heightfield vertex convention (columns→x, rows→z). With `scale.y = 1` the
 * stored value is the world height.
 */
export function buildTerrainHeights(spec: TerrainSpec): Float32Array {
  const res = spec.resolution;
  const n = res + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const x = (j / res - 0.5) * spec.sizeX;
    for (let i = 0; i < n; i++) {
      const z = (i / res - 0.5) * spec.sizeZ;
      heights[j * n + i] = sampleTerrainHeight(spec, x, z);
    }
  }
  return heights;
}

/** Result of {@link createTerrainCollider}. */
export interface TerrainCollider {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * Create the fixed Rapier heightfield collider for a terrain spec.
 *
 * The body sits at the world origin and the heightfield is centered on it, so
 * heightfield-local y equals world y (we pass `scale.y = 1`). `nrows = ncols =
 * resolution`; `scale = (sizeX, 1, sizeZ)`.
 */
export function createTerrainCollider(
  world: Pick<GameWorld, 'rapier' | 'physicsWorld'>,
  spec: TerrainSpec,
): TerrainCollider {
  const heights = buildTerrainHeights(spec);
  const nrows = spec.resolution;
  const ncols = spec.resolution;
  const scale = new world.rapier.Vector3(spec.sizeX, 1, spec.sizeZ);

  const bodyDesc = world.rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const body = world.physicsWorld.createRigidBody(bodyDesc);
  const colliderDesc = world.rapier.ColliderDesc.heightfield(
    nrows,
    ncols,
    heights,
    scale,
  );
  const collider = world.physicsWorld.createCollider(colliderDesc, body);
  return { body, collider };
}

/**
 * Wrap a spec in a {@link TerrainHandle} (spec + bound sample closure) for
 * storage on `ArenaSpec.terrain`. The closure captures only the immutable
 * spec, so it stays pure.
 */
export function makeTerrainHandle(spec: TerrainSpec): TerrainHandle {
  return {
    spec,
    sample: (x: number, z: number) => sampleTerrainHeight(spec, x, z),
  };
}
