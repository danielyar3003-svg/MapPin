import { BinaryReader } from './binary';

export const RW = {
  STRUCT: 0x01,
  STRING: 0x02,
  EXTENSION: 0x03,
  TEXTURE: 0x06,
  MATERIAL: 0x07,
  MATERIAL_LIST: 0x08,
  FRAME_LIST: 0x0e,
  GEOMETRY: 0x0f,
  CLUMP: 0x10,
  ATOMIC: 0x14,
  TEXTURE_NATIVE: 0x15,
  TEX_DICTIONARY: 0x16,
  GEOMETRY_LIST: 0x1a,
  BIN_MESH: 0x50e,
  FRAME_NAME: 0x253f2fe,
} as const;

export interface Chunk {
  type: number;
  size: number;
  version: number;
  /** Смещение данных (после 12-байтного заголовка). */
  start: number;
  end: number;
}

/** Декодирует "library id stamp" RenderWare в номер версии вида 0x36003. */
export function rwVersion(stamp: number): number {
  if (stamp & 0xffff0000) return (((stamp >>> 14) & 0x3ff00) + 0x30000) | ((stamp >>> 16) & 0x3f);
  return stamp << 8;
}

export function readChunk(r: BinaryReader): Chunk {
  const type = r.u32();
  const size = r.u32();
  const version = rwVersion(r.u32());
  const start = r.pos;
  return { type, size, version, start, end: start + size };
}

/** Дочерние чанки в диапазоне [start, end). */
export function children(bytes: Uint8Array, start: number, end: number): Chunk[] {
  const r = new BinaryReader(bytes, start);
  const out: Chunk[] = [];
  while (r.pos + 12 <= end) {
    const c = readChunk(r);
    if (c.end > end) break;
    out.push(c);
    r.pos = c.end;
  }
  return out;
}

export function findChild(bytes: Uint8Array, parent: Chunk, type: number): Chunk | undefined {
  return children(bytes, parent.start, parent.end).find((c) => c.type === type);
}

export function readRwString(bytes: Uint8Array, c: Chunk): string {
  const r = new BinaryReader(bytes, c.start);
  return r.fixedString(c.size);
}

/** Сборка чанка — для тестов. */
export function chunk(type: number, payload: Uint8Array, stamp = 0x1803ffff): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, type, true);
  dv.setUint32(4, payload.length, true);
  dv.setUint32(8, stamp, true);
  out.set(payload, 12);
  return out;
}
