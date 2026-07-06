import * as THREE from 'three';
import {
  createLongswordModel,
  WEAPON_ATTACH_BASE_POSITION,
  WEAPON_ATTACH_BASE_ROTATION,
  type WeaponModelResult,
} from './CharacterModel';

export type { WeaponModelResult } from './CharacterModel';

/**
 * Factory that builds a fresh procedural weapon model.
 *
 * **Cache contract (#125, #173)**: the returned `WeaponModelResult.group`
 * MUST NOT be mutated after the factory returns. `ViewmodelRenderer` calls
 * each registered factory exactly once at construction time, stashes the
 * result in a pre-warmed cache, and applies render layer `VIEWMODEL_LAYER`
 * (Layer 1) recursively to every descendant at that moment. Any `Object3D`
 * added to the group AFTER the factory returns inherits Layer 0 by default
 * — the world camera would then draw it as part of the world pass, where
 * it z-fights with everything and is pierced by walls (the very symptom
 * #171 was investigating).
 *
 * `ViewmodelRenderer.swapWeapon` defensively re-applies the layer on every
 * swap to close this hazard (see #173 layer-leak guard), but that is a
 * belt-and-braces measure — factories should still obey the contract.
 *
 * If a weapon needs runtime children (FX, status indicators, debug
 * helpers), build them once inside the factory and toggle `.visible` from
 * the consumer. Do NOT lazily `group.add(...)` from animation/render code.
 *
 * Materials must also be allocated fresh per factory call: `PickupRenderer`
 * mutates `opacity` on the collected materials, and shared instances would
 * leak fade state across active pickups. See `createGroundPickupModel`.
 */
export type WeaponModelFactory = () => WeaponModelResult;

// ── Mace Model ──────────────────────────────────────────────

/**
 * Create a procedural mace model.
 * Cylinder handle + sphere head.
 */
export function createMaceModel(): WeaponModelResult {
  const group = new THREE.Group();

  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    flatShading: true,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x777777,
    flatShading: true,
  });

  // Handle (cylinder)
  const HANDLE_RADIUS = 0.025;
  const HANDLE_LEN = 0.4;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, HANDLE_LEN, 6),
    handleMat,
  );
  handle.position.set(0, HANDLE_LEN / 2, 0);
  group.add(handle);

  // Mace head (sphere)
  const HEAD_RADIUS = 0.08;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_RADIUS, 6, 4),
    headMat,
  );
  head.position.set(0, HANDLE_LEN + HEAD_RADIUS, 0);
  group.add(head);

  // Tracer points on the head (3 points: bottom, center, top)
  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, HANDLE_LEN, 0),                        // bottom of head
    new THREE.Vector3(0, HANDLE_LEN + HEAD_RADIUS, 0),          // center of head
    new THREE.Vector3(0, HANDLE_LEN + HEAD_RADIUS * 2, 0),      // top of head
  ];

  // Viewmodel grip data (#125, doc §4.3). Head angled up-forward to
  // emphasize the heavy mace head; small Z-axis lean reads as off-axis grip.
  const gripOffset = new THREE.Vector3(0, 0, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.75, 0, -0.15);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Dagger Model ────────────────────────────────────────────

/**
 * Create a procedural dagger model.
 * Small grip + short blade.
 */
export function createDaggerModel(): WeaponModelResult {
  const group = new THREE.Group();

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x654321,
    flatShading: true,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xbbbbbb,
    flatShading: true,
  });

  // Grip (cylinder)
  const GRIP_RADIUS = 0.018;
  const GRIP_LEN = 0.1;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LEN, 6),
    gripMat,
  );
  grip.position.set(0, GRIP_LEN / 2, 0);
  group.add(grip);

  // Blade (short, narrow box)
  const BLADE_W = 0.03;
  const BLADE_H = 0.2;
  const BLADE_D = 0.01;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D),
    bladeMat,
  );
  blade.position.set(0, GRIP_LEN + BLADE_H / 2, 0);
  group.add(blade);

  // Tracer points along the blade (2 points: base and tip)
  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, GRIP_LEN + 0.03, 0),           // blade base
    new THREE.Vector3(0, GRIP_LEN + BLADE_H - 0.02, 0), // blade tip
  ];

  // Viewmodel grip data (#125, doc §4.3). Tighter grip pulled slightly
  // toward the camera (Z negative), blade tilted further forward — sells
  // the small/quick feel. A reverse-grip variant could rotate ~π on Z.
  const gripOffset = new THREE.Vector3(0, 0, -0.02);
  const gripRotation = new THREE.Euler(-Math.PI * 0.9, 0, 0);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Battleaxe Model ─────────────────────────────────────────

