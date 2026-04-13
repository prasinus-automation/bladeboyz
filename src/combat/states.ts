/** All combat FSM states */
export const enum CombatStateEnum {
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

/** Human-readable state names for debug display */
export const COMBAT_STATE_NAMES: Record<number, string> = {
  [0 /* Idle */]: 'Idle',
  [1 /* Windup */]: 'Windup',
  [2 /* Release */]: 'Release',
  [3 /* Recovery */]: 'Recovery',
  [4 /* Block */]: 'Block',
  [5 /* ParryWindow */]: 'ParryWindow',
  [6 /* Riposte */]: 'Riposte',
  [7 /* Feint */]: 'Feint',
  [8 /* Clash */]: 'Clash',
  [9 /* Stunned */]: 'Stunned',
  [10 /* HitStun */]: 'HitStun',
};

/** Inputs that can trigger state transitions */
export const enum CombatInput {
  /** Left mouse / attack button pressed */
  AttackStart = 0,
  /** Right mouse / block button pressed */
  BlockStart = 1,
  /** Block button released */
  BlockEnd = 2,
  /** Feint input (right-click during windup) */
  FeintInput = 3,
  /** External event: this entity was hit while not correctly blocking */
  HitReceived = 4,
  /** External event: this entity's block was matched to incoming attack direction */
  BlockHitReceived = 5,
  /** External event: parry triggered (hit during ParryWindow) */
  ParryTriggered = 6,
  /** External event: attack hit a target during Release */
  AttackLanded = 7,
  /** External event: two releases clash */
  ClashTriggered = 8,
}
