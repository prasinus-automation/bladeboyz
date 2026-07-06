/** Minimal structural 3-vector — assignable from `THREE.Vector3` and plain
 * `{x,y,z}` objects. Kept THREE-free so this module has no `three` import and
 * can be bundled into the headless server (which must stay Three.js-free). */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Yaw (radians, around world +Y) that makes an entity at `(fromX, fromZ)` FACE
 * the point `(toX, toZ)` — defaulting to the arena origin `(0, 0)`.
 *
 * Project convention: forward = `(-sin yaw, -cos yaw)`, so yaw=0 looks down -Z.
 * To align forward with the direction `(toX-fromX, toZ-fromZ)` you solve
 * `-sin yaw = toX-fromX`, `-cos yaw = toZ-fromZ`, giving
 * `yaw = atan2(fromX-toX, fromZ-toZ)`.
 *
 * ⚠️ Do NOT inline `Math.atan2(-x, -z)` as "face the origin" — that is exactly
 * π off under this convention (it faces AWAY from the target). This is the bug
 * fixed in #211/#212; always route through this helper.
 *
 * A degenerate call where `from == to` returns 0 (atan2(0,0) === 0 in JS).
 */
export function yawTowards(
  fromX: number,
  fromZ: number,
  toX = 0,
  toZ = 0,
): number {
  return Math.atan2(fromX - toX, fromZ - toZ);
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Shortest-path angle interpolation.
 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Lerp for Vector3 (structural — accepts any `{x,y,z}`, incl. THREE.Vector3) */
export function lerpVec3<T extends Vec3>(out: T, a: Vec3, b: Vec3, t: number): T {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}
