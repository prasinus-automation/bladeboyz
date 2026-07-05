import { Direction } from '../combat/directions';
import { registerWeapon, type WeaponConfig } from './WeaponConfig';

/**
 * Scythe — the reaper.
 *
 * Pure drama: enormous horizontal arcs that reward wide Left/Right sweeps
 * into crowds. The overhead hooks down like a claw. Awkward to stab with
 * (it's a farming tool held sideways). Solid knockback on the sweep —
 * targets get raked off their feet.
 */
export const scythe: WeaponConfig = {
  name: 'Scythe',

  damage: {
    [Direction.Left]: { head: 58, torso: 42, limb: 30 },
    [Direction.Right]: { head: 58, torso: 42, limb: 30 },
    [Direction.Overhead]: { head: 62, torso: 44, limb: 28 },
    [Direction.Stab]: { head: 20, torso: 15, limb: 10 },
  },

  windup: {
    [Direction.Left]: 24,
    [Direction.Right]: 24,
    [Direction.Overhead]: 28,
    [Direction.Stab]: 24,
  },

  release: {
    [Direction.Left]: 16,
    [Direction.Right]: 16,
    [Direction.Overhead]: 16,
    [Direction.Stab]: 10,
  },

  recovery: {
    [Direction.Left]: 38,
    [Direction.Right]: 38,
    [Direction.Overhead]: 44,
    [Direction.Stab]: 36,
  },

  comboRecovery: {
    [Direction.Left]: 26,
    [Direction.Right]: 26,
    [Direction.Overhead]: 32,
    [Direction.Stab]: 28,
  },

  parryWindow: 10,
  parryRecovery: 15,
  blockBreakStunTicks: 36,

  staminaCost: {
    attack: 20,
    block: 13,
    parry: 7,
  },

  turncap: {
    windup: 0.065,
    release: 0.025,
    recovery: 0.045,
    hitStun: 0.005,
  },

  // The blade sits perpendicular to the shaft tip — tracers follow the
  // model's blade line (see createScytheModel), expressed here along the
  // local +Y shaft with an X offset onto the blade.
  tracerPoints: [
    [0.15, 1.5, 0],
    [0.4, 1.45, 0],
    [0.65, 1.4, 0],
    [0.9, 1.35, 0],
  ],

  // Blade band sits at ~1.9-2.4m radius; anything closer is inside the hook.
  range: 2.4,

  blockStaminaDrain: 14,
  parryStunTicks: 65,
  hitStunTicks: 50,

  knockback: { force: 5.5, upward: 2.5 },
};

registerWeapon(scythe);
