/**
 * Combat state enum for the per-entity combat FSM.
 *
 * Each combatant has exactly one active combat state at a time.
 * State transitions are data-driven from weapon config timing values.
 *
 * All timing is expressed in fixed-update ticks (1 tick = 1/60th second).
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
 * Human-readable labels for combat states.
 * Indexed by CombatState numeric value.
 */
export const COMBAT_STATE_NAMES: Record<number, string> = {
  0: 'Idle',
  1: 'Windup',
  2: 'Release',
  3: 'Recovery',
  4: 'Block',
  5: 'ParryWindow',
  6: 'Riposte',
  7: 'Feint',
  8: 'Clash',
  9: 'Stunned',
  10: 'HitStun',
};

/** Default stun duration when block breaks from stamina depletion (ticks) */
export const BLOCK_BREAK_STUN_TICKS = 30;
