import { splitLines, splitFields } from './text';

export interface GameDat {
  ide: string[];
  ipl: string[];
  img: string[];
}

/** Разбор default.dat / gta.dat: строки IDE, IPL, IMG. Пути — как в файле, с "\" заменёнными на "/". */
export function parseGameDat(text: string, into: GameDat = { ide: [], ipl: [], img: [] }): GameDat {
  for (const line of splitLines(text)) {
    if (!line) continue;
    const [kind, ...rest] = splitFields(line);
    const path = rest.join(' ').replace(/\\/g, '/');
    switch (kind.toUpperCase()) {
      case 'IDE': into.ide.push(path); break;
      case 'IPL': into.ipl.push(path); break;
      case 'IMG':
      case 'CDIMAGE': into.img.push(path); break;
    }
  }
  return into;
}
