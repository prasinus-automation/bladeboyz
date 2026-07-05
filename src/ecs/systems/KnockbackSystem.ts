/**
 * KnockbackSystem — ballistic integration for non-player entities that get
 * hit by weapons with physical knockback (training dummies today, warmup
 * bots tomorrow).
 *
 * Player-controlled entities are NOT handled here: their knockback is
 * consumed by MovementSystem, which folds `KnockbackState` velocity into
 * the kinematic character controller so wall/prop collisions still
 * resolve properly. This system covers everything else — entities with a
 * `KnockbackState` but no `MovementIntent` — by integrating a simple
 * ballistic trajectory and teleporting their (fixed) Rapier body along:
 *
 *   v.y += GRAVITY·dt         (while airborne)
 *   pos  += v·dt
 *   ground clamp at GROUND_TOP_Y, with a small bounce on hard landings
 *   horizontal friction on the ground, light drag in the air
 *
 * Runs in fixedUpdate AFTER DamageSystem (so a same-tick impulse moves the
 * victim next integration step) and writes:
 *   - `Position` / `PreviousPosition` (Previous = pre-step, for render lerp)
 *   - the entity's Rapier body translation (via `getPhysicsBody`)
 *   - `KnockbackState` velocity decay + `ticksRemaining` countdown
 *
 * The mesh group + hitbox sensors follow automatically — hitboxSystem
 * syncs both from `Position` every tick.
 */

import { defineQuery, hasComponent } from 'bitecs';
import {
  KnockbackState,
  MovementIntent,
  Position,
  PreviousPosition,
} from '../components';
import { getPhysicsBody } from './MovementSystem';
import { FIXED_TIMESTEP, GRAVITY, GROUND_TOP_Y } from '../../core/types';
import type { GameWorld } from '../../core/types';

/** Horizontal velocity multiplier per tick while sliding on the ground. */
const GROUND_FRICTION = 0.86;

/** Horizontal velocity multiplier per tick while airborne. */
const AIR_DRAG = 0.995;

/** Landing speed (m/s downward) above which the victim bounces. */
const BOUNCE_THRESHOLD = 4.0;

/** Fraction of impact speed kept on a bounce. */
const BOUNCE_RESTITUTION = 0.35;

/** Below this speed (m/s) a grounded knockback is considered finished. */
const REST_SPEED = 0.05;

/**
 * Arena walls sit at ±15.25 with the playable interior ending at ±15.
 * Fixed-body teleports bypass collision resolution, so clamp launches
 * to just inside the walls rather than yeeting dummies into the void.
 */
const ARENA_CLAMP = 14.5;

const knockbackQuery = defineQuery([KnockbackState, Position]);

export function knockbackSystem(world: GameWorld): void {
  const entities = knockbackQuery(world.ecs);

  for (const eid of entities) {
    // Player-style entities integrate through MovementSystem instead.
    if (hasComponent(world.ecs, MovementIntent, eid)) continue;

    let vx = KnockbackState.vx[eid];
    let vy = KnockbackState.vy[eid];
    let vz = KnockbackState.vz[eid];
    const active =
      KnockbackState.ticksRemaining[eid] > 0 ||
      vx !== 0 ||
      vy !== 0 ||
      vz !== 0;
    if (!active) continue;

    const x = Position.x[eid];
    const y = Position.y[eid];
    const z = Position.z[eid];

    PreviousPosition.x[eid] = x;
    PreviousPosition.y[eid] = y;
    PreviousPosition.z[eid] = z;

    // GROUND_EPSILON must be generous: Position stores f32, so a value
    // clamped to GROUND_TOP_Y (f64 0.1) reads back as ~0.100000001 — a
    // strict `<=` comparison would see "airborne" forever and never apply
    // ground friction (the victim slides across the arena at constant
    // speed like an air-hockey puck).
    const GROUND_EPSILON = 1e-3;
    const airborne = y > GROUND_TOP_Y + GROUND_EPSILON || vy > 0;
    if (airborne) {
      vy += GRAVITY * FIXED_TIMESTEP;
    }

    let nx = x + vx * FIXED_TIMESTEP;
    let ny = y + vy * FIXED_TIMESTEP;
    let nz = z + vz * FIXED_TIMESTEP;

    // Ground contact.
    if (ny <= GROUND_TOP_Y + GROUND_EPSILON && vy <= 0) {
      ny = Math.max(ny, GROUND_TOP_Y);
      if (vy < -BOUNCE_THRESHOLD) {
        vy = -vy * BOUNCE_RESTITUTION;
      } else {
        vy = 0;
      }
      vx *= GROUND_FRICTION;
      vz *= GROUND_FRICTION;
    } else {
      vx *= AIR_DRAG;
      vz *= AIR_DRAG;
    }

    // Keep launches inside the arena walls (teleports skip collision).
    nx = Math.max(-ARENA_CLAMP, Math.min(ARENA_CLAMP, nx));
    nz = Math.max(-ARENA_CLAMP, Math.min(ARENA_CLAMP, nz));

    Position.x[eid] = nx;
    Position.y[eid] = ny;
    Position.z[eid] = nz;

    const body = getPhysicsBody(eid);
    if (body) {
      body.setTranslation({ x: nx, y: ny, z: nz }, true);
    }

    // Settle check + timer.
    const grounded = ny <= GROUND_TOP_Y + GROUND_EPSILON;
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (grounded && speedSq < REST_SPEED * REST_SPEED) {
      vx = 0;
      vy = 0;
      vz = 0;
      KnockbackState.ticksRemaining[eid] = 0;
    } else if (KnockbackState.ticksRemaining[eid] > 0) {
      KnockbackState.ticksRemaining[eid] -= 1;
    }

    KnockbackState.vx[eid] = vx;
    KnockbackState.vy[eid] = vy;
    KnockbackState.vz[eid] = vz;
  }
}
