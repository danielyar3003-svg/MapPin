/** Программная распаковка DXT1/DXT3/DXT5 в RGBA8. */

function rgb565(c: number, out: number[], o: number) {
  out[o] = ((c >> 11) & 31) * 255 / 31 | 0;
  out[o + 1] = ((c >> 5) & 63) * 255 / 63 | 0;
  out[o + 2] = (c & 31) * 255 / 31 | 0;
  out[o + 3] = 255;
}

function colorBlock(src: Uint8Array, p: number, dst: Uint8Array, w: number, h: number, bx: number, by: number, dxt1: boolean) {
  const c0 = src[p] | (src[p + 1] << 8);
  const c1 = src[p + 2] | (src[p + 3] << 8);
  const pal = new Array<number>(16);
  rgb565(c0, pal, 0);
  rgb565(c1, pal, 4);
  if (c0 > c1 || !dxt1) {
    for (let i = 0; i < 3; i++) {
      pal[8 + i] = (2 * pal[i] + pal[4 + i]) / 3 | 0;
      pal[12 + i] = (pal[i] + 2 * pal[4 + i]) / 3 | 0;
    }
    pal[11] = pal[15] = 255;
  } else {
    for (let i = 0; i < 3; i++) { pal[8 + i] = (pal[i] + pal[4 + i]) / 2 | 0; pal[12 + i] = 0; }
    pal[11] = 255;
    pal[15] = 0;
  }
  const bits = src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = bx + x, py = by + y;
      if (px >= w || py >= h) continue;
      const idx = (bits >>> (2 * (y * 4 + x))) & 3;
      const d = (py * w + px) * 4;
      dst[d] = pal[idx * 4];
      dst[d + 1] = pal[idx * 4 + 1];
      dst[d + 2] = pal[idx * 4 + 2];
      if (dxt1) dst[d + 3] = pal[idx * 4 + 3];
    }
  }
}

export function decodeDxt(src: Uint8Array, w: number, h: number, kind: 1 | 3 | 5): Uint8Array {
  const dst = new Uint8Array(w * h * 4);
  const blockSize = kind === 1 ? 8 : 16;
  let p = 0;
  for (let by = 0; by < h; by += 4) {
    for (let bx = 0; bx < w; bx += 4) {
      if (p + blockSize > src.length) return dst;
      if (kind === 1) { colorBlock(src, p, dst, w, h, bx, by, true); p += 8; continue; }
      colorBlock(src, p + 8, dst, w, h, bx, by, false);
      if (kind === 3) {
        for (let i = 0; i < 16; i++) {
          const a = (src[p + (i >> 1)] >> ((i & 1) * 4)) & 15;
          const x = bx + (i & 3), y = by + (i >> 2);
          if (x < w && y < h) dst[(y * w + x) * 4 + 3] = a * 17;
        }
      } else {
        const a0 = src[p], a1 = src[p + 1];
        const a = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) a.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else { for (let i = 1; i < 5; i++) a.push(((5 - i) * a0 + i * a1) / 5 | 0); a.push(0, 255); }
        // 48 бит индексов
        const lo = src[p + 2] | (src[p + 3] << 8) | (src[p + 4] << 16);
        const hi = src[p + 5] | (src[p + 6] << 8) | (src[p + 7] << 16);
        for (let i = 0; i < 16; i++) {
          const bitsrc = i < 8 ? lo : hi;
          const idx = (bitsrc >> (3 * (i & 7))) & 7;
          const x = bx + (i & 3), y = by + (i >> 2);
          if (x < w && y < h) dst[(y * w + x) * 4 + 3] = a[idx];
        }
      }
      p += 16;
    }
  }
  return dst;
}
