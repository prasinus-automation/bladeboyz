/**
 * Combat FSM state identifiers.
 * Using const enum for zero-cost abstraction — values inline at compile time.
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

/**
 * Attack directions — determines damage lookup and tracer sweep angle.
 */
export const enum AttackDirection {
  None = 0,
  Left = 1,
  Right = 2,
  Overhead = 3,
  Underhand = 4,
  Stab = 5,
}

/**
 * Block directions — must match attacker's direction to succeed.
 */
export const enum BlockDirection {
  None = 0,
  Left = 1,
  Right = 2,
  Up = 3,
  Down = 4,
}

/**
 * Body regions for hitbox identification.
 */
export const enum BodyRegion {
  Head = 0,
  Torso = 1,
  LeftArm = 2,
  RightArm = 3,
  LeftLeg = 4,
  RightLeg = 5,
}
