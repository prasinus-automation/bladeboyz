import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Longsword — the baseline weapon.
 * All timing in ticks (60Hz). Turncaps in rad/tick.
 */
export const longsword: WeaponConfig = {
  name: 'Longsword',
  id: 1,

  // Timing
  windupTicks: 8,          // ~133ms
  releaseTicks: 6,         // ~100ms
  recoveryTicks: 12,       // ~200ms
  comboRecoveryTicks: 6,   // ~100ms — faster followup
  riposteWindupTicks: 4,   // ~67ms — quick riposte
  feintRecoveryTicks: 10,  // ~167ms — penalty for feinting
  parryWindowTicks: 6,     // ~100ms — tight parry window
  hitStunTicks: 20,        // ~333ms — universal stunlock window
  clashTicks: 15,          // ~250ms

  // Turncaps (rad/tick at 60Hz)
  turncapIdle: 999,        // Effectively unrestricted
  turncapWindup: 0.06,     // ~3.6 rad/s — loose
  turncapRelease: 0.033,   // ~2.0 rad/s — tight drag
  turncapRecovery: 0.05,   // ~3.0 rad/s
  turncapBlock: 0.05,      // ~3.0 rad/s
  turncapFeint: 0.04,      // ~2.4 rad/s

  // Damage & Stamina
  damage: 35,
  staminaCostAttack: 15,
  staminaCostFeint: 20,    // Feinting is costly
  staminaDrainBlock: 25,
};

// Auto-register on import
registerWeapon(longsword);
