import { BinaryReader } from './binary';

export const SECTOR = 2048;

export interface ImgEntry {
  name: string;
  /** Смещение в байтах от начала архива. */
  offset: number;
  /** Размер в байтах. */
  size: number;
}

/**
 * Каталог IMG-архива версии 2 (GTA SA): заголовок "VER2", число записей,
 * затем записи по 32 байта.
 */
export function parseImgV2Directory(header: Uint8Array): ImgEntry[] {
  const r = new BinaryReader(header);
  const magic = r.fixedString(4);
  if (magic !== 'VER2') throw new Error(`Не IMG v2 архив (сигнатура "${magic}")`);
  const count = r.u32();
  const entries: ImgEntry[] = [];
  for (let i = 0; i < count; i++) {
    const offset = r.u32();
    const streaming = r.u16();
    const archive = r.u16();
    const name = r.fixedString(24);
    const sectors = streaming || archive;
    entries.push({ name, offset: offset * SECTOR, size: sectors * SECTOR });
  }
  return entries;
}

/** Сколько байт нужно прочитать с начала архива, чтобы получить весь каталог. */
export function imgV2HeaderSize(first8: Uint8Array): number {
  const r = new BinaryReader(first8);
  if (r.fixedString(4) !== 'VER2') throw new Error('Не IMG v2 архив');
  return 8 + r.u32() * 32;
}

/** Сборка IMG v2 — нужна для тестов и экспорта. */
export function buildImgV2(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const headerBytes = 8 + files.length * 32;
  let sector = Math.ceil(headerBytes / SECTOR);
  const layout = files.map((f) => {
    const sectors = Math.max(1, Math.ceil(f.data.length / SECTOR));
    const e = { ...f, sector, sectors };
    sector += sectors;
    return e;
  });
  const out = new Uint8Array(sector * SECTOR);
  const dv = new DataView(out.buffer);
  out.set([0x56, 0x45, 0x52, 0x32]);
  dv.setUint32(4, files.length, true);
  layout.forEach((e, i) => {
    const p = 8 + i * 32;
    dv.setUint32(p, e.sector, true);
    dv.setUint16(p + 4, e.sectors, true);
    dv.setUint16(p + 6, 0, true);
    for (let c = 0; c < Math.min(23, e.name.length); c++) out[p + 8 + c] = e.name.charCodeAt(c);
    out.set(e.data, e.sector * SECTOR);
  });
  return out;
}
