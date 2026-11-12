import { count } from '../ui/plural';
import type { MapObjectData } from '../editor/types';

export type PawnFunction = 'CreateObject' | 'CreateDynamicObject';

export interface PawnExportOptions {
  fn: PawnFunction;
  /** Дистанция стрима по умолчанию для CreateDynamicObject. */
  streamDistance: number;
  /** Знаков после запятой. */
  precision: number;
}

export const defaultPawnOptions: PawnExportOptions = { fn: 'CreateDynamicObject', streamDistance: 300, precision: 4 };

function f(v: number, p: number): string {
  const s = v.toFixed(p);
  // 12.5000 -> 12.5, 3.0000 -> 3.0
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.0') : s + '.0';
}

export function exportPawn(objects: MapObjectData[], opts: PawnExportOptions = defaultPawnOptions): string {
  const p = opts.precision;
  const lines = objects.map((o) => {
    const base = `${o.model}, ${f(o.position[0], p)}, ${f(o.position[1], p)}, ${f(o.position[2], p)}, ${f(o.rotation[0], p)}, ${f(o.rotation[1], p)}, ${f(o.rotation[2], p)}`;
    let line: string;
    if (opts.fn === 'CreateObject') {
      line = o.drawDistance > 0 ? `CreateObject(${base}, ${f(o.drawDistance, 1)});` : `CreateObject(${base});`;
    } else {
      const dist = o.drawDistance > 0 ? o.drawDistance : opts.streamDistance;
      line = `CreateDynamicObject(${base}, ${o.world}, ${o.interior}, -1, ${f(dist, 1)}, ${f(dist, 1)});`;
    }
    return o.comment ? `${line} // ${o.comment.replace(/[\r\n]+/g, ' ')}` : line;
  });
  const header = `// MapPin: ${count(objects.length, 'объект', 'объекта', 'объектов')}`;
  return [header, ...lines].join('\n') + '\n';
}

const CALL = /\b(CreateDynamicObjectEx|CreateDynamicObject|CreateObject|CreatePlayerObject)\s*\(([^;]*?)\)\s*;/g;

/** Разбор вызовов CreateObject / CreateDynamicObject(Ex) / CreatePlayerObject из Pawn-кода. */
export function importPawn(code: string): { objects: MapObjectData[]; skipped: number } {
  const objects: MapObjectData[] = [];
  let skipped = 0;
  const clean = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const m of clean.matchAll(CALL)) {
    const fn = m[1];
    let args = splitArgs(m[2]);
    if (fn === 'CreatePlayerObject') args = args.slice(1);
    const nums = args.map(parseNumber);
    if (nums.length < 7 || nums.slice(0, 7).some((n) => n === null)) { skipped++; continue; }
    const [model, x, y, z, rx, ry, rz] = nums as number[];
    const o: MapObjectData = { model, position: [x, y, z], rotation: [rx, ry, rz], world: -1, interior: -1, drawDistance: 0 };
    if (fn === 'CreateDynamicObject') {
      o.world = nums[7] ?? -1;
      o.interior = nums[8] ?? -1;
      o.drawDistance = nums[10] ?? 0;
    } else if (fn === 'CreateDynamicObjectEx') {
      o.drawDistance = nums[7] ?? 0;
    } else {
      o.drawDistance = nums[7] ?? 0;
    }
    if (!Number.isInteger(model)) { skipped++; continue; }
    objects.push(o);
  }
  return { objects, skipped };
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseNumber(s: string): number | null {
  const t = s.replace(/^\s*(?:Float:)?/, '').trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  return null;
}
