import { Euler, MathUtils, Quaternion } from 'three';

/**
 * Порядок поворотов объектов SA-MP. Все преобразования углов собраны здесь,
 * чтобы при расхождении с игрой поправить одно место.
 * Three.js 'ZXY' = матрица Rz * Rx * Ry.
 */
export const SAMP_EULER_ORDER = 'ZXY' as const;

export type Vec3 = [number, number, number];

export function sampToQuaternion(rot: Vec3): Quaternion {
  return new Quaternion().setFromEuler(
    new Euler(MathUtils.degToRad(rot[0]), MathUtils.degToRad(rot[1]), MathUtils.degToRad(rot[2]), SAMP_EULER_ORDER),
  );
}

export function quaternionToSamp(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, SAMP_EULER_ORDER);
  return [normDeg(MathUtils.radToDeg(e.x)), normDeg(MathUtils.radToDeg(e.y)), normDeg(MathUtils.radToDeg(e.z))];
}

/** Кватернион из IPL записан сопряжённым — переводим в обычный. */
export function iplQuaternion(q: [number, number, number, number]): Quaternion {
  return new Quaternion(-q[0], -q[1], -q[2], q[3]).normalize();
}

export function normDeg(a: number): number {
  let v = a % 360;
  if (v < 0) v += 360;
  if (Math.abs(v - 360) < 1e-6 || Math.abs(v) < 1e-6) v = 0;
  return v;
}