/**
 * Create a procedural battleaxe model.
 * Long cylinder handle + large box axe head.
 */
export function createBattleaxeModel(): WeaponModelResult {
  const group = new THREE.Group();

  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    flatShading: true,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    flatShading: true,
  });

  // Long handle (cylinder)
  const HANDLE_RADIUS = 0.025;
  const HANDLE_LEN = 0.8;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, HANDLE_LEN, 6),
    handleMat,
  );
  handle.position.set(0, HANDLE_LEN / 2, 0);
  group.add(handle);

  // Axe head (wide, flat box offset to one side)
  const HEAD_W = 0.25;
  const HEAD_H = 0.3;
  const HEAD_D = 0.04;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    headMat,
  );
  head.position.set(HEAD_W / 2 - 0.02, HANDLE_LEN + HEAD_H / 2 - 0.05, 0);
  group.add(head);

  // Tracer points on the axe head (4 points, evenly spaced base to top)
  const headBase = HANDLE_LEN - 0.05;
  const tracerPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3; // 0, 1/3, 2/3, 1
    tracerPoints.push(new THREE.Vector3(0, headBase + t * HEAD_H, 0));
  }

  // Viewmodel grip data (#125, doc §4.3). Head heavy + angled
  // down-sideways — Y-offset pulls the model down toward the hand bottom
  // (long handle), small +Z rotation tilts the head. Sells the weight.
  const gripOffset = new THREE.Vector3(0, -0.05, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.8, 0, 0.1);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Zweihander Model ────────────────────────────────────────

/**
 * Colossal two-handed sword: extra-long grip, wide crossguard, 1.9m blade.
 */
export function createZweihanderModel(): WeaponModelResult {
  const group = new THREE.Group();

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8e0, flatShading: true });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x44403a, flatShading: true });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, flatShading: true });

  const GRIP_LEN = 0.35;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, GRIP_LEN, 6),
    gripMat,
  );
  grip.position.set(0, GRIP_LEN / 2, 0);
  group.add(grip);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.04), guardMat);
  guard.position.set(0, GRIP_LEN + 0.02, 0);
  group.add(guard);

  const BLADE_H = 1.55;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, BLADE_H, 0.02), bladeMat);
  blade.position.set(0, GRIP_LEN + 0.04 + BLADE_H / 2, 0);
  group.add(blade);

  const tracerPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    tracerPoints.push(new THREE.Vector3(0, GRIP_LEN + 0.04 + (i / 4) * BLADE_H, 0));
  }

  const gripOffset = new THREE.Vector3(0, -0.03, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.85, 0, 0);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Warhammer Model ─────────────────────────────────────────

/**
 * Thick haft + massive rectangular head with a striking face and a spike.
 */
export function createWarhammerModel(): WeaponModelResult {
  const group = new THREE.Group();

  const handleMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x3f4045, flatShading: true });

  const HANDLE_LEN = 0.65;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, HANDLE_LEN, 6),
    handleMat,
  );
  handle.position.set(0, HANDLE_LEN / 2, 0);
  group.add(handle);

  // Blocky head — deliberately oversized so the silhouette screams "launcher".
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), headMat);
  head.position.set(0, HANDLE_LEN + 0.1, 0);
  group.add(head);

  // Back spike (small pyramid via cone with 4 segments).
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), headMat);
  spike.rotation.z = Math.PI / 2;
  spike.position.set(-0.25, HANDLE_LEN + 0.1, 0);
  group.add(spike);

  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, HANDLE_LEN - 0.1, 0),
    new THREE.Vector3(0, HANDLE_LEN + 0.05, 0),
    new THREE.Vector3(0, HANDLE_LEN + 0.2, 0),
  ];

  const gripOffset = new THREE.Vector3(0, -0.04, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.78, 0, 0.05);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Spear Model ─────────────────────────────────────────────

/**
 * Very long thin shaft + leaf-blade tip.
 */
