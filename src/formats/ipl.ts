import { BinaryReader } from './binary';
import { sections } from './text';

export interface Placement {
  id: number;
  model: string;
  interior: number;
  position: [number, number, number];
  /** Кватернион как в файле (x, y, z, w). В GTA он записан сопряжённым. */
  rotation: [number, number, number, number];
  lod: number;
}

export function parseTextIpl(text: string): Placement[] {
  const out: Placement[] = [];
  for (const { name, fields } of sections(text)) {
    if (name !== 'inst' || fields.length < 10) continue;
    const n = fields.map(Number);
    out.push({
      id: n[0],
      model: fields[1].toLowerCase(),
      interior: n[2],
      position: [n[3], n[4], n[5]],
      rotation: [n[6], n[7], n[8], n[9]],
      lod: fields.length > 10 ? n[10] : -1,
    });
  }
  return out;
}

export function isBinaryIpl(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x62 && bytes[1] === 0x6e && bytes[2] === 0x72 && bytes[3] === 0x79; // "bnry"
}

/**
 * Бинарный IPL из gta3.img (*_streamN.ipl). Заголовок: "bnry", 6 счётчиков,
 * затем смещения секций. Запись inst — 40 байт.
 */
export function parseBinaryIpl(bytes: Uint8Array): Placement[] {
  const r = new BinaryReader(bytes);
  if (!isBinaryIpl(bytes)) throw new Error('Не бинарный IPL');
  r.pos = 4;
  const count = r.i32();
  r.pos = 28;
  const offset = r.i32();
  const out: Placement[] = [];
  r.pos = offset;
  for (let i = 0; i < count && r.remaining >= 40; i++) {
    const px = r.f32(), py = r.f32(), pz = r.f32();
    const qx = r.f32(), qy = r.f32(), qz = r.f32(), qw = r.f32();
    const id = r.i32();
    const interior = r.i32();
    const lod = r.i32();
    out.push({ id, model: '', interior, position: [px, py, pz], rotation: [qx, qy, qz, qw], lod });
  }
  return out;
}
