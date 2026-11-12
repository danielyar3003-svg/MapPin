import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FlyCamera } from './flyCamera';
import { WorldView } from './worldView';
import { instantiate, type ModelLibrary, type ModelTemplate } from '../game/models';
import type { MapDocument } from './document';
import type { MapObject } from './types';
import { quaternionToSamp, sampToQuaternion, SAMP_EULER_ORDER, type Vec3 } from '../export/rotation';

export interface PickResult {
  kind: 'object' | 'world' | 'none';
  uid?: number;
  worldIndex?: number;
  point?: THREE.Vector3;
}

/** 3D-вид: камера, карта, объекты проекта, выделение и гизмо. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.3, 6000);
  readonly fly: FlyCamera;
  readonly world: WorldView;
  readonly objects = new THREE.Group();
  readonly gizmo: TransformControls;
  private pivot = new THREE.Object3D();
  private meshes = new Map<number, THREE.Group>();
  private boxes = new Map<number, THREE.BoxHelper>();
  private selection = new Set<number>();
  private dragStart: { pivot: THREE.Matrix4; objects: Map<number, THREE.Matrix4> } | null = null;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private grid: THREE.GridHelper;
  private water: THREE.Mesh;
  fps = 0;
  onSelectionChange: (uids: number[]) => void = () => {};
  onFrame: () => void = () => {};

  constructor(private container: HTMLElement, private doc: MapDocument, private library: ModelLibrary) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0x9ec3e6);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 800, 2800);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(300, -200, 600);
    this.scene.add(sun);

    this.grid = new THREE.GridHelper(400, 40, 0x666666, 0x999999);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      new THREE.MeshBasicMaterial({ color: 0x3a6f8f, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.water.visible = false;
    this.water.renderOrder = 2;
    this.scene.add(this.water);

    this.world = new WorldView(library);
    this.scene.add(this.world.group, this.objects, this.pivot);

    this.camera.position.set(-20, -20, 15);
    this.fly = new FlyCamera(this.camera, this.renderer.domElement);
    this.fly.lookAt(new THREE.Vector3(0, 0, 0));

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace('local');
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('mouseDown', () => this.beginDrag());
    this.gizmo.addEventListener('objectChange', () => this.applyDrag(false));
    this.gizmo.addEventListener('mouseUp', () => this.applyDrag(true));

    doc.on((e) => {
      if (e.type === 'reset') { [...this.meshes.keys()].forEach((u) => this.removeMesh(u)); this.setSelection([]); }
      else if (e.type === 'add') this.syncMesh(e.object);
      else if (e.type === 'update') this.syncMesh(e.object);
      else if (e.type === 'remove') {
        this.removeMesh(e.uid);
        if (this.selection.has(e.uid)) this.setSelection([...this.selection].filter((u) => u !== e.uid));
      }
      if (e.type === 'update' && this.selection.has(e.object.uid) && !this.dragStart) this.placePivot();
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setGameLoaded(loaded: boolean) {
    this.grid.visible = !loaded;
    this.water.visible = loaded;
  }

  private resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    this.fly.update(dt);
    this.world.update(this.camera.position, performance.now());
    for (const [uid, box] of this.boxes) { const m = this.meshes.get(uid); if (m) box.setFromObject(m); }
    this.renderer.render(this.scene, this.camera);
    this.onFrame();
  }

  // ---------- объекты проекта ----------

  private syncMesh(o: MapObject) {
    let g = this.meshes.get(o.uid);
    if (!g || g.userData.model !== o.model) {
      if (g) this.objects.remove(g);
      g = new THREE.Group();
      g.userData = { uid: o.uid, model: o.model };
      g.rotation.order = SAMP_EULER_ORDER;
      this.meshes.set(o.uid, g);
      this.objects.add(g);
      const target = g;
      const fill = (t: ModelTemplate) => {
        if (this.meshes.get(o.uid) !== target) return;
        target.clear();
        const inst = instantiate(t);
        inst.children.forEach((c) => (c.userData.uid = o.uid));
        target.add(inst);
        this.boxes.get(o.uid)?.setFromObject(target);
      };
      fill(this.library.placeholderTemplate);
      this.library.get(o.model).then(fill);
    }
    g.position.set(...o.position);
    g.quaternion.copy(sampToQuaternion(o.rotation));
    g.updateMatrixWorld(true);
  }

  private removeMesh(uid: number) {
    const g = this.meshes.get(uid);
    if (g) this.objects.remove(g);
    this.meshes.delete(uid);
    const b = this.boxes.get(uid);
    if (b) { this.scene.remove(b); b.dispose(); this.boxes.delete(uid); }
  }

  /** Перерисовать все объекты (после загрузки игры — модели меняются с заглушек на настоящие). */
  rebuildObjects() {
    [...this.meshes.keys()].forEach((u) => this.removeMesh(u));
    this.doc.all().forEach((o) => this.syncMesh(o));
    this.setSelection([...this.selection]);
  }

  // ---------- выделение ----------

  get selected() { return [...this.selection]; }

  setSelection(uids: number[]) {
    for (const b of this.boxes.values()) { this.scene.remove(b); b.dispose(); }
    this.boxes.clear();
    this.selection = new Set(uids.filter((u) => this.meshes.has(u)));
    for (const uid of this.selection) {
      const box = new THREE.BoxHelper(this.meshes.get(uid)!, 0xffd400);
      this.boxes.set(uid, box);
      this.scene.add(box);
    }
    this.placePivot();
    this.onSelectionChange(this.selected);
  }

  private placePivot() {
    const sel = this.selected.map((u) => this.meshes.get(u)!).filter(Boolean);
    if (!sel.length) { this.gizmo.detach(); return; }
    if (sel.length === 1) {
      this.pivot.position.copy(sel[0].position);
      this.pivot.quaternion.copy(sel[0].quaternion);
    } else {
      const c = new THREE.Vector3();
      sel.forEach((m) => c.add(m.position));
      this.pivot.position.copy(c.divideScalar(sel.length));
      this.pivot.quaternion.identity();
    }
    this.pivot.updateMatrixWorld(true);
    this.gizmo.attach(this.pivot);
  }

  private beginDrag() {
    const objects = new Map<number, THREE.Matrix4>();
    for (const uid of this.selection) objects.set(uid, this.meshes.get(uid)!.matrix.clone());
    this.dragStart = { pivot: this.pivot.matrix.clone(), objects };
  }

  private applyDrag(commit: boolean) {
    if (!this.dragStart) return;
    this.pivot.updateMatrix();
    const delta = this.pivot.matrix.clone().multiply(this.dragStart.pivot.clone().invert());
    const changes: { uid: number; patch: { position: Vec3; rotation: Vec3 } }[] = [];
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const [uid, start] of this.dragStart.objects) {
      delta.clone().multiply(start).decompose(p, q, s);
      const g = this.meshes.get(uid);
      if (g) { g.position.copy(p); g.quaternion.copy(q); g.updateMatrixWorld(true); }
      changes.push({ uid, patch: { position: [round(p.x), round(p.y), round(p.z)], rotation: quaternionToSamp(q).map(round) as Vec3 } });
    }
    if (!commit) return;
    const moved = !delta.equals(new THREE.Matrix4());
    this.dragStart = null;
    if (moved) this.doc.update(changes, this.gizmo.getMode() === 'rotate' ? 'Поворот' : 'Перемещение');
    this.placePivot();
  }

  // ---------- луч ----------

  pick(clientX: number, clientY: number): PickResult {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return this.pickNdc(ndc);
  }

  pickNdc(ndc: THREE.Vector2, includeObjects = true): PickResult {
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = 3000;
    const targets: THREE.Object3D[] = [this.world.group];
    if (includeObjects) targets.unshift(this.objects);
    const hits = this.raycaster.intersectObjects(targets, true).filter((h) => h.object.visible);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.uid === undefined && o.parent) o = o.parent;
      if (o && o.userData.uid !== undefined) return { kind: 'object', uid: o.userData.uid, point: h.point };
      const wi = this.world.resolveHit(h);
      if (wi !== undefined) return { kind: 'world', worldIndex: wi, point: h.point };
    }
    // Плоскость воды / земли z=0
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, pt) && pt.distanceTo(this.camera.position) < 500) return { kind: 'none', point: pt };
    return { kind: 'none' };
  }

  /** Точка для нового объекта: поверхность в центре экрана или 15 м перед камерой. */
  async spawnPoint(model: number): Promise<Vec3> {
    const hit = this.pickNdc(new THREE.Vector2(0, 0));
    const t = await this.library.get(model);
    const lift = -t.box.min.z;
    if (hit.point && hit.point.distanceTo(this.camera.position) < 300) {
      return [round(hit.point.x), round(hit.point.y), round(hit.point.z + lift)];
    }
    const p = this.camera.position.clone().addScaledVector(this.fly.direction(), 15 + t.box.getSize(new THREE.Vector3()).length());
    return [round(p.x), round(p.y), round(p.z)];
  }

  focusSelection() {
    const sel = this.selected.map((u) => this.meshes.get(u)!).filter(Boolean);
    if (!sel.length) return;
    const box = new THREE.Box3();
    sel.forEach((m) => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length(), 4);
    const dir = this.fly.direction();
    this.camera.position.copy(c).addScaledVector(dir, -r * 1.2);
    this.fly.lookAt(c);
  }

  teleport(p: THREE.Vector3) {
    this.camera.position.copy(p);
  }
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