export function createSpearModel(): WeaponModelResult {
  const group = new THREE.Group();

  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, flatShading: true });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xc8c8d0, flatShading: true });

  const SHAFT_LEN = 2.1;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, SHAFT_LEN, 6),
    shaftMat,
  );
  shaft.position.set(0, SHAFT_LEN / 2, 0);
  group.add(shaft);

  const TIP_LEN = 0.28;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, TIP_LEN, 4), tipMat);
  tip.position.set(0, SHAFT_LEN + TIP_LEN / 2, 0);
  group.add(tip);

  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, 1.2, 0),
    new THREE.Vector3(0, 1.6, 0),
    new THREE.Vector3(0, 2.0, 0),
    new THREE.Vector3(0, SHAFT_LEN + TIP_LEN, 0),
  ];

  // Gripped low so most of the shaft projects forward.
  const gripOffset = new THREE.Vector3(0, -0.02, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.88, 0, 0);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Katana Model ────────────────────────────────────────────

/**
 * Slim single-edged blade, disc guard, wrapped grip.
 */
export function createKatanaModel(): WeaponModelResult {
  const group = new THREE.Group();

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8f0, flatShading: true });
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x22201c, flatShading: true });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x223355, flatShading: true });

  const GRIP_LEN = 0.24;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, GRIP_LEN, 6),
    gripMat,
  );
  grip.position.set(0, GRIP_LEN / 2, 0);
  group.add(grip);

  // Tsuba — thin disc.
  const guard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.012, 8),
    guardMat,
  );
  guard.position.set(0, GRIP_LEN + 0.006, 0);
  group.add(guard);

  // Blade — narrow, slightly angled back for the curved silhouette.
  const BLADE_H = 0.95;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, BLADE_H, 0.01), bladeMat);
  blade.position.set(0.02, GRIP_LEN + 0.01 + BLADE_H / 2, 0);
  blade.rotation.z = -0.05;
  group.add(blade);

  const tracerPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    tracerPoints.push(
      new THREE.Vector3(0.02 + i * 0.012, GRIP_LEN + 0.05 + (i / 3) * (BLADE_H - 0.1), 0),
    );
  }

  const gripOffset = new THREE.Vector3(0, 0, -0.01);
  const gripRotation = new THREE.Euler(-Math.PI * 0.87, 0, -0.05);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Scythe Model ────────────────────────────────────────────

/**
 * Long shaft with a perpendicular curved blade — the reaper silhouette.
 * Blade is approximated with two angled boxes.
 */
export function createScytheModel(): WeaponModelResult {
  const group = new THREE.Group();

  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, flatShading: true });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb0b8c0, flatShading: true });

  const SHAFT_LEN = 1.5;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, SHAFT_LEN, 6),
    shaftMat,
  );
  shaft.position.set(0, SHAFT_LEN / 2, 0);
  group.add(shaft);

  // Main blade segment — juts out perpendicular at the shaft tip.
  const blade1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.015), bladeMat);
  blade1.position.set(0.28, SHAFT_LEN - 0.03, 0);
  group.add(blade1);

  // Curved tip segment — angled down from the main blade's end.
  const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.013), bladeMat);
  blade2.position.set(0.68, SHAFT_LEN - 0.14, 0);
  blade2.rotation.z = -0.5;
  group.add(blade2);

  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0.15, SHAFT_LEN, 0),
    new THREE.Vector3(0.4, SHAFT_LEN - 0.05, 0),
    new THREE.Vector3(0.65, SHAFT_LEN - 0.1, 0),
    new THREE.Vector3(0.9, SHAFT_LEN - 0.15, 0),
  ];

  const gripOffset = new THREE.Vector3(0, -0.05, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.8, 0, 0.15);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Yeeter Model ────────────────────────────────────────────

/**
 * An entire tree trunk. Bark, stump rings, absurd girth. The most
 * important weapon in the game.
 */
