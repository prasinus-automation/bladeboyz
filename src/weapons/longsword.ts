import * as THREE from 'three';
import type { WeaponConfig } from './WeaponConfig';
import { createLongswordModel } from '../rendering/CharacterModel';

const { tracerPoints } = createLongswordModel();

export const longsword: WeaponConfig = {
  name: 'Longsword',
  damage: {
    head: 60,
    torso: 40,
    arms: 25,
    legs: 25,
  },
  windup: 20, // ~333ms
  release: 12, // ~200ms
  recovery: 18, // ~300ms
  staminaCost: 20,
  tracerPoints,
  reach: 1.2,
};
