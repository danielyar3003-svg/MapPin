import * as THREE from 'three';
import type { GameData, WorldInstance } from '../game/gameData';
import type { ModelLibrary, ModelTemplate } from '../game/models';
import { iplQuaternion } from '../export/rotation';

interface Batch {
  template: ModelTemplate;
  meshes: THREE.InstancedMesh[];
  capacity: number;
  instances: number[];
}

/** Потоковая отрисовка карты игры с учётом дистанций прорисовки и LOD. */
export class WorldView {
  readonly group = new THREE.Group();
  private data: GameData | null = null;
  private matrices: THREE.Matrix4[] = [];
  private children: number[][] = [];
  private batches = new Map<number, Batch>();
  private loaded = new Map<number, ModelTemplate>();
  private requested = new Set<number>();
  private lastUpdate = 0;
  private lastPos = new THREE.Vector3(Infinity, 0, 0);
  private dirty = false;
  /** Множитель дистанции прорисовки. */
  quality = 1;
  maxDistance = 3000;
  visibleCount = 0;

  constructor(private library: ModelLibrary) {
    this.group.name = 'world';
  }

  setData(data: GameData | null) {
    for (const b of this.batches.values()) b.meshes.forEach((m) => { this.group.remove(m); m.dispose(); });
    this.batches.clear();
    this.loaded.clear();
    this.requested.clear();
    this.data = data;
    this.matrices = [];
    this.children = [];
    this.visibleCount = 0;
    if (!data) return;
    const pos = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1);
    for (const w of data.world) {
      pos.set(...w.position);
      this.matrices.push(new THREE.Matrix4().compose(pos, iplQuaternion(w.rotation), scale));
      this.children.push([]);
    }
    for (const w of data.world) if (w.lod >= 0 && this.children[w.lod]) this.children[w.lod].push(w.index);
    this.lastPos.set(Infinity, 0, 0);
  }

  instance(index: number): WorldInstance | undefined { return this.data?.world[index]; }
  matrixOf(index: number) { return this.matrices[index]; }

  update(camera: THREE.Vector3, now: number) {
    if (!this.data) return;
    const moved = camera.distanceToSquared(this.lastPos) > 4;
    if (!this.dirty && (!moved || now - this.lastUpdate < 250)) return;
    this.lastUpdate = now;
    this.lastPos.copy(camera);
    this.dirty = false;

    const world = this.data.world;
    const inRange = new Uint8Array(world.length);
    for (let i = 0; i < world.length; i++) {
      const w = world[i];
      const dx = w.position[0] - camera.x, dy = w.position[1] - camera.y, dz = w.position[2] - camera.z;
      const limit = Math.min(w.def.drawDistance * this.quality, this.maxDistance);
      if (dx * dx + dy * dy + dz * dz < limit * limit) inRange[i] = 1;
    }

    const perModel = new Map<number, number[]>();
    let visible = 0;
    for (let i = 0; i < world.length; i++) {
      if (!inRange[i]) continue;
      const w = world[i];
      const id = w.def.id;
      if (!this.loaded.has(id)) { this.request(id); continue; }
      if (w.isLod) {
        // LOD скрывается, только когда все его HD-части в зоне видимости и загружены.
        const kids = this.children[i];
        const covered = kids.length > 0 && kids.every((k) => inRange[k] && this.loaded.has(world[k].def.id));
        if (covered) continue;
      }
      const list = perModel.get(id) ?? [];
      list.push(i);
      perModel.set(id, list);
      visible++;
    }
    this.visibleCount = visible;

    for (const [id, b] of this.batches) {
      if (!perModel.has(id)) { b.instances = []; b.meshes.forEach((m) => { m.count = 0; m.visible = false; }); }
    }
    const tmp = new THREE.Matrix4();
    for (const [id, list] of perModel) {
      const b = this.batch(id, list.length);
      b.instances = list;
      b.meshes.forEach((mesh, pi) => {
        const partMatrix = b.template.parts[pi].matrix;
        for (let k = 0; k < list.length; k++) mesh.setMatrixAt(k, tmp.multiplyMatrices(this.matrices[list[k]], partMatrix));
        mesh.count = list.length;
        mesh.visible = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      });
    }
  }

  private request(id: number) {
    if (this.requested.has(id)) return;
    this.requested.add(id);
    this.library.get(id).then((t) => {
      if (!this.data) return;
      this.loaded.set(id, t);
      this.dirty = true;
    });
  }

  private batch(id: number, need: number): Batch {
    let b = this.batches.get(id);
    if (b && b.capacity >= need) return b;
    const template = this.loaded.get(id)!;
    const capacity = Math.max(need, Math.ceil((b?.capacity ?? 4) * 1.5));
    b?.meshes.forEach((m) => { this.group.remove(m); m.dispose(); });
    const meshes = template.parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.userData.worldModel = id;
      m.frustumCulled = true;
      this.group.add(m);
      return m;
    });
    b = { template, meshes, capacity, instances: [] };
    this.batches.set(id, b);
    return b;
  }

  /** Индекс объекта карты по попаданию луча в InstancedMesh. */
  resolveHit(hit: THREE.Intersection): number | undefined {
    const mesh = hit.object as THREE.InstancedMesh;
    const id = mesh.userData.worldModel;
    if (id === undefined || hit.instanceId === undefined) return undefined;
    return this.batches.get(id)?.instances[hit.instanceId];
  }

  get loadedModels() { return this.loaded.size; }
}
