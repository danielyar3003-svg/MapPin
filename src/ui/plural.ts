/** Склонение: plural(5, 'объект', 'объекта', 'объектов') → «объектов». */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;
