import { chunk, RW } from '../src/formats/rw';

export class Writer {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 255); return this; }
  u16(v: number) { this.u8(v); this.u8(v >> 8); return this; }
  u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.parts.push(...b); return this; }
  i32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); this.parts.push(...b); return this; }
  f32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); this.parts.push(...b); return this; }
  str(s: string, len: number) { for (let i = 0; i < len; i++) this.u8(i < s.length ? s.charCodeAt(i) : 0); return this; }
  bytes(b: Uint8Array) { this.parts.push(...b); return this; }
  done() { return Uint8Array.from(this.parts); }
}

export const cat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of a) { out.set(x, p); p += x.length; }
  return out;
};

export function rwString(s: string) {
  const len = (s.length + 4) & ~3;
  return chunk(RW.STRING, new Writer().str(s, len).done());
}

/** Минимальный DFF: один треугольник, один текстурированный материал, prelit. */
export function makeDff(texture = 'brick') {
  const frameStruct = new Writer().u32(1);
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30].forEach((v) => frameStruct.f32(v));
  frameStruct.i32(-1).u32(0);
  const frameList = chunk(RW.FRAME_LIST, cat(
    chunk(RW.STRUCT, frameStruct.done()),
    chunk(RW.EXTENSION, chunk(RW.FRAME_NAME, new Writer().str('box', 3).done())),
  ));

  const flags = 0x02 | 0x04 | 0x08 | 0x10 | (1 << 16);
  const g = new Writer().u32(flags).u32(1).u32(3).u32(1);
  for (let i = 0; i < 3; i++) g.u8(200).u8(100).u8(50).u8(255);
  [0, 0, 1, 0, 0, 1].forEach((v) => g.f32(v));
  g.u16(1).u16(0).u16(0).u16(2); // v2, v1, mat, v3
  [0, 0, 0, 5].forEach((v) => g.f32(v));
  g.u32(1).u32(1);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v) => g.f32(v));
  [0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((v) => g.f32(v));

  const texChunk = chunk(RW.TEXTURE, cat(chunk(RW.STRUCT, new Writer().u32(0x1106).done()), rwString(texture), rwString(''), chunk(RW.EXTENSION, new Uint8Array())));
  const matStruct = new Writer().u32(0).u8(255).u8(128).u8(64).u8(255).u32(0).u32(1).f32(1).f32(1).f32(1).done();
  const material = chunk(RW.MATERIAL, cat(chunk(RW.STRUCT, matStruct), texChunk, chunk(RW.EXTENSION, new Uint8Array())));
  const matList = chunk(RW.MATERIAL_LIST, cat(chunk(RW.STRUCT, new Writer().u32(1).i32(-1).done()), material));
  const geometry = chunk(RW.GEOMETRY, cat(chunk(RW.STRUCT, g.done()), matList, chunk(RW.EXTENSION, new Uint8Array())));
  const geoList = chunk(RW.GEOMETRY_LIST, cat(chunk(RW.STRUCT, new Writer().u32(1).done()), geometry));
  const atomic = chunk(RW.ATOMIC, cat(chunk(RW.STRUCT, new Writer().u32(0).u32(0).u32(5).u32(0).done()), chunk(RW.EXTENSION, new Uint8Array())));
  return chunk(RW.CLUMP, cat(chunk(RW.STRUCT, new Writer().u32(1).u32(0).u32(0).done()), frameList, geoList, atomic));
}

/** TXD с одной несжатой 2x2 текстурой формата 8888 (D3D9). */
export function makeTxd(name = 'brick', dxt1Block?: Uint8Array) {
  const w = new Writer().u32(9).u32(0x1102).str(name, 32).str('', 32);
  if (dxt1Block) {
    w.u32(0x0200).u32(0x31545844).u16(4).u16(4).u8(16).u8(1).u8(4).u8(8).u32(dxt1Block.length).bytes(dxt1Block);
  } else {
    w.u32(0x0500).u32(21).u16(2).u16(2).u8(32).u8(1).u8(4).u8(0).u32(16);
    // BGRA: красный, зелёный, синий, полупрозрачный белый
    w.u8(0).u8(0).u8(255).u8(255).u8(0).u8(255).u8(0).u8(255).u8(255).u8(0).u8(0).u8(255).u8(255).u8(255).u8(255).u8(128);
  }
  const native = chunk(RW.TEXTURE_NATIVE, cat(chunk(RW.STRUCT, w.done()), chunk(RW.EXTENSION, new Uint8Array())));
  return chunk(RW.TEX_DICTIONARY, cat(chunk(RW.STRUCT, new Writer().u16(1).u16(0).done()), native, chunk(RW.EXTENSION, new Uint8Array())));
}
