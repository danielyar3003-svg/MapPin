import type { MapObjectData } from './types';

export const PROJECT_FORMAT = 'mappin-project';

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: 1;
  objects: MapObjectData[];
}

export function serializeProject(objects: MapObjectData[]): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: 1,
    objects: objects.map(({ model, position, rotation, world, interior, drawDistance, comment }) => ({
      model, position, rotation, world, interior, drawDistance, ...(comment ? { comment } : {}),
    })),
  };
  return JSON.stringify(file, null, 2);
}

export function parseProject(text: string): MapObjectData[] {
  const raw = JSON.parse(text);
  if (raw?.format !== PROJECT_FORMAT) throw new Error('Это не файл проекта MapPin');
  if (!Array.isArray(raw.objects)) throw new Error('В проекте нет списка объектов');
  return raw.objects.map((o: any, i: number) => {
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const vec = (v: unknown): [number, number, number] => {
      if (!Array.isArray(v) || v.length !== 3) throw new Error(`Объект #${i + 1}: неверный вектор`);
      return [num(v[0], 0), num(v[1], 0), num(v[2], 0)];
    };
    return {
      model: num(o.model, NaN),
      position: vec(o.position),
      rotation: vec(o.rotation),
      world: num(o.world, -1),
      interior: num(o.interior, -1),
      drawDistance: num(o.drawDistance, 0),
      ...(typeof o.comment === 'string' && o.comment ? { comment: o.comment } : {}),
    };
  }).filter((o: MapObjectData) => Number.isInteger(o.model));
}