export function createYeeterModel(): WeaponModelResult {
  const group = new THREE.Group();

  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, flatShading: true });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc9a86a, flatShading: true });

  // Grip end — narrower so a human hand can theoretically hold it.
  const NECK_LEN = 0.35;
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.04, NECK_LEN, 7),
    barkMat,
  );
  neck.position.set(0, NECK_LEN / 2, 0);
  group.add(neck);

  // The trunk proper.
  const TRUNK_LEN = 1.75;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.09, TRUNK_LEN, 7),
    barkMat,
  );
  trunk.position.set(0, NECK_LEN + TRUNK_LEN / 2, 0);
  group.add(trunk);

  // Stump face — pale growth-ring disc on the business end.
  const rings = new THREE.Mesh(
    new THREE.CylinderGeometry(0.155, 0.155, 0.02, 7),
    ringMat,
  );
  rings.position.set(0, NECK_LEN + TRUNK_LEN + 0.01, 0);
  group.add(rings);

  // A stub branch, for character.
  const branch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 0.3, 5),
    barkMat,
  );
  branch.rotation.z = Math.PI / 2.5;
  branch.position.set(0.2, NECK_LEN + TRUNK_LEN * 0.6, 0);
  group.add(branch);

  const tracerPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    tracerPoints.push(new THREE.Vector3(0, 0.4 + (i / 4) * 1.6, 0));
  }

  const gripOffset = new THREE.Vector3(0, -0.06, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.8, 0, 0.12);

  return { group, tracerPoints, gripOffset, gripRotation };
}


// ── Rapier Model ────────────────────────────────────────────

/**
 * Create a procedural rapier model — thin grip, swept-hilt guard sphere,
 * long needle blade. The blade is deliberately the thinnest in the
 * arsenal; the silhouette IS the fantasy.
 */
export function createRapierModel(): WeaponModelResult {
  const group = new THREE.Group();

  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x4a3520,
    flatShading: true,
  });
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0xc0a850,
    flatShading: true,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xd8d8e0,
    flatShading: true,
  });

  // Grip (thin cylinder)
  const GRIP_RADIUS = 0.015;
  const GRIP_LEN = 0.12;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LEN, 6),
    gripMat,
  );
  grip.position.set(0, GRIP_LEN / 2, 0);
  group.add(grip);

  // Swept-hilt guard (small sphere shell around the hand)
  const GUARD_RADIUS = 0.05;
  const guard = new THREE.Mesh(
    new THREE.SphereGeometry(GUARD_RADIUS, 6, 4),
    guardMat,
  );
  guard.position.set(0, GRIP_LEN + 0.02, 0);
  group.add(guard);

  // Needle blade (long, very thin box)
  const BLADE_W = 0.015;
  const BLADE_H = 1.35;
  const BLADE_D = 0.008;
  const BLADE_BASE = 0.17;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D),
    bladeMat,
  );
  blade.position.set(0, BLADE_BASE + BLADE_H / 2, 0);
  group.add(blade);

  // Tracer points along the blade (base → tip; tip = 0.17 + 1.35 = 1.52)
  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, 0.2, 0),
    new THREE.Vector3(0, 0.65, 0),
    new THREE.Vector3(0, 1.1, 0),
    new THREE.Vector3(0, 1.52, 0),
  ];

  // Viewmodel grip data (#125, doc §4.3). Held point-forward and low —
  // a fencing guard, not a shoulder carry.
  const gripOffset = new THREE.Vector3(0, 0, -0.01);
  const gripRotation = new THREE.Euler(-Math.PI * 0.88, 0, 0.05);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Halberd Model ───────────────────────────────────────────

/**
 * Create a procedural halberd model — long shaft, offset axe blade near
 * the top, and a thrusting spike above it. Asymmetric like the battleaxe,
 * so the ground pickup gets a Z roll (see PICKUP_ORIENTATIONS).
 */
