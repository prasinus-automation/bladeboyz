/**
 * Render-time position extrapolation for the LOCAL player (#goal-2026-07
 * movement-feel pass).
 *
 * Classic interpolation renders the state at time `T-1 + alpha` — always
 * up to one full fixed tick (16.7ms) behind the simulation, which is felt
 * as movement latency on WASD (the camera look is per-frame and lag-free,
 * so the position lag reads as "the world drags behind my aim").
 * Extrapolating the last tick's velocity forward renders `T + alpha`,
 * i.e. "now", removing that tick of perceived latency at the cost of a
 * ≤1-tick overshoot (≤12.5cm at sprint speed) on abrupt stops.
 *
 * The Y axis is special-cased: ascending motion extrapolates (snappy jump
 * launch) but descending motion interpolates. Extrapolating a fall would
 * predict the player BELOW the landing surface for a frame — a visible
 * feet-through-floor dip on every hard landing — while descent lag has no
 * visual reference mid-air and costs nothing.
 *
 * Local player only. Remote players and bots must keep interpolating:
 * their state is already a delayed network/AI sample, and extrapolating it
 * amplifies correction rubber-banding.
 */

import { Position, PreviousPosition } from '../ecs/components';

export interface RenderPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Compute the render position for a locally-simulated entity. Writes into
 * `out` (no per-frame allocation) and returns it.
 */
export function extrapolateRenderPosition(
  eid: number,
  alpha: number,
  out: RenderPosition,
): RenderPosition {
  const dx = Position.x[eid] - PreviousPosition.x[eid];
  const dy = Position.y[eid] - PreviousPosition.y[eid];
  const dz = Position.z[eid] - PreviousPosition.z[eid];

  out.x = Position.x[eid] + dx * alpha;
  out.z = Position.z[eid] + dz * alpha;
  out.y =
    dy >= 0
      ? Position.y[eid] + dy * alpha
      : // Descending: interpolate (state at T-1+alpha) so the render never
        // predicts below the last physics-committed height.
        PreviousPosition.y[eid] + dy * alpha;
  return out;
}
