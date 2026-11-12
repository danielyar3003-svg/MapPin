import type { Vec3 } from '../export/rotation';

export interface MapObject {
  uid: number;
  model: number;
  position: Vec3;
  /** Углы SA-MP в градусах. */
  rotation: Vec3;
  /** -1 — во всех мирах/интерьерах. */
  world: number;
  interior: number;
  /** Дистанция стрима/прорисовки (0 — по умолчанию). */
  drawDistance: number;
  comment?: string;
}

export type MapObjectData = Omit<MapObject, 'uid'>;

export function defaultObject(model: number, position: Vec3): MapObjectData {
  return { model, position, rotation: [0, 0, 0], world: -1, interior: -1, drawDistance: 0 };
}