export function createHalberdModel(): WeaponModelResult {
  const group = new THREE.Group();

  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x6b4a2b,
    flatShading: true,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x8a8f94,
    flatShading: true,
  });

  // Shaft (long cylinder)
  const SHAFT_RADIUS = 0.022;
  const SHAFT_LEN = 2.0;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LEN, 6),
    shaftMat,
  );
  shaft.position.set(0, SHAFT_LEN / 2, 0);
  group.add(shaft);

  // Axe blade (flat box, offset to +X like the battleaxe head)
  const BLADE_W = 0.22;
  const BLADE_H = 0.3;
  const BLADE_D = 0.015;
  const BLADE_CENTER_Y = 1.7;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D),
    headMat,
  );
  blade.position.set(0.13, BLADE_CENTER_Y, 0);
  group.add(blade);

  // Top spike (cone) — 2.0 base to 2.15 apex; the thrust point.
  const SPIKE_H = 0.15;
  const spike = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, SPIKE_H, 6),
    headMat,
  );
  spike.position.set(0, SHAFT_LEN + SPIKE_H / 2, 0);
  group.add(spike);

  // Tracer points: upper shaft → axe blade leading edge (x-offset) →
  // spike apex. Mirrored exactly by the Halberd weapon config
  // (TracerVisualParity.test).
  const tracerPoints: THREE.Vector3[] = [
    new THREE.Vector3(0, 1.45, 0),
    new THREE.Vector3(0.16, 1.62, 0),
    new THREE.Vector3(0.16, 1.78, 0),
    new THREE.Vector3(0, 1.95, 0),
    new THREE.Vector3(0, 2.15, 0),
  ];

  // Viewmodel grip data (#125, doc §4.3). Gripped low on the shaft with
  // the head far forward — reads as a two-handed polearm carry.
  const gripOffset = new THREE.Vector3(0, -0.1, 0);
  const gripRotation = new THREE.Euler(-Math.PI * 0.82, 0, 0.08);

  return { group, tracerPoints, gripOffset, gripRotation };
}

// ── Weapon Model Factory Registry ───────────────────────────

/**
 * Registry mapping weapon names to their procedural model factories.
 * Used by entity creation to attach the correct model for each weapon.
 *
 * See `WeaponModelFactory` for the post-cache immutability contract that
 * every factory in this registry must obey (the layer-leak hazard from
 * #171 / #173).
 */
export const weaponModelFactories: Record<string, WeaponModelFactory> = {
  'Longsword': createLongswordModel,
  'Mace': createMaceModel,
  'Dagger': createDaggerModel,
  'Battleaxe': createBattleaxeModel,
  'Zweihander': createZweihanderModel,
  'Warhammer': createWarhammerModel,
  'Spear': createSpearModel,
  'Katana': createKatanaModel,
  'Scythe': createScytheModel,
  'Yeeter': createYeeterModel,
  'Rapier': createRapierModel,
  'Halberd': createHalberdModel,
};

// ── Third-Person Grip ───────────────────────────────────────

/**
 * Per-weapon third-person grip transform, composed ONTO the `weapon_attach`
 * bone's rest transform (see `WEAPON_ATTACH_BASE_*` in CharacterModel.ts).
 *
 * **Why a separate map from the viewmodel `gripOffset`/`gripRotation` (#125):**
 * the viewmodel grips were tuned in *camera space* for the first-person rig
 * (which anchors `vm_weapon_attach` at the camera with `ARM_OFFSET` and has
 * NO baked rotation). The third-person bone hangs off the animated body
 * skeleton and carries the baked `rotation.x = π`, so those values don't
 * transfer 1:1. This mirrors the precedent set by `PICKUP_ORIENTATIONS`
 * (#127), which likewise keeps a purpose-built third-person orientation map.
 *
 * **Tracer parity (the hard constraint, #220):** grip is applied to the BONE,
 * not to the weapon model group. `TracerSystem` sweeps `config.tracerPoints`
 * through `weapon_attach.matrixWorld`, and the visible mesh is a child of the
 * same bone — so composing grip on the bone moves the damage geometry and the
 * visible blade by the exact same transform. Damage always lands where the
 * blade visually passes. (Offsetting only the model group would desync them —
 * that is the bug this map must not introduce.) `ThirdPersonGripParity.test.ts`
 * pins this world-space coincidence.
 *
 * **Convention:** `rotation` is composed as a post-multiply in the weapon's
 * own local frame (rotate the weapon *within* the grip); `offset` is added in
 * bone-local space (relative to `hand_R`). Weapons absent from this map (or
 * with a zero grip) attach exactly as they did pre-#220 — the refactor is
 * behaviour-preserving for them.
 *
 * Post-#219 the handle already seats in the fist for every weapon (the model
 * and poses were corrected to -Z-forward). The grips below are conservative
 * orientation nudges that lift each blade out of the "resting back over the
 * shoulder" idle angle toward a readable held guard; the values are
 * intentionally modest so the arc-swing tuning (arcSwing.ts, BladeTimingParity)
 * is preserved.
 */
export interface ThirdPersonGrip {
  /** Extra rotation composed onto the baked bone rotation (weapon-local). */
  rotation?: THREE.Euler;
  /** Extra position offset in bone-local (hand_R) space. */
  offset?: THREE.Vector3;
}

