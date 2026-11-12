import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { MapDocument } from '../src/editor/document';
import { defaultObject } from '../src/editor/types';
import { parseProject, serializeProject } from '../src/editor/project';
import { exportPawn, importPawn } from '../src/export/pawn';
import { iplQuaternion, quaternionToSamp, sampToQuaternion } from '../src/export/rotation';

describe('Документ', () => {
  it('добавление, изменение, удаление и отмена', () => {
    const doc = new MapDocument();
    const [a] = doc.add([defaultObject(1337, [1, 2, 3])]);
    doc.update([{ uid: a.uid, patch: { position: [5, 5, 5] } }]);
    expect(doc.get(a.uid)!.position).toEqual([5, 5, 5]);
    doc.undo();
    expect(doc.get(a.uid)!.position).toEqual([1, 2, 3]);
    doc.redo();
    doc.remove([a.uid]);
    expect(doc.size).toBe(0);
    doc.undo();
    expect(doc.get(a.uid)!.position).toEqual([5, 5, 5]);
    doc.undo(); doc.undo();
    expect(doc.size).toBe(0);
    expect(doc.canUndo).toBe(false);
  });

  it('новое действие очищает redo', () => {
    const doc = new MapDocument();
    doc.add([defaultObject(1, [0, 0, 0])]);
    doc.undo();
    doc.add([defaultObject(2, [0, 0, 0])]);
    expect(doc.canRedo).toBe(false);
  });
});

describe('Проект', () => {
  it('сохраняется и открывается', () => {
    const objs = [{ ...defaultObject(1337, [1, 2, 3]), comment: 'урна' }];
    expect(parseProject(serializeProject(objs))).toEqual(objs);
    expect(() => parseProject('{"format":"x"}')).toThrow();
  });
});

describe('Pawn', () => {
  it('экспорт CreateDynamicObject и CreateObject', () => {
    const o = { ...defaultObject(1337, [1.5, -2, 3.123456]), rotation: [0, 0, 90] as [number, number, number] };
    const dyn = exportPawn([o]);
    expect(dyn).toContain('CreateDynamicObject(1337, 1.5, -2.0, 3.1235, 0.0, 0.0, 90.0, -1, -1, -1, 300.0, 300.0);');
    const st = exportPawn([o], { fn: 'CreateObject', streamDistance: 300, precision: 2 });
    expect(st).toContain('CreateObject(1337, 1.5, -2.0, 3.12, 0.0, 0.0, 90.0);');
  });

  it('импорт разных вызовов', () => {
    const code = `
      // CreateObject(1, 0,0,0, 0,0,0);  закомментировано
      tmpobjid = CreateDynamicObject(19377, -10.5, 20.0, 3.0, 0.0, 90.0, 0.0, 5, 2, -1, 200.0, 200.0);
      SetDynamicObjectMaterial(tmpobjid, 0, 18646, "x", "y", 0);
      CreateObject(1337, 1, 2, 3, 4, 5, 6, 150.0);
      CreateDynamicObjectEx(1338, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0, 100.0, 100.0);
      CreatePlayerObject(playerid, 1339, 1.0, 2.0, 3.0, 0.0, 0.0, 0.0);
      CreateObject(modelVar, 1, 2, 3, 0, 0, 0);
    `;
    const { objects, skipped } = importPawn(code);
    expect(skipped).toBe(1);
    expect(objects.map((o) => o.model)).toEqual([19377, 1337, 1338, 1339]);
    expect(objects[0]).toMatchObject({ world: 5, interior: 2, drawDistance: 200, rotation: [0, 90, 0] });
    expect(objects[1].drawDistance).toBe(150);
  });

  it('экспорт → импорт без потерь', () => {
    const objs = [
      { ...defaultObject(1, [100.25, -200.5, 10]), rotation: [10, 20, 30] as [number, number, number], world: 3, interior: 1, drawDistance: 500 },
    ];
    expect(importPawn(exportPawn(objs)).objects).toEqual(objs);
  });
});

describe('Вращения', () => {
  it('углы SA-MP → кватернион → углы', () => {
    for (const r of [[0, 0, 90], [10, 20, 30], [45, 0, 270], [0, 60, 0]] as [number, number, number][]) {
      const back = quaternionToSamp(sampToQuaternion(r));
      const q1 = sampToQuaternion(r), q2 = sampToQuaternion(back);
      expect(Math.abs(q1.dot(q2))).toBeCloseTo(1, 6);
    }
  });

  it('поворот вокруг Z на 90° переводит X в Y', () => {
    const v = new Vector3(1, 0, 0).applyQuaternion(sampToQuaternion([0, 0, 90]));
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it('кватернион IPL сопряжён', () => {
    const q = iplQuaternion([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    expect(q.equals(new Quaternion(0, 0, -Math.SQRT1_2, Math.SQRT1_2))).toBe(true);
  });
});
