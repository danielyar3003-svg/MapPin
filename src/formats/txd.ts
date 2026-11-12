import { BinaryReader } from './binary';
import { decodeDxt } from './dxt';
import { RW, children, readChunk } from './rw';

export interface TxdTexture {
  name: string;
  width: number;
  height: number;
  /** RGBA8, строки сверху вниз. */
  rgba: Uint8Array;
  hasAlpha: boolean;
}

const FMT_MASK = 0x0f00;
const FMT_1555 = 0x0100, FMT_565 = 0x0200, FMT_4444 = 0x0300, FMT_LUM8 = 0x0400, FMT_8888 = 0x0500, FMT_888 = 0x0600, FMT_555 = 0x0a00;
const FMT_PAL8 = 0x2000, FMT_PAL4 = 0x4000;

export function parseTxd(bytes: Uint8Array): TxdTexture[] {
  const r = new BinaryReader(bytes);
  const root = readChunk(r);
  if (root.type !== RW.TEX_DICTIONARY) throw new Error('Не TXD');
  const out: TxdTexture[] = [];
  for (const c of children(bytes, root.start, root.end)) {
    if (c.type !== RW.TEXTURE_NATIVE) continue;
    const s = children(bytes, c.start, c.end).find((k) => k.type === RW.STRUCT);
    if (!s) continue;
    try {
      const t = parseNative(bytes, s.start);
      if (t) out.push(t);
    } catch {
      // Битая текстура не должна ломать весь словарь.
    }
  }
  return out;
}

function parseNative(bytes: Uint8Array, start: number): TxdTexture | null {
  const r = new BinaryReader(bytes, start);
  const platform = r.u32();
  if (platform !== 8 && platform !== 9) return null;
  r.u32(); // filter + addressing
  const name = r.fixedString(32).toLowerCase();
  r.fixedString(32); // mask
  const raster = r.u32();
  const d3d = r.u32();
  const width = r.u16();
  const height = r.u16();
  r.u8(); // depth
  r.u8(); // levels
  r.u8(); // raster type
  const flags = r.u8();

  let palette: Uint8Array | null = null;
  if (raster & FMT_PAL8) palette = r.bytesAt(256 * 4);
  else if (raster & FMT_PAL4) palette = r.bytesAt(16 * 4);

  const size = r.u32();
  const data = r.bytesAt(size);

  let dxt: 0 | 1 | 3 | 5 = 0;
  if (platform === 9) {
    const four = String.fromCharCode(d3d & 255, (d3d >> 8) & 255, (d3d >> 16) & 255, (d3d >> 24) & 255);
    if (four === 'DXT1') dxt = 1; else if (four === 'DXT3') dxt = 3; else if (four === 'DXT5') dxt = 5;
  } else if (d3d === 1 || d3d === 3 || d3d === 5) {
    dxt = d3d;
  }

  let rgba: Uint8Array;
  let hasAlpha: boolean;
  if (dxt) {
    rgba = decodeDxt(data, width, height, dxt);
    hasAlpha = dxt !== 1 || !!(flags & 1) || (raster & FMT_MASK) === FMT_1555;
  } else if (palette) {
    rgba = new Uint8Array(width * height * 4);
    const pal4 = !!(raster & FMT_PAL4);
    for (let i = 0; i < width * height; i++) {
      const idx = pal4 ? (data[i >> 1] >> ((i & 1) * 4)) & 15 : data[i];
      rgba.set(palette.subarray(idx * 4, idx * 4 + 4), i * 4);
    }
    hasAlpha = (raster & FMT_MASK) === FMT_8888;
  } else {
    rgba = decodeUncompressed(data, width, height, raster & FMT_MASK);
    hasAlpha = [FMT_8888, FMT_1555, FMT_4444].includes(raster & FMT_MASK);
  }
  return { name, width, height, rgba, hasAlpha };
}

function decodeUncompressed(data: Uint8Array, w: number, h: number, fmt: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    switch (fmt) {
      case FMT_8888:
      case FMT_888: { // BGRA
        out[o] = data[i * 4 + 2]; out[o + 1] = data[i * 4 + 1]; out[o + 2] = data[i * 4];
        out[o + 3] = fmt === FMT_8888 ? data[i * 4 + 3] : 255;
        break;
      }
      case FMT_565: {
        const c = dv.getUint16(i * 2, true);
        out[o] = ((c >> 11) & 31) * 255 / 31; out[o + 1] = ((c >> 5) & 63) * 255 / 63; out[o + 2] = (c & 31) * 255 / 31; out[o + 3] = 255;
        break;
      }
      case FMT_1555:
      case FMT_555: {
        const c = dv.getUint16(i * 2, true);
        out[o] = ((c >> 10) & 31) * 255 / 31; out[o + 1] = ((c >> 5) & 31) * 255 / 31; out[o + 2] = (c & 31) * 255 / 31;
        out[o + 3] = fmt === FMT_1555 ? (c & 0x8000 ? 255 : 0) : 255;
        break;
      }
      case FMT_4444: {
        const c = dv.getUint16(i * 2, true);
        out[o] = ((c >> 8) & 15) * 17; out[o + 1] = ((c >> 4) & 15) * 17; out[o + 2] = (c & 15) * 17; out[o + 3] = ((c >> 12) & 15) * 17;
        break;
      }
      case FMT_LUM8: {
        out[o] = out[o + 1] = out[o + 2] = data[i]; out[o + 3] = 255;
        break;
      }
      default:
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
    }
  }
  return out;
}