const THIRD_PERSON_GRIPS: Record<string, ThirdPersonGrip> = {
  // Straight-bladed swords: a small forward pitch lifts the blade toward an
  // upright ready guard instead of resting back over the shoulder.
  Longsword: { rotation: new THREE.Euler(-0.22, 0, 0) },
  Zweihander: { rotation: new THREE.Euler(-0.18, 0, 0) },
  Katana: { rotation: new THREE.Euler(-0.2, 0, 0) },
  Rapier: { rotation: new THREE.Euler(-0.2, 0, 0) },
  // Blunt / short weapons: tiny nudge only.
  Mace: { rotation: new THREE.Euler(-0.12, 0, 0) },
  Dagger: { rotation: new THREE.Euler(-0.18, 0, 0) },
  // Asymmetric-headed poles: a small shaft-axis (local Y) roll turns the
  // offset head to face outward. The tracer line is on the shaft axis for
  // these, so a pure Y roll leaves the damage geometry invariant while
  // reorienting the visible head — hit detection is untouched.
  Battleaxe: { rotation: new THREE.Euler(-0.12, 0.4, 0) },
  Warhammer: { rotation: new THREE.Euler(-0.1, 0.4, 0) },
  Halberd: { rotation: new THREE.Euler(-0.1, 0.4, 0) },
  // Long thrusting poles: leave orientation, small forward pitch for readability.
  Spear: { rotation: new THREE.Euler(-0.1, 0, 0) },
  // Yeeter (tree trunk) and Scythe read fine on the baked rest orientation;
  // Scythe's off-axis blade tracers make any roll a hit-geometry change, so
  // it stays identity by design.
};

const _gripQuat = new THREE.Quaternion();
const _baseQuat = new THREE.Quaternion();

/**
 * Attach a weapon model to a third-person character's `weapon_attach` bone,
 * applying the per-weapon third-person grip.
 *
 * This is the SINGLE attach path shared by every third-person combatant
 * (player, warmup bot, training dummy, remote players, AND live weapon swaps
 * via `InventorySystem.equipWeapon` — pickups, shop purchases, respawns,
 * UI-equip) so grip logic can't drift across call sites. It:
 *   1. clears any currently-attached weapon model from the bone,
 *   2. resets the bone to its baked rest transform (idempotent — safe to call
 *      again on a weapon swap),
 *   3. composes the weapon's `ThirdPersonGrip` onto that base,
 *   4. builds a fresh model via the registered factory and parents it to the
 *      bone.
 *
 * Grip on the bone (not the model group) keeps tracers and the visible blade
 * in lockstep — see `THIRD_PERSON_GRIPS` for the parity rationale.
 *
 * If `weaponName` has no registered factory the bone is left completely
 * untouched (existing model + transform preserved) and `null` is returned —
 * we never strip the old weapon or leave the bone rotated-but-empty. Callers
 * only pass names validated against `weaponConfigs`, and every canonical
 * weapon has a factory, so this guard is defence-in-depth against a typo in
 * `THIRD_PERSON_GRIPS`.
 *
 * @returns the attached `WeaponModelResult`, or `null` if `weaponName` has no
 *          registered factory (caller decides how to handle).
 */
export function attachThirdPersonWeapon(
  weaponAttachBone: THREE.Object3D,
  weaponName: string,
): WeaponModelResult | null {
  const factory = weaponModelFactories[weaponName];
  if (!factory) return null;

  // Remove any previously-attached weapon model so swaps don't stack models.
  while (weaponAttachBone.children.length > 0) {
    weaponAttachBone.remove(weaponAttachBone.children[0]);
  }

  // Reset to the baked rest transform so repeated calls (swaps) don't
  // accumulate grip.
  weaponAttachBone.position.copy(WEAPON_ATTACH_BASE_POSITION);
  weaponAttachBone.rotation.copy(WEAPON_ATTACH_BASE_ROTATION);

  const grip = THIRD_PERSON_GRIPS[weaponName];
  if (grip?.rotation) {
    _baseQuat.setFromEuler(weaponAttachBone.rotation);
    _gripQuat.setFromEuler(grip.rotation);
    // Post-multiply: apply the grip in the weapon's local frame.
    weaponAttachBone.quaternion.copy(_baseQuat.multiply(_gripQuat));
  }
  if (grip?.offset) {
    weaponAttachBone.position.add(grip.offset);
  }

  const model = factory();
  weaponAttachBone.add(model.group);
  return model;
}

