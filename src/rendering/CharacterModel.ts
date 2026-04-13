import * as THREE from 'three';

/**
 * Procedural ultra-low-poly blocky humanoid character.
 *
 * BattleBit-style aesthetic: box head, rectangular torso, box limbs.
 * All meshes use flat-colored MeshStandardMaterial — no textures.
 * Total character height ≈ 1.8 units (meters).
 *
 * Skeleton bone hierarchy:
 *   root
 *   └─ spine
 *      └─ chest
 *         ├─ neck
 *         │  └─ head
 *         ├─ shoulder_L
 *         │  └─ upper_arm_L
 *         │     └─ forearm_L
 *         │        └─ hand_L
 *         ├─ shoulder_R
 *         │  └─ upper_arm_R
 *         │     └─ forearm_R
 *         │        └─ hand_R
 *         │           └─ weapon_attach
 *         └─ (from spine) thigh_L / thigh_R
 *            └─ shin_L / shin_R
 *               └─ foot_L / foot_R
 */

/* ─── Proportions (meters, character height ~1.8) ─── */
const HEAD_SIZE = 0.25;
const TORSO_W = 0.45;
const TORSO_H = 0.5;
const TORSO_D = 0.25;
const UPPER_ARM_LEN = 0.28;
const FOREARM_LEN = 0.26;
const HAND_SIZE = 0.1;
const LIMB_THICK = 0.12;
const THIGH_LEN = 0.4;
const SHIN_LEN = 0.38;
const FOOT_H = 0.08;
const FOOT_D = 0.2;
const NECK_LEN = 0.08;

export interface CharacterModelResult {
  group: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Record<string, THREE.Bone>;
}

/**
 * Create a procedural low-poly character model.
 * @param color Base body color (team-colorable). Default grey.
 */
