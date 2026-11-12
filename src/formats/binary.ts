/** Последовательное чтение little-endian данных. */
export class BinaryReader {
  readonly view: DataView;
  pos: number;

  constructor(readonly bytes: Uint8Array, pos = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get length() { return this.bytes.byteLength; }
  get remaining() { return this.bytes.byteLength - this.pos; }

  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }

  bytesAt(len: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  /** Строка фиксированной длины, обрезанная по первому нулю. */
  fixedString(len: number): string {
    const raw = this.bytesAt(len);
    let end = raw.indexOf(0);
    if (end < 0) end = raw.length;
    return latin1(raw.subarray(0, end));
  }

  skip(n: number) { this.pos += n; }
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function decodeText(bytes: Uint8Array): string {
  return latin1(bytes);
}
