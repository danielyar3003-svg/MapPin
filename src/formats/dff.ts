import { BinaryReader } from './binary';
import { RW, children, findChild, readChunk, readRwString, type Chunk } from './rw';

export interface DffMaterial {
  color: [number, number, number, number];
  texture: string | null;
}

export interface DffGeometry {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  colors: Uint8Array | null;
  /** Треугольники, сгруппированные по материалу. */
  groups: { material: number; indices: Uint32Array }[];
  materials: DffMaterial[];
}

export interface DffFrame {
  /** Матрица 4x4 (column-major, как в three.js) относительно родителя. */
  matrix: number[];
  parent: number;
  name: string;
}

export interface DffAtomic {
  frame: number;
  geometry: number;
}

export interface DffModel {
  frames: DffFrame[];
  geometries: DffGeometry[];
  atomics: DffAtomic[];
}

const GEO_POSITIONS = 0x02;
const GEO_TEXTURED = 0x04;
const GEO_PRELIT = 0x08;
const GEO_TEXTURED2 = 0x80;
const GEO_NATIVE = 0x01000000;

export function parseDff(bytes: Uint8Array): DffModel {
  const r = new BinaryReader(bytes);
  // В файле может быть несколько клампов (редко) — берём первый.
  let clump: Chunk | undefined;
  while (r.pos + 12 <= bytes.length) {
    const c = readChunk(r);
    if (c.type === RW.CLUMP) { clump = c; break; }
    r.pos = c.end;
  }
  if (!clump) throw new Error('В DFF нет Clump');

  const model: DffModel = { frames: [], geometries: [], atomics: [] };
  for (const c of children(bytes, clump.start, clump.end)) {
    if (c.type === RW.FRAME_LIST) model.frames = parseFrameList(bytes, c);
    else if (c.type === RW.GEOMETRY_LIST) {
      for (const g of children(bytes, c.start, c.end)) {
        if (g.type === RW.GEOMETRY) model.geometries.push(parseGeometry(bytes, g));
      }
    } else if (c.type === RW.ATOMIC) {
      const s = findChild(bytes, c, RW.STRUCT);
      if (!s) continue;
      const ar = new BinaryReader(bytes, s.start);
      model.atomics.push({ frame: ar.u32(), geometry: ar.u32() });
    }
  }
  return model;
}

function parseFrameList(bytes: Uint8Array, list: Chunk): DffFrame[] {
  const kids = children(bytes, list.start, list.end);
  const s = kids.find((k) => k.type === RW.STRUCT);
  if (!s) return [];
  const r = new BinaryReader(bytes, s.start);
  const n = r.u32();
  const frames: DffFrame[] = [];
  for (let i = 0; i < n; i++) {
    const m = Array.from({ length: 12 }, () => r.f32());
    const parent = r.i32();
    r.u32();
    // RW хранит right, up, at, pos — строки базиса; в column-major это столбцы.
    frames.push({
      matrix: [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1],
      parent,
      name: '',
    });
  }
  // Имена кадров — в расширениях, идущих после структуры, по одному на кадр.
  const exts = kids.filter((k) => k.type === RW.EXTENSION);
  exts.forEach((e, i) => {
    if (i >= frames.length) return;
    const nameChunk = findChild(bytes, e, RW.FRAME_NAME);
    if (nameChunk) frames[i].name = readRwString(bytes, nameChunk).toLowerCase();
  });
  return frames;
}

