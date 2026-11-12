import * as THREE from 'three';
import { parseDff, type DffGeometry, type DffModel } from '../formats/dff';
import { parseTxd, type TxdTexture } from '../formats/txd';
import type { ObjectDef } from '../formats/ide';
import { readArchiveFile, type GameData } from './gameData';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
}

export interface ModelTemplate {
  name: string;
  parts: ModelPart[];
  /** Габариты в локальных координатах модели. */
  box: THREE.Box3;
  placeholder: boolean;
}

const FLAG_ALPHA1 = 0x04;
const FLAG_ALPHA2 = 0x08;
const FLAG_NO_CULL = 0x200000;

/** Загрузка и кэш моделей и текстур из архивов игры. */
export class ModelLibrary {
  private models = new Map<number, Promise<ModelTemplate>>();
  private txds = new Map<string, Promise<Map<string, THREE.Texture>>>();
  private queue: (() => void)[] = [];
  private active = 0;
  readonly placeholderTemplate: ModelTemplate;
  maxConcurrent = 6;

  constructor(private data: GameData | null) {
    this.placeholderTemplate = makePlaceholder();
  }

  setData(data: GameData | null) {
    this.data = data;
    this.models.clear();
    this.txds.clear();
  }

  peek(id: number): Promise<ModelTemplate> | undefined { return this.models.get(id); }

  get(id: number): Promise<ModelTemplate> {
    let p = this.models.get(id);
    if (!p) {
      p = this.schedule(() => this.load(id)).catch((e) => {
        console.warn(`Модель ${id}:`, e);
        return this.placeholderTemplate;
      });
      this.models.set(id, p);
    }
    return p;
  }

  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++;
        fn().then(resolve, reject).finally(() => {
          this.active--;
          this.queue.shift()?.();
        });
      };
      if (this.active < this.maxConcurrent) run(); else this.queue.push(run);
    });
  }

  private async load(id: number): Promise<ModelTemplate> {
    const def = this.data?.defs.get(id);
    if (!this.data || !def) return this.placeholderTemplate;
    const dffBytes = await readArchiveFile(this.data, def.model + '.dff');
    if (!dffBytes) return this.placeholderTemplate;
    const dff = parseDff(dffBytes);
    const textures = await this.texturesFor(def.txd);
    return buildTemplate(def, dff, textures);
  }

  private texturesFor(txd: string): Promise<Map<string, THREE.Texture>> {
    let p = this.txds.get(txd);
    if (!p) {
      p = (async () => {
        const result = new Map<string, THREE.Texture>();
        const parent = this.data?.txdParents.get(txd);
        if (parent && parent !== txd) for (const [k, v] of await this.texturesFor(parent)) result.set(k, v);
        if (!this.data) return result;
        const bytes = await readArchiveFile(this.data, txd + '.txd');
        if (bytes) {
          for (const t of parseTxd(bytes)) result.set(t.name, toTexture(t));
        }
        return result;
      })().catch(() => new Map());
      this.txds.set(txd, p);
    }
    return p;
  }
}

function toTexture(t: TxdTexture): THREE.Texture {
  const tex = new THREE.DataTexture(t.rgba as Uint8Array<ArrayBuffer>, t.width, t.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.userData.hasAlpha = t.hasAlpha;
  tex.name = t.name;
  return tex;
}

export function buildTemplate(def: ObjectDef | null, dff: DffModel, textures: Map<string, THREE.Texture>): ModelTemplate {
  const world = frameWorldMatrices(dff);
  const parts: ModelPart[] = [];
  const box = new THREE.Box3();
  const used = new Set<number>();
  for (const a of dff.atomics) {
    const name = dff.frames[a.frame]?.name ?? '';
    if (/_dam$|_vlo$|_l[0-9]$/.test(name)) continue;
    if (used.has(a.geometry)) continue;
    used.add(a.geometry);
    const g = dff.geometries[a.geometry];
    if (!g || !g.groups.length) continue;
    const geometry = toBufferGeometry(g);
    const material = g.groups.map((grp) => makeMaterial(def, g, grp.material, textures));
    const matrix = world[a.frame] ?? new THREE.Matrix4();
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!.clone().applyMatrix4(matrix));
    parts.push({ geometry, material: material.length === 1 ? material[0] : material, matrix });
  }
  if (!parts.length) return makePlaceholder();
  return { name: def?.model ?? '', parts, box, placeholder: false };
}

function frameWorldMatrices(dff: DffModel): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  dff.frames.forEach((f, i) => {
    const local = new THREE.Matrix4().fromArray(f.matrix);
    // Корневой кадр модели не смещаем: объект ставится в свою точку.
    if (f.parent < 0 || f.parent >= i) out.push(i === 0 ? new THREE.Matrix4() : local);
    else out.push(out[f.parent].clone().multiply(local));
  });
  return out;
}

function toBufferGeometry(g: DffGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  if (g.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
  if (g.colors) geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 4, true));
  const total = g.groups.reduce((n, x) => n + x.indices.length, 0);
  const index = new Uint32Array(total);
  let off = 0;
  g.groups.forEach((grp, i) => {
    index.set(grp.indices, off);
    geo.addGroup(off, grp.indices.length, i);
    off += grp.indices.length;
  });
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if (g.normals) geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  else geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function makeMaterial(def: ObjectDef | null, g: DffGeometry, index: number, textures: Map<string, THREE.Texture>): THREE.Material {
  const m = g.materials[index] ?? { color: [255, 255, 255, 255], texture: null };
  const map = m.texture ? textures.get(m.texture) ?? null : null;
  const flags = def?.flags ?? 0;
  const alpha = !!map?.userData.hasAlpha || m.color[3] < 255 || !!(flags & (FLAG_ALPHA1 | FLAG_ALPHA2));
  const params = {
    map,
    color: new THREE.Color(m.color[0] / 255, m.color[1] / 255, m.color[2] / 255).convertSRGBToLinear(),
    vertexColors: !!g.colors,
    side: alpha || flags & FLAG_NO_CULL ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: alpha ? 0.5 : 0,
    transparent: m.color[3] < 255,
    opacity: m.color[3] / 255,
  };
  // Здания в GTA освещены заранее (prelit) — берём цвета вершин без динамического света.
  return g.colors ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
}

function makePlaceholder(): ModelTemplate {
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshLambertMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.85 });
  return { name: 'placeholder', parts: [{ geometry, material, matrix: new THREE.Matrix4() }], box: new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)), placeholder: true };
}

/** Отдельный экземпляр модели (для объектов проекта). */
export function instantiate(t: ModelTemplate): THREE.Group {
  const group = new THREE.Group();
  for (const p of t.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(p.matrix);
    group.add(mesh);
  }
  return group;
}
