import { sections } from './text';

export interface ObjectDef {
  id: number;
  model: string;
  txd: string;
  drawDistance: number;
  flags: number;
  /** Время появления/исчезновения для tobj. */
  timeOn?: number;
  timeOff?: number;
  section: 'objs' | 'tobj' | 'anim';
}

/** Разбор IDE: секции objs, tobj, anim. Остальные секции пропускаются. */
export function parseIde(text: string): ObjectDef[] {
  const out: ObjectDef[] = [];
  for (const { name, fields } of sections(text)) {
    if (name !== 'objs' && name !== 'tobj' && name !== 'anim') continue;
    if (fields.length < 4) continue;
    const id = parseInt(fields[0], 10);
    if (!Number.isFinite(id)) continue;
    const model = fields[1].toLowerCase();
    const txd = fields[2].toLowerCase();
    let drawDistance: number;
    let flags: number;
    let rest: string[];
    if (name === 'anim') {
      // id, model, txd, anim, drawDist, flags
      drawDistance = parseFloat(fields[4]);
      flags = parseInt(fields[5] ?? '0', 10);
      rest = [];
    } else {
      // Варианты objs: (id,model,txd,dist,flags) или (id,model,txd,meshCount,dist...,flags)
      const n = fields.length - (name === 'tobj' ? 2 : 0);
      if (n === 5) {
        drawDistance = parseFloat(fields[3]);
        flags = parseInt(fields[4], 10);
      } else {
        const meshCount = parseInt(fields[3], 10);
        drawDistance = parseFloat(fields[4]);
        flags = parseInt(fields[4 + meshCount] ?? '0', 10);
      }
      rest = name === 'tobj' ? fields.slice(-2) : [];
    }
    const def: ObjectDef = { id, model, txd, drawDistance: drawDistance || 300, flags: flags || 0, section: name };
    if (rest.length === 2) {
      def.timeOn = parseInt(rest[0], 10);
      def.timeOff = parseInt(rest[1], 10);
    }
    out.push(def);
  }
  return out;
}

/** Секция txdp: пары (дочерний TXD, родительский TXD). */
export function parseTxdParents(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const { name, fields } of sections(text)) {
    if (name === 'txdp' && fields.length >= 2) out.push([fields[0].toLowerCase(), fields[1].toLowerCase()]);
  }
  return out;
}