function parseGeometry(bytes: Uint8Array, geo: Chunk): DffGeometry {
  const kids = children(bytes, geo.start, geo.end);
  const s = kids.find((k) => k.type === RW.STRUCT);
  if (!s) throw new Error('Geometry без Struct');
  const r = new BinaryReader(bytes, s.start);
  const flags = r.u32();
  const numTris = r.u32();
  const numVerts = r.u32();
  r.u32(); // morph targets
  if (s.version < 0x34000) r.skip(12);

  let numUV = (flags >>> 16) & 0xff;
  if (!numUV) numUV = flags & GEO_TEXTURED2 ? 2 : flags & GEO_TEXTURED ? 1 : 0;

  let colors: Uint8Array | null = null;
  let uvs: Float32Array | null = null;
  const tris: number[] = []; // v1, v2, v3, material

  if (!(flags & GEO_NATIVE)) {
    if (flags & GEO_PRELIT) colors = bytes.slice(r.pos, r.pos + numVerts * 4), r.skip(numVerts * 4);
    for (let set = 0; set < numUV; set++) {
      const arr = new Float32Array(numVerts * 2);
      for (let i = 0; i < numVerts * 2; i++) arr[i] = r.f32();
      if (set === 0) uvs = arr;
    }
    for (let i = 0; i < numTris; i++) {
      const v2 = r.u16(), v1 = r.u16(), mat = r.u16(), v3 = r.u16();
      tris.push(v1, v2, v3, mat);
    }
  }

  // Первый morph target
  r.skip(16); // bounding sphere
  const hasPositions = r.u32();
  const hasNormals = r.u32();
  const positions = new Float32Array(numVerts * 3);
  if (hasPositions || flags & GEO_POSITIONS) for (let i = 0; i < numVerts * 3; i++) positions[i] = r.f32();
  let normals: Float32Array | null = null;
  if (hasNormals) {
    normals = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts * 3; i++) normals[i] = r.f32();
  }

  const matList = kids.find((k) => k.type === RW.MATERIAL_LIST);
  const materials = matList ? parseMaterialList(bytes, matList) : [];

  let groups: DffGeometry['groups'];
  if (tris.length) {
    const byMat = new Map<number, number[]>();
    for (let i = 0; i < tris.length; i += 4) {
      const list = byMat.get(tris[i + 3]) ?? [];
      list.push(tris[i], tris[i + 1], tris[i + 2]);
      byMat.set(tris[i + 3], list);
    }
    groups = [...byMat].map(([material, idx]) => ({ material, indices: Uint32Array.from(idx) }));
  } else {
    const ext = kids.find((k) => k.type === RW.EXTENSION);
    const bin = ext && findChild(bytes, ext, RW.BIN_MESH);
    groups = bin ? parseBinMesh(bytes, bin) : [];
  }
  return { positions, normals, uvs, colors, groups, materials };
}

function parseMaterialList(bytes: Uint8Array, list: Chunk): DffMaterial[] {
  const kids = children(bytes, list.start, list.end);
  const s = kids.find((k) => k.type === RW.STRUCT);
  const mats = kids.filter((k) => k.type === RW.MATERIAL).map((m) => parseMaterial(bytes, m));
  if (!s) return mats;
  const r = new BinaryReader(bytes, s.start);
  const n = r.u32();
  const out: DffMaterial[] = [];
  let next = 0;
  for (let i = 0; i < n; i++) {
    const ref = r.i32();
    out.push(ref < 0 ? mats[next++] ?? defaultMaterial() : out[ref] ?? defaultMaterial());
  }
  return out;
}

function defaultMaterial(): DffMaterial {
  return { color: [255, 255, 255, 255], texture: null };
}

function parseMaterial(bytes: Uint8Array, m: Chunk): DffMaterial {
  const kids = children(bytes, m.start, m.end);
  const s = kids.find((k) => k.type === RW.STRUCT);
  const mat = defaultMaterial();
  if (s) {
    const r = new BinaryReader(bytes, s.start + 4);
    mat.color = [r.u8(), r.u8(), r.u8(), r.u8()];
  }
  const tex = kids.find((k) => k.type === RW.TEXTURE);
  if (tex) {
    const name = children(bytes, tex.start, tex.end).find((k) => k.type === RW.STRING);
    if (name) mat.texture = readRwString(bytes, name).toLowerCase();
  }
  return mat;
}

function parseBinMesh(bytes: Uint8Array, c: Chunk): DffGeometry['groups'] {
  const r = new BinaryReader(bytes, c.start);
  const isStrip = r.u32() === 1;
  const numMeshes = r.u32();
  r.u32(); // total indices
  const groups: DffGeometry['groups'] = [];
  for (let m = 0; m < numMeshes; m++) {
    const count = r.u32();
    const material = r.u32();
    const idx: number[] = [];
    for (let i = 0; i < count; i++) idx.push(r.u32());
    if (!isStrip) { groups.push({ material, indices: Uint32Array.from(idx) }); continue; }
    const tri: number[] = [];
    for (let i = 0; i + 2 < idx.length; i++) {
      const a = idx[i], b = idx[i + 1], d = idx[i + 2];
      if (a === b || b === d || a === d) continue;
      if (i % 2 === 0) tri.push(a, b, d); else tri.push(b, a, d);
    }
    groups.push({ material, indices: Uint32Array.from(tri) });
  }
  return groups;
}