export function createCharacterModel(
  color: number = 0x888888,
): CharacterModelResult {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xf5cba7,
    flatShading: true,
  });

  /* ─── Create bones ─── */
  const bones: Record<string, THREE.Bone> = {};

  function makeBone(name: string, parent?: THREE.Bone): THREE.Bone {
    const bone = new THREE.Bone();
    bone.name = name;
    if (parent) parent.add(bone);
    bones[name] = bone;
    return bone;
  }

  // Build hierarchy
  const root = makeBone('root');
  root.position.set(0, 0, 0); // ground level

  const spine = makeBone('spine', root);
  spine.position.set(0, THIGH_LEN + SHIN_LEN + FOOT_H, 0); // hip height

  const chest = makeBone('chest', spine);
  chest.position.set(0, TORSO_H * 0.5, 0);

  const neck = makeBone('neck', chest);
  neck.position.set(0, TORSO_H * 0.5, 0);

  const head = makeBone('head', neck);
  head.position.set(0, NECK_LEN, 0);

  // Left arm chain
  const shoulderL = makeBone('shoulder_L', chest);
  shoulderL.position.set(-(TORSO_W / 2 + LIMB_THICK / 2), TORSO_H * 0.45, 0);

  const upperArmL = makeBone('upper_arm_L', shoulderL);
  upperArmL.position.set(0, -UPPER_ARM_LEN / 2, 0);

  const forearmL = makeBone('forearm_L', upperArmL);
  forearmL.position.set(0, -UPPER_ARM_LEN / 2, 0);

  const handL = makeBone('hand_L', forearmL);
  handL.position.set(0, -FOREARM_LEN, 0);

  // Right arm chain
  const shoulderR = makeBone('shoulder_R', chest);
  shoulderR.position.set(TORSO_W / 2 + LIMB_THICK / 2, TORSO_H * 0.45, 0);

  const upperArmR = makeBone('upper_arm_R', shoulderR);
  upperArmR.position.set(0, -UPPER_ARM_LEN / 2, 0);

  const forearmR = makeBone('forearm_R', upperArmR);
  forearmR.position.set(0, -UPPER_ARM_LEN / 2, 0);

  const handR = makeBone('hand_R', forearmR);
  handR.position.set(0, -FOREARM_LEN, 0);

  // Weapon attach point on right hand
  const weaponAttach = makeBone('weapon_attach', handR);
  weaponAttach.position.set(0, -HAND_SIZE / 2, 0);

  // Left leg chain
  const thighL = makeBone('thigh_L', spine);
  thighL.position.set(-0.1, 0, 0);

  const shinL = makeBone('shin_L', thighL);
  shinL.position.set(0, -THIGH_LEN, 0);

  const footL = makeBone('foot_L', shinL);
  footL.position.set(0, -SHIN_LEN, 0);

  // Right leg chain
  const thighR = makeBone('thigh_R', spine);
  thighR.position.set(0.1, 0, 0);

  const shinR = makeBone('shin_R', thighR);
  shinR.position.set(0, -THIGH_LEN, 0);

  const footR = makeBone('foot_R', shinR);
  footR.position.set(0, -SHIN_LEN, 0);

  /* ─── Create visual meshes as SkinnedMeshes ─── */

  // Collect all bones for skeleton
  const boneList = Object.values(bones);
  const skeleton = new THREE.Skeleton(boneList);

  // Helper: create a SkinnedMesh bound to a single bone
  function createPart(
    geom: THREE.BufferGeometry,
    material: THREE.Material,
    bone: THREE.Bone,
    offset: THREE.Vector3,
  ): THREE.SkinnedMesh {
    const mesh = new THREE.SkinnedMesh(geom, material);

    // Set position vertices relative to bone
    const posAttr = geom.getAttribute('position');
    const count = posAttr.count;

    // Skinning: every vertex weighted 100% to this one bone
    const boneIndex = boneList.indexOf(bone);
    const skinIndices: number[] = [];
    const skinWeights: number[] = [];
    for (let i = 0; i < count; i++) {
      skinIndices.push(boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    geom.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(skinIndices, 4),
    );
    geom.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(skinWeights, 4),
    );

    // Translate geometry so bone is the pivot
    geom.translate(offset.x, offset.y, offset.z);

    mesh.add(root.clone(false)); // need a root bone in the mesh
    mesh.bind(skeleton);

    return mesh;
  }

  // Head
  const headMesh = createPart(
    new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE),
    skinMat,
    head,
    new THREE.Vector3(0, HEAD_SIZE / 2, 0),
  );
  group.add(headMesh);

  // Torso
  const torsoMesh = createPart(
    new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D),
    mat,
    chest,
    new THREE.Vector3(0, 0, 0),
  );
  group.add(torsoMesh);

  // Upper arms
  const upperArmGeom = () =>
    new THREE.BoxGeometry(LIMB_THICK, UPPER_ARM_LEN, LIMB_THICK);
  group.add(
    createPart(
      upperArmGeom(),
      mat,
      upperArmL,
      new THREE.Vector3(0, -UPPER_ARM_LEN / 2, 0),
    ),
  );
  group.add(
    createPart(
      upperArmGeom(),
      mat,
      upperArmR,
      new THREE.Vector3(0, -UPPER_ARM_LEN / 2, 0),
    ),
  );

  // Forearms
  const forearmGeom = () =>
    new THREE.BoxGeometry(LIMB_THICK * 0.9, FOREARM_LEN, LIMB_THICK * 0.9);
  group.add(
    createPart(
      forearmGeom(),
      skinMat,
      forearmL,
      new THREE.Vector3(0, -FOREARM_LEN / 2, 0),
    ),
  );
  group.add(
    createPart(
      forearmGeom(),
      skinMat,
      forearmR,
      new THREE.Vector3(0, -FOREARM_LEN / 2, 0),
    ),
  );

  // Hands
  const handGeom = () =>
    new THREE.BoxGeometry(HAND_SIZE, HAND_SIZE, HAND_SIZE);
  group.add(
    createPart(
      handGeom(),
      skinMat,
      handL,
      new THREE.Vector3(0, -HAND_SIZE / 2, 0),
    ),
  );
  group.add(
    createPart(
      handGeom(),
      skinMat,
      handR,
      new THREE.Vector3(0, -HAND_SIZE / 2, 0),
    ),
  );

  // Thighs
  const thighGeom = () =>
    new THREE.BoxGeometry(LIMB_THICK, THIGH_LEN, LIMB_THICK);
  group.add(
    createPart(
      thighGeom(),
      mat,
      thighL,
      new THREE.Vector3(0, -THIGH_LEN / 2, 0),
    ),
  );
  group.add(
    createPart(
      thighGeom(),
      mat,
      thighR,
      new THREE.Vector3(0, -THIGH_LEN / 2, 0),
    ),
  );

  // Shins
  const shinGeom = () =>
    new THREE.BoxGeometry(LIMB_THICK * 0.9, SHIN_LEN, LIMB_THICK * 0.9);
  group.add(
    createPart(
      shinGeom(),
      mat,
      shinL,
      new THREE.Vector3(0, -SHIN_LEN / 2, 0),
    ),
  );
  group.add(
    createPart(
      shinGeom(),
      mat,
      shinR,
      new THREE.Vector3(0, -SHIN_LEN / 2, 0),
    ),
  );

  // Feet
  const footGeom = () =>
    new THREE.BoxGeometry(LIMB_THICK, FOOT_H, FOOT_D);
  group.add(
    createPart(
      footGeom(),
      mat,
      footL,
      new THREE.Vector3(0, -FOOT_H / 2, FOOT_D * 0.2),
    ),
  );
  group.add(
    createPart(
      footGeom(),
      mat,
      footR,
      new THREE.Vector3(0, -FOOT_H / 2, FOOT_D * 0.2),
    ),
  );

  // Add the root bone to the group so skeleton transforms work
  group.add(root);

  return { group, skeleton, bones };
}

