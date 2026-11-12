import * as THREE from 'three';
import { MapDocument } from '../editor/document';
import { defaultObject, type MapObject, type MapObjectData } from '../editor/types';
import { Viewport } from '../editor/viewport';
import { isTyping } from '../editor/flyCamera';
import { parseProject, serializeProject } from '../editor/project';
import { defaultPawnOptions, exportPawn, importPawn, type PawnFunction } from '../export/pawn';
import { iplQuaternion, quaternionToSamp, type Vec3 } from '../export/rotation';
import { FileListFS, NativeFS, type GameFS } from '../game/fs';
import { loadGameData, type GameData } from '../game/gameData';
import { ModelLibrary } from '../game/models';
import type { ObjectDef } from '../formats/ide';
import { dialog, h } from './dom';
import { count } from './plural';
import { openTextFile, pickDirectoryFiles, saveTextFile, storageGet, storageSet } from './files';

const ROW = 24;
const AUTOSAVE_KEY = 'mappin.autosave';

export class App {
  readonly doc = new MapDocument();
  readonly library = new ModelLibrary(null);
  readonly viewport: Viewport;
  game: GameData | null = null;
  private browserModel: number | null = null;
  private browserFilter = '';
  private browserTab: 'all' | 'samp' = 'all';
  private browserDefs: ObjectDef[] = [];
  private clipboard: MapObjectData[] = [];
  private projectPath: string | null = null;
  private els = {} as Record<string, HTMLElement>;

  constructor(root: HTMLElement) {
    this.viewport = new Viewport(root.querySelector('#viewport')!, this.doc, this.library);
    this.buildToolbar(root.querySelector('#toolbar')!);
    this.buildLeft(root.querySelector('#left')!);
    this.buildRight(root.querySelector('#right')!);
    this.buildStatus(root.querySelector('#status')!);
    this.els.hint = root.querySelector('#hint')!;
    this.els.hint.textContent = 'ПКМ + мышь — обзор · ПКМ + WASD/Q/E — полёт · колесо с ПКМ — скорость · ЛКМ — выбрать · F1 — справка';

    this.viewport.onSelectionChange = () => { this.renderProps(); this.renderObjectList(); };
    this.doc.on(() => { this.renderObjectList(); this.renderProps(); this.updateButtons(); this.autosave(); });
    this.setupPointer();
    this.setupKeys();
    this.restoreAutosave();
    this.updateButtons();
    this.renderBrowser();
    window.addEventListener('beforeunload', (e) => { if (this.doc.dirty && !window.mappin) e.preventDefault(); });
    void this.restoreGameFolder();
  }

  // ---------------- toolbar ----------------

  private buildToolbar(tb: HTMLElement) {
    const btn = (id: string, label: string, onclick: () => void, title = '', cls = '') => {
      const b = h('button', { id, title, onclick, class: cls }, label);
      this.els[id] = b;
      return b;
    };
    const snapSel = h('select', { id: 'snap', title: 'Шаг перемещения', onchange: () => this.applySnap() },
      ...['выкл', '0.1', '0.25', '0.5', '1', '5'].map((v) => h('option', { value: v }, v === 'выкл' ? 'без шага' : `${v} м`)));
    const angSel = h('select', { id: 'angle', title: 'Шаг поворота', onchange: () => this.applySnap() },
      ...['выкл', '5', '15', '45', '90'].map((v) => h('option', { value: v }, v === 'выкл' ? 'без шага' : `${v}°`)));
    this.els.snap = snapSel;
    this.els.angle = angSel;
    tb.append(
      btn('openGame', 'Папка GTA SA', () => this.openGame(), 'Загрузить карту и модели из установленной игры', 'primary'),
      h('div', { class: 'sep' }),
      btn('newProj', 'Новый', () => this.newProject()),
      btn('openProj', 'Открыть', () => this.openProject(), 'Открыть проект .mappin.json (Ctrl+O)'),
      btn('saveProj', 'Сохранить', () => this.saveProject(), 'Сохранить проект (Ctrl+S)'),
      h('div', { class: 'sep' }),
      btn('importPawn', 'Импорт Pawn', () => this.importPawnDialog()),
      btn('exportPawn', 'Экспорт Pawn', () => this.exportPawnDialog(), 'Код CreateObject / CreateDynamicObject'),
      h('div', { class: 'sep' }),
      btn('undo', 'Отменить', () => this.doc.undo(), 'Ctrl+Z'),
      btn('redo', 'Повторить', () => this.doc.redo(), 'Ctrl+Y'),
      h('div', { class: 'sep' }),
      btn('modeMove', 'Перемещение', () => this.setMode('translate'), 'G', 'active'),
      btn('modeRotate', 'Поворот', () => this.setMode('rotate'), 'R'),
      btn('space', 'Локально', () => this.toggleSpace(), 'Оси гизмо: локальные или мировые (L)'),
      h('span', { class: 'tb-label' }, 'Шаг'), snapSel, angSel,
      h('div', { class: 'sep' }),
      btn('help', 'Справка', () => this.helpDialog(), 'F1'),
    );
  }

