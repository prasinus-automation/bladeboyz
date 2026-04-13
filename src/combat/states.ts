/**
 * Combat FSM state identifiers.
 * Using const enum for zero-cost abstraction — values inline at compile time.
 *
 * Note: AttackDirection and BlockDirection live in ./directions.ts
 * BodyRegion lives in ../ecs/components.ts
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
