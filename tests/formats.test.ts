import { describe, expect, it } from 'vitest';
import { buildImgV2, imgV2HeaderSize, parseImgV2Directory } from '../src/formats/img';
import { parseIde, parseTxdParents } from '../src/formats/ide';
import { isBinaryIpl, parseBinaryIpl, parseTextIpl } from '../src/formats/ipl';
import { parseGameDat } from '../src/formats/dat';
import { parseDff } from '../src/formats/dff';
import { parseTxd } from '../src/formats/txd';
import { decodeDxt } from '../src/formats/dxt';
import { rwVersion } from '../src/formats/rw';
import { Writer, makeDff, makeTxd } from './helpers';

describe('IMG v2', () => {
  it('собирается и читается обратно', () => {
    const a = new Uint8Array(3000).fill(7);
    const img = buildImgV2([{ name: 'a.dff', data: a }, { name: 'b.txd', data: new Uint8Array([1, 2, 3]) }]);
    expect(imgV2HeaderSize(img.subarray(0, 8))).toBe(8 + 2 * 32);
    const dir = parseImgV2Directory(img);
    expect(dir.map((e) => e.name)).toEqual(['a.dff', 'b.txd']);
    expect(dir[0].offset).toBe(2048);
    expect(dir[0].size).toBe(4096);
    expect(img[dir[1].offset + 2]).toBe(3);
  });
});

describe('IDE', () => {
  it('разбирает objs, tobj, anim и пропускает прочее', () => {
    const ide = `# comment
objs
615, veg_tree3, gta_tree_boak, 299, 0
1337, BinNt07_LA, binnt_las, 1, 100, 4
end
tobj
3001, lights, lighttxd, 150, 0, 20, 6
end
cars
400, landstal, landstal, car, LANDSTAL, LANDSTK, null, normal, 10, 0, 0, -1, 0.768, 0.768, 0
end
anim
3500, flag, flagtxd, flaganim, 200, 0
end
txdp
childtxd, parenttxd
end`;
    const defs = parseIde(ide);
    expect(defs.map((d) => d.id)).toEqual([615, 1337, 3001, 3500]);
    expect(defs[0]).toMatchObject({ model: 'veg_tree3', txd: 'gta_tree_boak', drawDistance: 299 });
    expect(defs[1]).toMatchObject({ model: 'binnt07_la', drawDistance: 100, flags: 4 });
    expect(defs[2]).toMatchObject({ timeOn: 20, timeOff: 6, drawDistance: 150 });
    expect(defs[3]).toMatchObject({ section: 'anim', drawDistance: 200 });
    expect(parseTxdParents(ide)).toEqual([['childtxd', 'parenttxd']]);
  });
});

describe('IPL', () => {
  it('текстовый inst', () => {
    const ipl = `inst
3433, lae2_ground03, 0, 2000.5, -1000, 13.5, 0, 0, 0.7071, 0.7071, 12
end
cull
1, 2, 3
end`;
    const p = parseTextIpl(ipl);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: 3433, model: 'lae2_ground03', lod: 12, position: [2000.5, -1000, 13.5] });
  });

  it('бинарный bnry', () => {
    const w = new Writer().str('bnry', 4).i32(2);
    for (let i = 0; i < 5; i++) w.i32(0);
    w.i32(76);
    while (w.done().length < 76) w.u8(0);
    w.f32(1).f32(2).f32(3).f32(0).f32(0).f32(0).f32(1).i32(1337).i32(0).i32(-1);
    w.f32(4).f32(5).f32(6).f32(0).f32(0).f32(1).f32(0).i32(1338).i32(3).i32(7);
    const bytes = w.done();
    expect(isBinaryIpl(bytes)).toBe(true);
    const p = parseBinaryIpl(bytes);
    expect(p).toHaveLength(2);
    expect(p[1]).toMatchObject({ id: 1338, interior: 3, lod: 7, position: [4, 5, 6] });
  });
});

describe('gta.dat', () => {
  it('собирает IDE/IPL/IMG', () => {
    const d = parseGameDat('IDE DATA\\MAPS\\generic.ide\nIMG MODELS\\GTA_INT.IMG\n# x\nIPL DATA\\MAPS\\LA\\LAe.IPL\nCOLFILE 0 x.col');
    expect(d).toEqual({ ide: ['DATA/MAPS/generic.ide'], ipl: ['DATA/MAPS/LA/LAe.IPL'], img: ['MODELS/GTA_INT.IMG'] });
  });
});

describe('RenderWare', () => {
  it('версия GTA SA', () => expect(rwVersion(0x1803ffff)).toBe(0x36003));

  it('DFF: вершины, UV, материал, кадр', () => {
    const m = parseDff(makeDff('brick'));
    expect(m.frames).toHaveLength(1);
    expect(m.frames[0].name).toBe('box');
    expect(m.frames[0].matrix.slice(12, 15)).toEqual([10, 20, 30]);
    expect(m.atomics).toEqual([{ frame: 0, geometry: 0 }]);
    const g = m.geometries[0];
    expect(Array.from(g.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(g.uvs!)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(g.colors![0]).toBe(200);
    expect(g.groups).toHaveLength(1);
    expect(Array.from(g.groups[0].indices)).toEqual([0, 1, 2]);
    expect(g.materials[0]).toEqual({ color: [255, 128, 64, 255], texture: 'brick' });
  });

  it('TXD: несжатая 8888', () => {
    const [t] = parseTxd(makeTxd('brick'));
    expect(t).toMatchObject({ name: 'brick', width: 2, height: 2, hasAlpha: true });
    expect(Array.from(t.rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(t.rgba.subarray(12, 16))).toEqual([255, 255, 255, 128]);
  });

  it('TXD: DXT1', () => {
    // c0 = красный (0xF800), c1 = синий (0x001F), все индексы 0
    const block = Uint8Array.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
    const [t] = parseTxd(makeTxd('d', block));
    expect(t.width).toBe(4);
    expect(Array.from(t.rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('DXT5: альфа-блок', () => {
    const block = new Uint8Array(16);
    block[0] = 255; block[1] = 0; // индексы 0 → альфа 255
    block[8] = 0xff; block[9] = 0xff; // белый
    const out = decodeDxt(block, 4, 4, 5);
    expect(Array.from(out.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  });
});