  private setMode(mode: 'translate' | 'rotate') {
    this.viewport.gizmo.setMode(mode);
    this.els.modeMove.classList.toggle('active', mode === 'translate');
    this.els.modeRotate.classList.toggle('active', mode === 'rotate');
  }

  private toggleSpace() {
    const g = this.viewport.gizmo;
    g.setSpace(g.space === 'local' ? 'world' : 'local');
    this.els.space.textContent = g.space === 'local' ? 'Локально' : 'Мир';
  }

  private applySnap() {
    const s = (this.els.snap as HTMLSelectElement).value;
    const a = (this.els.angle as HTMLSelectElement).value;
    this.viewport.gizmo.setTranslationSnap(s === 'выкл' ? null : parseFloat(s));
    this.viewport.gizmo.setRotationSnap(a === 'выкл' ? null : THREE.MathUtils.degToRad(parseFloat(a)));
  }

  private updateButtons() {
    (this.els.undo as HTMLButtonElement).disabled = !this.doc.canUndo;
    (this.els.redo as HTMLButtonElement).disabled = !this.doc.canRedo;
  }

  // ---------------- left: browser ----------------

  private buildLeft(left: HTMLElement) {
    const search = h('input', { id: 'search', type: 'search', placeholder: 'Поиск: id или имя модели', oninput: (e: Event) => { this.browserFilter = (e.target as HTMLInputElement).value; this.renderBrowser(); } });
    const tabAll = h('button', { class: 'active', onclick: () => this.setTab('all') }, 'Все');
    const tabSamp = h('button', { onclick: () => this.setTab('samp') }, 'SA-MP 18631+');
    this.els.tabAll = tabAll; this.els.tabSamp = tabSamp;
    const list = h('div', { class: 'list', id: 'browser' });
    list.addEventListener('scroll', () => this.renderBrowserRows());
    new ResizeObserver(() => this.renderBrowserRows()).observe(list);
    this.els.browser = list;
    const idInput = h('input', { id: 'modelId', type: 'number', placeholder: 'ID модели', min: 0 }) as HTMLInputElement;
    const add = h('button', { id: 'placeBtn', class: 'primary', onclick: () => {
      const id = idInput.value ? parseInt(idInput.value, 10) : this.browserModel;
      if (id !== null && Number.isFinite(id)) void this.placeModel(id);
    } }, 'Поставить');
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
    this.els.modelId = idInput;
    left.append(
      h('div', { class: 'section grow' },
        h('h3', {}, 'Объекты игры'),
        h('div', { class: 'row' }, search),
        h('div', { class: 'tabs' }, tabAll, tabSamp),
        list,
        h('div', { class: 'row', style: 'padding-top:8px' }, idInput, add),
      ),
    );
  }

  private setTab(t: 'all' | 'samp') {
    this.browserTab = t;
    this.els.tabAll.classList.toggle('active', t === 'all');
    this.els.tabSamp.classList.toggle('active', t === 'samp');
    this.renderBrowser();
  }

