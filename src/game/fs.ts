/** Доступ к файлам папки GTA SA. Пути — относительные, регистр не важен. */
export interface GameFS {
  readonly label: string;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
}

export const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();

/** Браузер: файлы из <input webkitdirectory>. */
export class FileListFS implements GameFS {
  private files = new Map<string, File>();
  readonly label: string;

  constructor(list: Iterable<File>) {
    let root = '';
    for (const f of list) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split('/');
      if (!root && parts.length > 1) root = parts[0];
      // Отбрасываем имя выбранной папки — пути считаются от корня игры.
      const inner = parts.length > 1 ? parts.slice(1).join('/') : rel;
      this.files.set(normPath(inner), f);
    }
    this.label = root || 'GTA San Andreas';
  }

  private get(path: string) {
    const f = this.files.get(normPath(path));
    if (!f) throw new Error(`Файл не найден: ${path}`);
    return f;
  }

  async exists(path: string) { return this.files.has(normPath(path)); }
  async readFile(path: string) { return new Uint8Array(await this.get(path).arrayBuffer()); }
  async readRange(path: string, offset: number, length: number) {
    return new Uint8Array(await this.get(path).slice(offset, offset + length).arrayBuffer());
  }
}

/** Electron: чтение через preload-мост. */
export class NativeFS implements GameFS {
  constructor(readonly root: string, readonly label = root) {}
  exists(path: string) { return window.mappin!.exists(this.root, path); }
  readFile(path: string) { return window.mappin!.readFile(this.root, path); }
  readRange(path: string, offset: number, length: number) { return window.mappin!.readRange(this.root, path, offset, length); }
}

/** Файлы в памяти — для тестов и демо. */
export class MemoryFS implements GameFS {
  private files = new Map<string, Uint8Array>();
  constructor(files: Record<string, Uint8Array | string>, readonly label = 'memory') {
    for (const [k, v] of Object.entries(files)) this.files.set(normPath(k), typeof v === 'string' ? new TextEncoder().encode(v) : v);
  }
  async exists(path: string) { return this.files.has(normPath(path)); }
  async readFile(path: string) {
    const f = this.files.get(normPath(path));
    if (!f) throw new Error(`Файл не найден: ${path}`);
    return f;
  }
  async readRange(path: string, offset: number, length: number) { return (await this.readFile(path)).slice(offset, offset + length); }
}