/* ─── Placeholder Longsword ─── */

export interface WeaponModelResult {
  group: THREE.Group;
  /** Tracer points in local space along the blade (base → tip) */
  tracerPoints: THREE.Vector3[];
}

/**
 * Create a simple longsword placeholder model.
 * Elongated box blade + small box crossguard + cylinder grip.
 */
export function createLongswordModel(): WeaponModelResult {
  const group = new THREE.Group();

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    flatShading: true,
  });
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0x555555,
    flatShading: true,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    flatShading: true,
  });

  // Grip (cylinder)
  const GRIP_RADIUS = 0.02;
  const GRIP_LEN = 0.2;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(GRIP_RADIUS, GRIP_RADIUS, GRIP_LEN, 6),
    gripMat,
  );
  grip.position.set(0, GRIP_LEN / 2, 0);
  group.add(grip);

  // Crossguard (box)
  const GUARD_W = 0.18;
  const GUARD_H = 0.03;
  const GUARD_D = 0.03;
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(GUARD_W, GUARD_H, GUARD_D),
    guardMat,
  );
  guard.position.set(0, GRIP_LEN + GUARD_H / 2, 0);
  group.add(guard);

  // Blade (elongated box)
  const BLADE_W = 0.05;
  const BLADE_H = 0.8;
  const BLADE_D = 0.015;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(BLADE_W, BLADE_H, BLADE_D),
    bladeMat,
  );
  blade.position.set(0, GRIP_LEN + GUARD_H + BLADE_H / 2, 0);
  group.add(blade);

  // Tracer points along the blade (4 evenly spaced, base to tip)
  const bladeBase = GRIP_LEN + GUARD_H;
  const tracerPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3; // 0, 1/3, 2/3, 1
    tracerPoints.push(new THREE.Vector3(0, bladeBase + t * BLADE_H, 0));
  }

  return { group, tracerPoints };
}
