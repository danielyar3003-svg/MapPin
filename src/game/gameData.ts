import { decodeText } from '../formats/binary';
import { parseGameDat, type GameDat } from '../formats/dat';
import { parseIde, parseTxdParents, type ObjectDef } from '../formats/ide';
import { imgV2HeaderSize, parseImgV2Directory } from '../formats/img';
import { isBinaryIpl, parseBinaryIpl, parseTextIpl, type Placement } from '../formats/ipl';
import { normPath, type GameFS } from './fs';

export interface ArchiveEntry { archive: string; offset: number; size: number }

export interface WorldInstance {
  index: number;
  def: ObjectDef;
  position: [number, number, number];
  rotation: [number, number, number, number];
  interior: number;
  /** Индекс LOD-родителя в world или -1. */
  lod: number;
  /** Есть ли у объекта HD-потомки (значит, он сам — LOD). */
  isLod: boolean;
}

export interface GameData {
  fs: GameFS;
  defs: Map<number, ObjectDef>;
  defsByName: Map<string, ObjectDef>;
  txdParents: Map<string, string>;
  files: Map<string, ArchiveEntry>;
  world: WorldInstance[];
  warnings: string[];
}

/** Файлы, которые клиент SA-MP / open.mp добавляет к игре (объекты 18631+). */
const EXTRA_IDE = ['SAMP/SAMP.ide', 'SAMP/custom.ide'];
const EXTRA_IMG = ['SAMP/SAMP.img', 'SAMP/custom.img'];

export type Progress = (msg: string) => void;

export async function loadGameData(fs: GameFS, progress: Progress = () => {}): Promise<GameData> {
  const warnings: string[] = [];
  const text = async (p: string) => decodeText(await fs.readFile(p));

  if (!(await fs.exists('data/gta.dat'))) {
    throw new Error('В папке нет data/gta.dat — выберите корневую папку GTA San Andreas');
  }
  progress('Читаю data/gta.dat');
  const dat: GameDat = { ide: [], ipl: [], img: [] };
  if (await fs.exists('data/default.dat')) parseGameDat(await text('data/default.dat'), dat);
  parseGameDat(await text('data/gta.dat'), dat);

  const imgs = unique(['models/gta3.img', ...dat.img, ...EXTRA_IMG]);
  const files = new Map<string, ArchiveEntry>();
  for (const img of imgs) {
    if (!(await fs.exists(img))) { if (!EXTRA_IMG.includes(img)) warnings.push(`Нет архива ${img}`); continue; }
    progress(`Читаю каталог ${img}`);
    try {
      const head = await fs.readRange(img, 0, 8);
      const dir = parseImgV2Directory(await fs.readRange(img, 0, imgV2HeaderSize(head)));
      for (const e of dir) {
        const key = e.name.toLowerCase();
        if (!files.has(key)) files.set(key, { archive: img, offset: e.offset, size: e.size });
      }
    } catch (e) {
      warnings.push(`${img}: ${(e as Error).message}`);
    }
  }

  const defs = new Map<number, ObjectDef>();
  const defsByName = new Map<string, ObjectDef>();
  const txdParents = new Map<string, string>();
  const ides = unique([...dat.ide, ...EXTRA_IDE]);
  for (const ide of ides) {
    if (!(await fs.exists(ide))) { if (!EXTRA_IDE.includes(ide)) warnings.push(`Нет файла ${ide}`); continue; }
    progress(`Читаю ${ide}`);
    const t = await text(ide);
    for (const d of parseIde(t)) {
      defs.set(d.id, d);
      defsByName.set(d.model, d);
    }
    for (const [c, p] of parseTxdParents(t)) txdParents.set(c, p);
  }

  progress('Читаю расстановку карты (IPL)');
  const world: WorldInstance[] = [];
  const streamsByBase = new Map<string, string[]>();
  for (const name of files.keys()) {
    const m = /^(.+)_stream\d+\.ipl$/.exec(name);
    if (m) {
      const list = streamsByBase.get(m[1]) ?? [];
      list.push(name);
      streamsByBase.set(m[1], list);
    }
  }

  /** Добавляет записи IPL. lodTable переводит индекс LOD из файла в индекс world. */
  const push = (placements: Placement[], lodTable: number[]) => {
    for (const p of placements) {
      const def = defs.get(p.id) ?? (p.model ? defsByName.get(p.model) : undefined);
      if (!def) continue;
      world.push({
        index: world.length, def, position: p.position, rotation: p.rotation, interior: p.interior,
        lod: p.lod >= 0 && p.lod < lodTable.length ? lodTable[p.lod] : -1, isLod: false,
      });
    }
  };

  for (const ipl of dat.ipl) {
    let textPlacements: Placement[] = [];
    if (await fs.exists(ipl)) {
      try {
        const bytes = await fs.readFile(ipl);
        textPlacements = isBinaryIpl(bytes) ? parseBinaryIpl(bytes) : parseTextIpl(decodeText(bytes));
      } catch (e) { warnings.push(`${ipl}: ${(e as Error).message}`); }
    } else warnings.push(`Нет файла ${ipl}`);

    // Индексы LOD в файле считаются по всем inst, включая неизвестные модели.
    const table: number[] = [];
    let n = world.length;
    for (const p of textPlacements) table.push(defs.has(p.id) || defsByName.has(p.model) ? n++ : -1);
    push(textPlacements, table);

    // Stream-файлы (*_streamN.ipl в gta3.img) ссылаются на LOD из текстового IPL.
    const stem = normPath(ipl).split('/').pop()!.replace(/\.ipl$/, '');
    for (const s of (streamsByBase.get(stem) ?? []).sort(streamOrder)) {
      const e = files.get(s)!;
      try {
        push(parseBinaryIpl(await fs.readRange(e.archive, e.offset, e.size)), table);
      } catch (err) { warnings.push(`${s}: ${(err as Error).message}`); }
    }
  }

  for (const w of world) if (w.lod >= 0 && world[w.lod]) world[w.lod].isLod = true;

  progress(`Готово: ${defs.size} моделей, ${world.length} объектов карты`);
  return { fs, defs, defsByName, txdParents, files, world, warnings };
}

function streamOrder(a: string, b: string) {
  const n = (s: string) => parseInt(/_stream(\d+)/.exec(s)![1], 10);
  return n(a) - n(b);
}

function unique(list: string[]) {
  const seen = new Set<string>();
  return list.filter((p) => { const k = normPath(p); if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function readArchiveFile(data: GameData, name: string): Promise<Uint8Array | null> {
  const e = data.files.get(name.toLowerCase());
  if (!e) return null;
  return data.fs.readRange(e.archive, e.offset, e.size);
}
