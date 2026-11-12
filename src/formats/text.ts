/** Общие вещи для текстовых файлов GTA (IDE, IPL, DAT). */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => {
    const hash = l.indexOf('#');
    const cut = hash >= 0 ? l.slice(0, hash) : l;
    return cut.trim();
  });
}

export function splitFields(line: string): string[] {
  return line.split(/[\s,]+/).filter((s) => s.length > 0);
}

/** Перебирает секции вида `name ... end`. */
export function* sections(text: string): Generator<{ name: string; line: string; fields: string[] }> {
  let current: string | null = null;
  for (const line of splitLines(text)) {
    if (!line) continue;
    const lower = line.toLowerCase();
    if (current === null) {
      if (/^[a-z0-9_]+$/.test(lower)) current = lower;
      continue;
    }
    if (lower === 'end') { current = null; continue; }
    yield { name: current, line, fields: splitFields(line) };
  }
}
