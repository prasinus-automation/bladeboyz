/**
 * Combat FSM state identifiers.
 * Using const enum for zero-cost abstraction — values inline at compile time.
 *
 * Note: AttackDirection and BlockDirection live in ./directions.ts
 * BodyRegion lives in ../ecs/components.ts
 *
 * The AnimationSystem reads these states to drive procedural animations.
 * All timing is in **ticks** (1 tick = 1/60th second at 60Hz fixed update).
 */
export const enum CombatState {
  Idle = 0,
  Windup = 1,
  Release = 2,
  Recovery = 3,
  Block = 4,
  ParryWindow = 5,
  Riposte = 6,
  Feint = 7,
  Clash = 8,
  Stunned = 9,
  HitStun = 10,
}

// ── Movement States ──────────────────────────────────────

export const enum MovementState {
  Idle = 0,
  Walking = 1,
  Running = 2,
  Jumping = 3,
  Crouching = 4,
}