  private renderBrowser() {
    const defs = this.game ? [...this.game.defs.values()] : [];
    const q = this.browserFilter.trim().toLowerCase();
    this.browserDefs = defs
      .filter((d) => (this.browserTab === 'samp' ? d.id >= 18631 : true))
      .filter((d) => !q || String(d.id).startsWith(q) || d.model.includes(q))
      .filter((d) => !d.model.startsWith('lod'))
      .sort((a, b) => a.id - b.id);
    const list = this.els.browser;
    list.scrollTop = 0;
    this.renderBrowserRows();
  }

  private renderBrowserRows() {
    const list = this.els.browser;
    list.replaceChildren();
    if (!this.game) {
      list.append(h('div', { class: 'empty' }, 'Откройте папку GTA San Andreas, чтобы увидеть модели. Без игры объекты можно ставить по ID — они будут показаны коробками.'));
      return;
    }
    if (!this.browserDefs.length) { list.append(h('div', { class: 'empty' }, 'Ничего не найдено')); return; }
    const spacer = h('div', { style: `height:${this.browserDefs.length * ROW}px` });
    list.append(spacer);
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 5);
    const last = Math.min(this.browserDefs.length, first + Math.ceil(list.clientHeight / ROW) + 10);
    for (let i = first; i < last; i++) {
      const d = this.browserDefs[i];
      const row = h('div', {
        class: 'item' + (d.id === this.browserModel ? ' sel' : ''),
        style: `top:${i * ROW}px`,
        title: `${d.model} · txd: ${d.txd} · дистанция ${d.drawDistance}`,
        onclick: () => { this.browserModel = d.id; (this.els.modelId as HTMLInputElement).value = String(d.id); this.renderBrowserRows(); },
        ondblclick: () => void this.placeModel(d.id),
      }, h('span', { class: 'id' }, String(d.id)), h('span', { class: 'name' }, d.model));
      list.append(row);
    }
  }

  modelName(id: number) { return this.game?.defs.get(id)?.model ?? (this.game ? 'нет в игре' : ''); }

  async placeModel(id: number) {
    if (this.game && !this.game.defs.has(id)) this.setMessage(`Модели ${id} нет в файлах игры — ставлю коробку`);
    const pos = await this.viewport.spawnPoint(id);
    const [o] = this.doc.add([defaultObject(id, pos)], 'Поставить объект');
    this.viewport.setSelection([o.uid]);
  }

  // ---------------- right: objects & properties ----------------

  private buildRight(right: HTMLElement) {
    this.els.objCount = h('span');
    this.els.objects = h('div', { class: 'list flow', id: 'objects' });
    this.els.props = h('div', { id: 'props' });
    right.append(
      h('div', { class: 'section grow' }, h('h3', {}, 'Объекты проекта ', this.els.objCount), this.els.objects),
      h('div', { class: 'section', style: 'min-height: 230px' }, h('h3', {}, 'Свойства'), this.els.props),
    );
    this.renderObjectList();
    this.renderProps();
  }

  private renderObjectList() {
    const list = this.els.objects;
    const objs = this.doc.all();
    this.els.objCount.textContent = objs.length ? `(${objs.length})` : '';
    list.replaceChildren();
    if (!objs.length) { list.append(h('div', { class: 'empty' }, 'Пока пусто. Выберите модель слева и нажмите «Поставить».')); return; }
    const sel = new Set(this.viewport.selected);
    for (const o of objs.slice(-2000)) {
      list.append(h('div', {
        class: 'item' + (sel.has(o.uid) ? ' sel' : ''),
        onclick: (e: MouseEvent) => this.clickSelect(o.uid, e.shiftKey || e.ctrlKey),
        ondblclick: () => this.viewport.focusSelection(),
      }, h('span', { class: 'id' }, String(o.model)), h('span', { class: 'name' }, this.modelName(o.model)), o.comment ? h('span', { class: 'note' }, o.comment) : null));
    }
  }

  private clickSelect(uid: number, additive: boolean) {
    const cur = new Set(this.viewport.selected);
    if (additive) { if (cur.has(uid)) cur.delete(uid); else cur.add(uid); this.viewport.setSelection([...cur]); }
    else this.viewport.setSelection([uid]);
  }

  private renderProps() {
    const box = this.els.props;
    box.replaceChildren();
    const sel = this.viewport.selected.map((u) => this.doc.get(u)!).filter(Boolean);
    if (!sel.length) { box.append(h('div', { class: 'empty' }, 'Ничего не выбрано')); return; }
    if (sel.length > 1) {
      box.append(h('div', { class: 'empty' }, `Выбрано объектов: ${sel.length}`),
        h('div', { class: 'row' }, h('button', { onclick: () => this.duplicate() }, 'Дублировать'), h('button', { class: 'danger', onclick: () => this.deleteSelected() }, 'Удалить')));
      return;
    }
    const o = sel[0];
    const num = (value: number, apply: (v: number) => Partial<MapObjectData>, step = '0.1', name = '') => {
      const i = h('input', { type: 'number', step, value: String(value), 'data-field': name }) as HTMLInputElement;
      i.addEventListener('change', () => {
        const v = parseFloat(i.value);
        if (Number.isFinite(v)) this.doc.update([{ uid: o.uid, patch: apply(v) }]);
      });
      return i;
    };
    const vec = (v: Vec3, key: 'position' | 'rotation', step: string) => [0, 1, 2].map((k) => num(v[k], (x) => {
      const n = [...v] as Vec3; n[k] = x; return { [key]: n };
    }, step, `${key}${k}`));
    const comment = h('input', { class: 'wide', value: o.comment ?? '', placeholder: 'необязательно' }) as HTMLInputElement;
    comment.addEventListener('change', () => this.doc.update([{ uid: o.uid, patch: { comment: comment.value || undefined } }]));
    box.append(h('div', { class: 'props' },
      h('label', {}, 'Модель'), num(o.model, (v) => ({ model: Math.round(v) }), '1', 'model'), h('span', { class: 'wide', style: 'grid-column: span 2; color: var(--muted); overflow:hidden; text-overflow:ellipsis' }, this.modelName(o.model)),
      h('label', {}, 'Позиция'), ...vec(o.position, 'position', '0.1'),
      h('label', {}, 'Поворот'), ...vec(o.rotation, 'rotation', '1'),
      h('label', {}, 'Мир / инт.'), num(o.world, (v) => ({ world: Math.round(v) }), '1'), num(o.interior, (v) => ({ interior: Math.round(v) }), '1'), h('span'),
      h('label', { title: '0 — по умолчанию' }, 'Дистанция'), num(o.drawDistance, (v) => ({ drawDistance: Math.max(0, v) }), '10'), h('span'), h('span'),
      h('label', {}, 'Заметка'), comment,
    ), h('div', { class: 'row' },
      h('button', { onclick: () => this.viewport.focusSelection() }, 'Показать'),
      h('button', { onclick: () => this.duplicate() }, 'Дублировать'),
      h('button', { class: 'danger', onclick: () => this.deleteSelected() }, 'Удалить')));
  }

  // ---------------- status ----------------

  private buildStatus(st: HTMLElement) {
    const cam = h('span'), stats = h('span'), msg = h('span', { class: 'msg' });
    st.append(cam, stats, msg);
    this.els.msg = msg;
    let last = 0;
    this.viewport.onFrame = () => {
      const now = performance.now();
      if (now - last < 250) return;
      last = now;
      const p = this.viewport.camera.position;
      cam.textContent = `Камера ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · скорость ${this.viewport.fly.speed.toFixed(0)}`;
      stats.textContent = `${Math.round(this.viewport.fps)} FPS` + (this.game ? ` · карта: ${this.viewport.world.visibleCount} видно, ${this.viewport.world.loadedModels} моделей` : '');
    };
  }

  setMessage(m: string) {
    this.els.msg.textContent = m;
  }

  // ---------------- pointer & keys ----------------

  private setupPointer() {
    const canvas = this.viewport.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
      down = null;
      if (moved || this.viewport.gizmo.dragging || (this.viewport.gizmo as unknown as { axis: string | null }).axis) return;
      const hit = this.viewport.pick(e.clientX, e.clientY);
      if (hit.kind === 'object') this.clickSelect(hit.uid!, e.shiftKey || e.ctrlKey);
      else {
        if (!e.shiftKey && !e.ctrlKey) this.viewport.setSelection([]);
        if (hit.kind === 'world') {
          const w = this.viewport.world.instance(hit.worldIndex!)!;
          this.setMessage(`Здание карты: ${w.def.id} ${w.def.model} — Alt+клик скопирует его в проект`);
          if (e.altKey) this.copyWorldInstance(hit.worldIndex!);
          else { this.browserModel = w.def.id; (this.els.modelId as HTMLInputElement).value = String(w.def.id); this.renderBrowserRows(); }
        }
      }
    });
  }

  private copyWorldInstance(index: number) {
    const w = this.viewport.world.instance(index)!;
    const rot = quaternionToSamp(iplQuaternion(w.rotation)).map((v) => Math.round(v * 1e4) / 1e4) as Vec3;
    const [o] = this.doc.add([{ ...defaultObject(w.def.id, [...w.position]), rotation: rot }], 'Копия здания');
    this.viewport.setSelection([o.uid]);
  }

  private setupKeys() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const code = e.code;
      if (ctrl && code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); this.doc.undo(); }
      else if (ctrl && (code === 'KeyY' || (code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); this.doc.redo(); }
      else if (ctrl && code === 'KeyS') { e.preventDefault(); void this.saveProject(); }
      else if (ctrl && code === 'KeyO') { e.preventDefault(); void this.openProject(); }
      else if (ctrl && code === 'KeyD') { e.preventDefault(); this.duplicate(); }
      else if (ctrl && code === 'KeyC') { this.copy(); }
      else if (ctrl && code === 'KeyV') { this.paste(); }
      else if (ctrl && code === 'KeyA') { e.preventDefault(); this.viewport.setSelection(this.doc.all().map((o) => o.uid)); }
      else if (ctrl) return;
      else if (this.viewport.fly.isLooking) return;
      else if (k === 'delete' || k === 'backspace') this.deleteSelected();
      else if (code === 'KeyG' || code === 'KeyT') this.setMode('translate');
      else if (code === 'KeyR') this.setMode('rotate');
      else if (code === 'KeyL') this.toggleSpace();
      else if (code === 'KeyF') this.viewport.focusSelection();
      else if (k === 'escape') this.viewport.setSelection([]);
      else if (k === 'f1') { e.preventDefault(); this.helpDialog(); }
    });
  }

  private copy() {
    this.clipboard = this.viewport.selected.map((u) => this.doc.get(u)!).filter(Boolean).map(strip);
    if (this.clipboard.length) this.setMessage(`Скопировано: ${this.clipboard.length}`);
  }

  private paste() {
    if (!this.clipboard.length) return;
    const added = this.doc.add(this.clipboard, 'Вставить');
    this.viewport.setSelection(added.map((o) => o.uid));
  }

  duplicate() {
    const sel = this.viewport.selected.map((u) => this.doc.get(u)!).filter(Boolean);
    if (!sel.length) return;
    const added = this.doc.add(sel.map(strip), 'Дублировать');
    this.viewport.setSelection(added.map((o) => o.uid));
    this.setMessage(`Дублировано: ${added.length}. Копии стоят на месте оригиналов — сдвиньте их гизмо.`);
  }

  deleteSelected() {
    const sel = this.viewport.selected;
    if (sel.length) this.doc.remove(sel);
  }

  // ---------------- game folder ----------------

  async openGame() {
    if (window.mappin) {
      const root = await window.mappin.pickGameFolder();
      if (!root) return;
      await window.mappin.setSetting('gameFolder', root);
      await this.loadGame(new NativeFS(root));
    } else {
      const files = await pickDirectoryFiles();
      if (files?.length) await this.loadGame(new FileListFS(files));
    }
  }

  private async restoreGameFolder() {
    if (!window.mappin) return;
    const root = await window.mappin.getSetting('gameFolder');
    if (typeof root === 'string' && root) await this.loadGame(new NativeFS(root)).catch(() => {});
  }

  async loadGame(fs: GameFS) {
    const overlay = h('div', { class: 'loading' }, 'Загрузка…');
    this.viewport.renderer.domElement.parentElement!.append(overlay);
    try {
      const data = await loadGameData(fs, (m) => (overlay.textContent = m));
      this.game = data;
      this.library.setData(data);
      this.viewport.world.setData(data);
      this.viewport.setGameLoaded(true);
      this.viewport.rebuildObjects();
      this.renderBrowser();
      this.renderObjectList();
      this.renderProps();
      if (!this.doc.size) {
        // Площадь у мэрии Лос-Сантоса
        this.viewport.teleport(new THREE.Vector3(1480, -1680, 60));
        this.viewport.fly.lookAt(new THREE.Vector3(1480, -1760, 14));
      }
      this.setMessage(`Игра загружена: ${fs.label} — ${count(data.defs.size, 'модель', 'модели', 'моделей')}, объектов карты: ${data.world.length}` + (data.warnings.length ? ` · предупреждений: ${data.warnings.length}` : ''));
      if (data.warnings.length) console.warn(data.warnings);
    } catch (e) {
      this.setMessage(`Не удалось загрузить игру: ${(e as Error).message}`);
      dialog('Не удалось загрузить игру', [h('div', {}, (e as Error).message)], [{ label: 'OK', primary: true }]);
    } finally {
      overlay.remove();
    }
  }

  // ---------------- projects ----------------

  private confirmDiscard() {
    return !this.doc.dirty || !this.doc.size || confirm('Несохранённые изменения пропадут. Продолжить?');
  }

  newProject() {
    if (!this.confirmDiscard()) return;
    this.doc.load([]);
    this.projectPath = null;
  }

  async openProject() {
    if (!this.confirmDiscard()) return;
    const f = await openTextFile(['json', 'mappin'], 'Проект MapPin');
    if (!f) return;
    try {
      this.doc.load(parseProject(f.text));
      this.projectPath = f.path;
      this.setMessage(`Открыт проект ${f.path}: ${count(this.doc.size, 'объект', 'объекта', 'объектов')}`);
      this.viewport.setSelection(this.doc.all().map((o) => o.uid));
      this.viewport.focusSelection();
      this.viewport.setSelection([]);
    } catch (e) {
      dialog('Ошибка', [h('div', {}, (e as Error).message)], [{ label: 'OK', primary: true }]);
    }
  }

  async saveProject() {
    const text = serializeProject(this.doc.all().map(strip));
    const name = this.projectPath?.split(/[\\/]/).pop() ?? 'map.mappin.json';
    const saved = await saveTextFile(name, text, 'json', 'Проект MapPin');
    if (saved) { this.projectPath = saved; this.doc.dirty = false; this.setMessage(`Сохранено: ${saved}`); }
  }

  private autosave() {
    storageSet(AUTOSAVE_KEY, serializeProject(this.doc.all().map(strip)));
  }

  private restoreAutosave() {
    const t = storageGet(AUTOSAVE_KEY);
    if (!t) return;
    try {
      const objs = parseProject(t);
      if (objs.length) { this.doc.load(objs); this.setMessage(`Восстановлен последний проект: ${count(objs.length, 'объект', 'объекта', 'объектов')}`); }
    } catch { /* повреждённый автосейв игнорируем */ }
  }

  // ---------------- pawn ----------------

  exportPawnDialog() {
    const objs = (this.viewport.selected.length > 1 ? this.viewport.selected.map((u) => this.doc.get(u)!) : this.doc.all()).map(strip);
    const fnSel = h('select', {}, h('option', { value: 'CreateDynamicObject' }, 'CreateDynamicObject (Streamer)'), h('option', { value: 'CreateObject' }, 'CreateObject')) as HTMLSelectElement;
    const area = h('textarea', { readonly: true, spellcheck: false, id: 'pawnOut' }) as HTMLTextAreaElement;
    const render = () => { area.value = exportPawn(objs, { ...defaultPawnOptions, fn: fnSel.value as PawnFunction }); };
    fnSel.onchange = render;
    render();
    const scope = this.viewport.selected.length > 1 ? `выбранные объекты (${objs.length})` : `все объекты (${objs.length})`;
    dialog('Экспорт в Pawn', [h('div', { class: 'row', style: 'padding:0' }, h('span', {}, `Экспортируются ${scope}. Функция:`), fnSel), area], [
      { label: 'Копировать', onClick: () => { void navigator.clipboard?.writeText(area.value); this.setMessage('Код скопирован'); } },
      { label: 'Сохранить .pwn', onClick: () => void saveTextFile('map.pwn', area.value, 'pwn', 'Pawn') },
      { label: 'Закрыть', primary: true },
    ]);
  }

  importPawnDialog() {
    const area = h('textarea', { spellcheck: false, id: 'pawnIn', placeholder: 'Вставьте код с CreateObject / CreateDynamicObject…' }) as HTMLTextAreaElement;
    const run = (replace: boolean, close: () => void) => {
      const { objects, skipped } = importPawn(area.value);
      if (!objects.length) { this.setMessage('Не найдено ни одного объекта'); return; }
      if (replace) {
        if (!this.confirmDiscard()) return;
        this.doc.load(objects);
      } else {
        const added = this.doc.add(objects, 'Импорт Pawn');
        this.viewport.setSelection(added.map((o) => o.uid));
      }
      close();
      this.viewport.setSelection(this.doc.all().slice(-objects.length).map((o) => o.uid));
      this.viewport.focusSelection();
      this.setMessage(`Импортировано объектов: ${objects.length}` + (skipped ? `, пропущено вызовов с переменными: ${skipped}` : ''));
    };
    dialog('Импорт из Pawn', [area], [
      { label: 'Из файла…', onClick: async () => { const f = await openTextFile(['pwn', 'inc', 'txt', 'p'], 'Pawn'); if (f) area.value = f.text; } },
      { label: 'Заменить проект', onClick: (c) => run(true, c) },
      { label: 'Добавить', primary: true, onClick: (c) => run(false, c) },
    ]);
  }

  helpDialog() {
    const rows: [string, string][] = [
      ['ПКМ + мышь', 'Осмотреться'],
      ['ПКМ + W A S D', 'Лететь'],
      ['ПКМ + Q / E', 'Вниз / вверх'],
      ['Shift', 'Быстрее (×4)'],
      ['ПКМ + колесо', 'Скорость полёта'],
      ['ЛКМ', 'Выбрать объект (Shift/Ctrl — добавить к выбору)'],
      ['ЛКМ по зданию', 'Пипетка: выбрать эту модель в списке'],
      ['Alt + ЛКМ по зданию', 'Скопировать здание карты в проект'],
      ['G / R', 'Перемещение / поворот'],
      ['L', 'Локальные / мировые оси'],
      ['F', 'Показать выбранное'],
      ['Ctrl+D', 'Дублировать'],
      ['Ctrl+C / Ctrl+V', 'Копировать / вставить'],
      ['Delete', 'Удалить'],
      ['Ctrl+Z / Ctrl+Y', 'Отменить / повторить'],
      ['Ctrl+S / Ctrl+O', 'Сохранить / открыть проект'],
      ['Двойной клик в списке', 'Поставить модель'],
    ];
    dialog('Управление', [h('table', {}, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))))], [{ label: 'Закрыть', primary: true }]);
  }
}

function strip(o: MapObject): MapObjectData {
  const { uid: _uid, ...rest } = o;
  return { ...rest, position: [...rest.position], rotation: [...rest.rotation] };
}