// ── Ground Pickup Model ─────────────────────────────────────

/**
 * Per-weapon "lying flat" orientation tweaks used by `createGroundPickupModel`.
 *
 * Default rotation is `x = -π/2` — rotates the upright weapon (long axis = +Y)
 * onto its side so the long axis points along world +Z and the flat side
 * faces the ground. Some weapons add an extra roll for visual readability:
 *
 * - **Longsword / Dagger / Mace**: blade/handle lies naturally on `-π/2 X`.
 *   (Mace _could_ take a small Z roll to keep the head from sitting awkwardly,
 *   but the spherical head is rotation-symmetric enough that the simple
 *   default reads fine — see architect note in PR #127.)
 * - **Battleaxe**: asymmetric (axe head offset to one side of the haft) —
 *   add `z = π/4` so the head rolls down and the axe lies on its broad
 *   face rather than balancing on the haft edge.
 */
const PICKUP_ORIENTATIONS: Record<string, { x: number; y: number; z: number }> = {
  'Longsword':  { x: -Math.PI / 2, y: 0, z: 0 },
  'Mace':       { x: -Math.PI / 2, y: 0, z: 0 },
  'Dagger':     { x: -Math.PI / 2, y: 0, z: 0 },
  'Battleaxe':  { x: -Math.PI / 2, y: 0, z: Math.PI / 4 },
  // Warhammer's box head is offset like the battleaxe — roll onto its face.
  'Warhammer':  { x: -Math.PI / 2, y: 0, z: Math.PI / 4 },
  // Scythe's perpendicular blade — roll so the blade lies flat, not standing.
  'Scythe':     { x: -Math.PI / 2, y: 0, z: Math.PI / 2 },
  // Halberd's offset axe head — roll onto its broad face like the battleaxe.
  'Halberd':    { x: -Math.PI / 2, y: 0, z: Math.PI / 4 },
  // Zweihander / Spear / Katana / Yeeter lie naturally on the default roll.
};

const DEFAULT_PICKUP_ORIENTATION = { x: -Math.PI / 2, y: 0, z: 0 };

/**
 * Build the ground-pickup mesh for a weapon.
 *
 * Calls `weaponModelFactories[weaponName]()`, applies a per-weapon "lying flat"
 * rotation, and walks the group to collect a unique `THREE.Material[]` for
 * the rendering layer to use during blink/fade in the last 5s of life
 * (see `PickupRenderer`).
 *
 * **Material handling**: each factory in this module allocates fresh
 * `MeshStandardMaterial` instances per call, so opacity changes on one
 * pickup never leak across pickups. We also flip `material.transparent = true`
 * on every collected material here at creation time (idempotent — sticky for
 * the pickup's whole life). `PickupRenderer` only mutates `material.opacity`
 * thereafter, never `transparent`, per the renderer-state guidance in #127.
 *
 * Throws on unknown weapon name (no factory in `weaponModelFactories`).
 */
export function createGroundPickupModel(weaponName: string): {
  group: THREE.Group;
  materials: THREE.Material[];
} {
  const factory = weaponModelFactories[weaponName];
  if (!factory) {
    throw new Error(
      `createGroundPickupModel: unknown weapon "${weaponName}" — not in weaponModelFactories`,
    );
  }
  const { group } = factory();

  const orientation = PICKUP_ORIENTATIONS[weaponName] ?? DEFAULT_PICKUP_ORIENTATION;
  group.rotation.set(orientation.x, orientation.y, orientation.z);

  // Collect unique materials. Cache for blink/fade — avoids re-traversing
  // the group every frame in the hot path.
  const materials: THREE.Material[] = [];
  group.traverse((obj) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mat = (obj as any).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && !materials.includes(m)) materials.push(m);
      }
    } else if (!materials.includes(mat)) {
      materials.push(mat);
    }
  });

  // Flip `transparent = true` once at spawn so the renderer only ever has
  // to touch `opacity` — see PickupRenderer header for the rationale.
  for (const m of materials) {
    m.transparent = true;
  }

  return { group, materials };
}
