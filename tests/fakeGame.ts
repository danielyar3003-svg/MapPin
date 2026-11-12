import { buildImgV2 } from '../src/formats/img';
import { Writer, makeDff, makeTxd } from './helpers';

/** Бинарный stream-IPL. */
export function makeStreamIpl(items: { id: number; pos: [number, number, number]; lod: number }[]) {
  const w = new Writer().str('bnry', 4).i32(items.length);
  for (let i = 0; i < 5; i++) w.i32(0);
  w.i32(76);
  while (w.done().length < 76) w.u8(0);
  for (const it of items) w.f32(it.pos[0]).f32(it.pos[1]).f32(it.pos[2]).f32(0).f32(0).f32(0).f32(1).i32(it.id).i32(0).i32(it.lod);
  return w.done();
}

/** Минимальная «игра»: 3 модели, текстовый IPL с LOD и stream-файл с HD-объектами. */
export function fakeGameFiles(): Record<string, Uint8Array | string> {
  const img = buildImgV2([
    { name: 'box.dff', data: makeDff('brick') },
    { name: 'lodbox.dff', data: makeDff('brick') },
    { name: 'boxes.txd', data: makeTxd('brick') },
    { name: 'town_stream0.ipl', data: makeStreamIpl([
      { id: 1000, pos: [10, 0, 0], lod: 1 },
      { id: 1000, pos: [12, 0, 0], lod: 1 },
    ]) },
  ]);
  return {
    'data/default.dat': 'IDE DATA\\DEFAULT.IDE\n',
    'data/gta.dat': 'IDE DATA\\MAPS\\TOWN.IDE\nIPL DATA\\MAPS\\TOWN.IPL\n',
    'data/default.ide': 'objs\n1, missing, none, 100, 0\nend\n',
    'data/maps/town.ide': 'objs\n1000, box, boxes, 120, 0\n1001, lodbox, boxes, 1500, 0\nend\ntxdp\nboxes, generic\nend\n',
    // Первая запись — неизвестная модель 99999: индексы LOD должны остаться верными.
    'data/maps/town.ipl': 'inst\n99999, nope, 0, 0, 0, 0, 0, 0, 0, 1, -1\n1001, lodbox, 0, 11, 0, 0, 0, 0, 0, 1, -1\nend\n',
    'models/gta3.img': img,
  };
}
