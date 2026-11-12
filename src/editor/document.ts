import type { MapObject, MapObjectData } from './types';

export type DocEvent =
  | { type: 'add'; object: MapObject }
  | { type: 'remove'; uid: number }
  | { type: 'update'; object: MapObject }
  | { type: 'reset' };

interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

/** Документ карты: список объектов + история изменений. */
export class MapDocument {
  private objects = new Map<number, MapObject>();
  private nextUid = 1;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<(e: DocEvent) => void>();
  dirty = false;

  on(fn: (e: DocEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: DocEvent) { this.listeners.forEach((l) => l(e)); }

  all(): MapObject[] { return [...this.objects.values()]; }
  get(uid: number) { return this.objects.get(uid); }
  get size() { return this.objects.size; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private run(cmd: Command) {
    cmd.redo();
    this.undoStack.push(cmd);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  undo() {
    const c = this.undoStack.pop();
    if (!c) return;
    c.undo();
    this.redoStack.push(c);
    this.dirty = true;
  }

  redo() {
    const c = this.redoStack.pop();
    if (!c) return;
    c.redo();
    this.undoStack.push(c);
    this.dirty = true;
  }

  private rawAdd(o: MapObject) {
    this.objects.set(o.uid, o);
    this.nextUid = Math.max(this.nextUid, o.uid + 1);
    this.emit({ type: 'add', object: o });
  }

  private rawRemove(uid: number) {
    if (this.objects.delete(uid)) this.emit({ type: 'remove', uid });
  }

  private rawUpdate(o: MapObject) {
    this.objects.set(o.uid, o);
    this.emit({ type: 'update', object: o });
  }

  add(data: MapObjectData[], label = 'Добавить'): MapObject[] {
    const created = data.map((d) => clone({ ...d, uid: this.nextUid++ }));
    this.run({
      label,
      redo: () => created.forEach((o) => this.rawAdd(clone(o))),
      undo: () => created.forEach((o) => this.rawRemove(o.uid)),
    });
    return created.map((o) => this.objects.get(o.uid)!);
  }

  remove(uids: number[], label = 'Удалить') {
    const removed = uids.map((u) => this.objects.get(u)).filter((o): o is MapObject => !!o).map(clone);
    if (!removed.length) return;
    this.run({
      label,
      redo: () => removed.forEach((o) => this.rawRemove(o.uid)),
      undo: () => removed.forEach((o) => this.rawAdd(clone(o))),
    });
  }

  /** Изменение нескольких объектов одной операцией истории. */
  update(changes: { uid: number; patch: Partial<MapObjectData> }[], label = 'Изменить') {
    const before: MapObject[] = [];
    const after: MapObject[] = [];
    for (const { uid, patch } of changes) {
      const cur = this.objects.get(uid);
      if (!cur) continue;
      before.push(clone(cur));
      after.push(clone({ ...cur, ...patch }));
    }
    if (!after.length) return;
    this.run({
      label,
      redo: () => after.forEach((o) => this.rawUpdate(clone(o))),
      undo: () => before.forEach((o) => this.rawUpdate(clone(o))),
    });
  }

  /** Полная замена содержимого (открытие проекта). История очищается. */
  load(data: MapObjectData[]) {
    this.objects.clear();
    this.nextUid = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ type: 'reset' });
    for (const d of data) this.rawAdd(clone({ ...d, uid: this.nextUid++ }));
    this.dirty = false;
  }
}

function clone<T extends MapObject>(o: T): T {
  return { ...o, position: [...o.position], rotation: [...o.rotation] } as T;
}
