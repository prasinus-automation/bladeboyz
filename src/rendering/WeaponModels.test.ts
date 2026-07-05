import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createMaceModel,
  createDaggerModel,
  createBattleaxeModel,
  createGroundPickupModel,
  weaponModelFactories,
} from './WeaponModels';

describe('createMaceModel', () => {
  it('returns group and tracer points', () => {
    const result = createMaceModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has 3 tracer points', () => {
    const { tracerPoints } = createMaceModel();
    expect(tracerPoints).toHaveLength(3);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createMaceModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('group has 2 children (handle, head)', () => {
    const { group } = createMaceModel();
    expect(group.children.length).toBe(2);
  });

  // ── #125: per-weapon viewmodel grip data ────────────────────
  it('supplies gripOffset and gripRotation per doc §4.3', () => {
    const result = createMaceModel();
    expect(result.gripOffset).toBeDefined();
    expect(result.gripRotation).toBeDefined();
    // Doc §4.3 starting values: (0,0,0), (Math.PI*0.75, 0, -0.15).
    // Pinned here so visual-tuning changes surface as test diffs.
    expect(result.gripOffset!.x).toBeCloseTo(0);
    expect(result.gripOffset!.y).toBeCloseTo(0);
    expect(result.gripOffset!.z).toBeCloseTo(0);
    expect(result.gripRotation!.x).toBeCloseTo(-Math.PI * 0.75);
    expect(result.gripRotation!.y).toBeCloseTo(0);
    expect(result.gripRotation!.z).toBeCloseTo(-0.15);
  });
});

describe('createDaggerModel', () => {
  it('returns group and tracer points', () => {
    const result = createDaggerModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has 2 tracer points', () => {
    const { tracerPoints } = createDaggerModel();
    expect(tracerPoints).toHaveLength(2);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createDaggerModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('group has 2 children (grip, blade)', () => {
    const { group } = createDaggerModel();
    expect(group.children.length).toBe(2);
  });

  // ── #125: per-weapon viewmodel grip data ────────────────────
  it('supplies gripOffset and gripRotation per doc §4.3', () => {
    const result = createDaggerModel();
    expect(result.gripOffset).toBeDefined();
    expect(result.gripRotation).toBeDefined();
    // Doc §4.3 starting values: (0,0,-0.02), (Math.PI*0.90, 0, 0).
    expect(result.gripOffset!.x).toBeCloseTo(0);
    expect(result.gripOffset!.y).toBeCloseTo(0);
    expect(result.gripOffset!.z).toBeCloseTo(-0.02);
    expect(result.gripRotation!.x).toBeCloseTo(-Math.PI * 0.9);
    expect(result.gripRotation!.y).toBeCloseTo(0);
    expect(result.gripRotation!.z).toBeCloseTo(0);
  });
});

describe('createBattleaxeModel', () => {
  it('returns group and tracer points', () => {
    const result = createBattleaxeModel();
    expect(result.group).toBeDefined();
    expect(result.tracerPoints).toBeDefined();
  });

  it('has 4 tracer points', () => {
    const { tracerPoints } = createBattleaxeModel();
    expect(tracerPoints).toHaveLength(4);
  });

  it('tracer points are ordered base to tip (increasing Y)', () => {
    const { tracerPoints } = createBattleaxeModel();
    for (let i = 1; i < tracerPoints.length; i++) {
      expect(tracerPoints[i].y).toBeGreaterThan(tracerPoints[i - 1].y);
    }
  });

  it('group has 2 children (handle, head)', () => {
    const { group } = createBattleaxeModel();
    expect(group.children.length).toBe(2);
  });

  // ── #125: per-weapon viewmodel grip data ────────────────────
  it('supplies gripOffset and gripRotation per doc §4.3', () => {
    const result = createBattleaxeModel();
    expect(result.gripOffset).toBeDefined();
    expect(result.gripRotation).toBeDefined();
    // Doc §4.3 starting values: (0,-0.05,0), (Math.PI*0.80, 0, 0.1).
    expect(result.gripOffset!.x).toBeCloseTo(0);
    expect(result.gripOffset!.y).toBeCloseTo(-0.05);
    expect(result.gripOffset!.z).toBeCloseTo(0);
    expect(result.gripRotation!.x).toBeCloseTo(-Math.PI * 0.8);
    expect(result.gripRotation!.y).toBeCloseTo(0);
    expect(result.gripRotation!.z).toBeCloseTo(0.1);
  });
});

describe('weaponModelFactories', () => {
  it('contains all 4 weapons', () => {
    expect(Object.keys(weaponModelFactories)).toEqual(
      expect.arrayContaining(['Longsword', 'Mace', 'Dagger', 'Battleaxe']),
    );
  });

  it('has one entry per weaponIdToName slot (10 as of the 2026-07 arsenal)', () => {
    expect(Object.keys(weaponModelFactories)).toHaveLength(10);
  });

  it('all factories return valid WeaponModelResult', () => {
    for (const [, factory] of Object.entries(weaponModelFactories)) {
      const result = factory();
      expect(result.group).toBeDefined();
      expect(result.tracerPoints).toBeDefined();
      expect(result.tracerPoints.length).toBeGreaterThan(0);
    }
  });
});

// ── #127: Ground pickup model + per-weapon orientation ──────

describe('createGroundPickupModel', () => {
  it.each(['Longsword', 'Mace', 'Dagger', 'Battleaxe'])(
    'returns { group, materials } for %s',
    (name) => {
      const { group, materials } = createGroundPickupModel(name);
      expect(group).toBeInstanceOf(THREE.Group);
      expect(Array.isArray(materials)).toBe(true);
      expect(materials.length).toBeGreaterThan(0);
    },
  );

  it.each(['Longsword', 'Mace', 'Dagger', 'Battleaxe'])(
    'cached materials are unique (no duplicates from shared instances) — %s',
    (name) => {
      const { materials } = createGroundPickupModel(name);
      expect(new Set(materials).size).toBe(materials.length);
    },
  );

  it('throws on unknown weapon name', () => {
    expect(() => createGroundPickupModel('NotARealWeapon')).toThrow(
      /NotARealWeapon/,
    );
  });

  it('Longsword lies flat on -π/2 X (default orientation)', () => {
    const { group } = createGroundPickupModel('Longsword');
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(group.rotation.y).toBeCloseTo(0);
    expect(group.rotation.z).toBeCloseTo(0);
  });

  it('Mace lies flat on -π/2 X (default orientation)', () => {
    const { group } = createGroundPickupModel('Mace');
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(group.rotation.z).toBeCloseTo(0);
  });

  it('Dagger lies flat on -π/2 X (default orientation)', () => {
    const { group } = createGroundPickupModel('Dagger');
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(group.rotation.z).toBeCloseTo(0);
  });

  it('Battleaxe gets an extra π/4 Z roll for its asymmetric head', () => {
    // Battleaxe head sits to one side of the haft — without the Z roll the
    // model balances on the haft edge instead of lying on the broad face.
    const { group } = createGroundPickupModel('Battleaxe');
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(group.rotation.z).toBeCloseTo(Math.PI / 4);
  });

  it('flips material.transparent = true at creation time (sticky for fade)', () => {
    // PickupRenderer relies on transparent staying true for the pickup's
    // life — it only mutates `opacity`. Avoids per-frame style recalcs from
    // toggling `transparent` on/off.
    const { materials } = createGroundPickupModel('Mace');
    for (const m of materials) {
      expect(m.transparent).toBe(true);
    }
  });

  it('initial opacity is 1.0 (fade ramp starts from full visibility)', () => {
    const { materials } = createGroundPickupModel('Mace');
    for (const m of materials) {
      expect(m.opacity).toBeCloseTo(1);
    }
  });

  it('subsequent calls return DISTINCT material instances (no cross-pickup leak)', () => {
    // If two pickups shared a material reference, fading one would fade the
    // other. The factories allocate fresh `MeshStandardMaterial` per call,
    // so cached arrays must not overlap.
    const a = createGroundPickupModel('Mace');
    const b = createGroundPickupModel('Mace');
    for (const ma of a.materials) {
      for (const mb of b.materials) {
        expect(ma).not.toBe(mb);
      }
    }
  });
});
