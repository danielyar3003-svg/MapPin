import { describe, expect, it } from 'vitest';
import { MemoryFS } from '../src/game/fs';
import { loadGameData } from '../src/game/gameData';
import { ModelLibrary } from '../src/game/models';
import { fakeGameFiles } from './fakeGame';

describe('Загрузка игры', () => {
  it('читает dat, IDE, IPL, stream-IPL и связывает LOD', async () => {
    const data = await loadGameData(new MemoryFS(fakeGameFiles()));
    expect([...data.defs.keys()].sort()).toEqual([1, 1000, 1001]);
    expect(data.txdParents.get('boxes')).toBe('generic');
    expect(data.world).toHaveLength(3);
    const lod = data.world.find((w) => w.def.id === 1001)!;
    expect(lod.isLod).toBe(true);
    const hd = data.world.filter((w) => w.def.id === 1000);
    expect(hd.map((w) => w.lod)).toEqual([lod.index, lod.index]);
    expect(hd[1].position).toEqual([12, 0, 0]);
  });

  it('без gta.dat — понятная ошибка', async () => {
    await expect(loadGameData(new MemoryFS({}))).rejects.toThrow(/gta\.dat/);
  });

  it('собирает модель с текстурой, неизвестная — заглушка', async () => {
    const data = await loadGameData(new MemoryFS(fakeGameFiles()));
    const lib = new ModelLibrary(data);
    const t = await lib.get(1000);
    expect(t.placeholder).toBe(false);
    expect(t.parts).toHaveLength(1);
    const mat = t.parts[0].material as { map: { name: string } | null };
    expect(mat.map?.name).toBe('brick');
    expect(t.box.max.x).toBeCloseTo(1);
    expect((await lib.get(1)).placeholder).toBe(true);
    expect((await lib.get(424242)).placeholder).toBe(true);
  });
});
