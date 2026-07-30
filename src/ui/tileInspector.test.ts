import { describe, expect, it } from 'vitest';
import { createBoard, createGameState, type GameState, type Unit } from '../game';
import { describeTileInspection, inspectTile } from './tileInspector';

function situation(): GameState {
  const board = createBoard(4, 3);
  board.terrain[0]![1] = { kind: 'factory', owner: 'red', capturePoints: 20 };
  board.terrain[0]![2] = { kind: 'port' };
  board.terrain[1]![0] = { kind: 'mountain' };
  board.terrain[1]![3] = { kind: 'sea' };
  const units: Unit[] = [
    { id: 'r1', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 62, fuel: 40, ammo: 3, hasMoved: true, hasActed: false },
    { id: 'b1', kind: 'landingShip', owner: 'blue', position: { x: 3, y: 1 }, hp: 80, fuel: 50, ammo: 0, hasMoved: false, hasActed: false },
    { id: 'b2', kind: 'infantry', owner: 'blue', embarkedIn: 'b1', hp: 100, hasMoved: false, hasActed: false },
    { id: 'b3', kind: 'recon', owner: 'blue', position: { x: 2, y: 2 }, hp: 55, fuel: 80, ammo: 6, hasMoved: false, hasActed: false },
  ];
  return { ...createGameState(board), units };
}

const rowValue = (rows: readonly { label: string; value: string }[], label: string) =>
  rows.find(row => row.label === label)?.value;

describe('inspectTile', () => {
  const state = situation();
  const everywhere = new Set(['0,0', '1,0', '2,0', '3,0', '0,1', '1,1', '2,1', '3,1', '0,2', '1,2', '2,2', '3,2']);

  it('rejects positions outside the board', () => {
    expect(inspectTile(state, { x: 4, y: 0 }, 'red', everywhere)).toBeUndefined();
    expect(inspectTile(state, { x: 0, y: -1 }, 'red', everywhere)).toBeUndefined();
  });

  it('describes terrain, ownership, and what a facility can build', () => {
    const factory = inspectTile(state, { x: 1, y: 0 }, 'red', everywhere)!;
    expect(factory.title).toBe('工場（自軍）');
    expect(rowValue(factory.rows, '防御')).toBe('★★★');
    expect(rowValue(factory.rows, '占領値')).toBe('20');
    expect(rowValue(factory.rows, '生産')).toContain('歩兵');
    expect(rowValue(factory.rows, '生産')).not.toContain('駆逐艦');

    const port = inspectTile(state, { x: 2, y: 0 }, 'red', everywhere)!;
    expect(port.title).toBe('港湾（中立）');
    expect(rowValue(port.rows, '生産')).toBe('駆逐艦・輸送艦');

    const mountain = inspectTile(state, { x: 0, y: 1 }, 'red', everywhere)!;
    expect(mountain.title).toBe('山岳');
    expect(rowValue(mountain.rows, '生産')).toBeUndefined();
    expect(rowValue(mountain.rows, '占領値')).toBeUndefined();
  });

  it("reports the selected unit's movement cost, including impassable terrain", () => {
    expect(rowValue(inspectTile(state, { x: 0, y: 1 }, 'red', everywhere, 'infantry')!.rows, '移動コスト')).toBe('2');
    expect(rowValue(inspectTile(state, { x: 0, y: 1 }, 'red', everywhere, 'tank')!.rows, '移動コスト')).toBe('進入不可');
    expect(rowValue(inspectTile(state, { x: 0, y: 0 }, 'red', everywhere)!.rows, '移動コスト')).toBeUndefined();
  });

  it("gives full detail for the viewer's own unit", () => {
    const own = inspectTile(state, { x: 0, y: 0 }, 'red', everywhere)!.unit!;
    expect(own.title).toBe('自軍の戦車');
    expect(rowValue(own.rows, '耐久')).toBe('62 / 100');
    expect(rowValue(own.rows, '弾薬')).toBe('3');
    expect(rowValue(own.rows, '燃料')).toBe('消費なし');
    expect(rowValue(own.rows, '状態')).toBe('移動済み');
  });

  it("never reports an enemy unit's fuel or ammunition, but does report its cargo", () => {
    const enemy = inspectTile(state, { x: 3, y: 1 }, 'red', everywhere)!.unit!;
    expect(enemy.title).toBe('敵軍の輸送艦');
    expect(rowValue(enemy.rows, '耐久')).toBe('80 / 100');
    expect(rowValue(enemy.rows, '搭載')).toBe('歩兵');
    expect(rowValue(enemy.rows, '燃料')).toBeUndefined();
    expect(rowValue(enemy.rows, '弾薬')).toBeUndefined();
    expect(rowValue(enemy.rows, '状態')).toBeUndefined();
  });

  it('withholds a unit standing on an unscouted tile while still naming the terrain', () => {
    const fogged = inspectTile(state, { x: 2, y: 2 }, 'red', new Set(['0,0']))!;
    expect(fogged.hidden).toBe(true);
    expect(fogged.unit).toBeUndefined();
    expect(fogged.title).toBe('平原');
    expect(describeTileInspection(fogged)).toContain('未索敵');
  });

  it('flattens an inspection into one accessible sentence using one-based coordinates', () => {
    const text = describeTileInspection(inspectTile(state, { x: 0, y: 0 }, 'red', everywhere)!);
    expect(text.startsWith('(1, 1) 平原、')).toBe(true);
    expect(text).toContain('自軍の戦車');
    expect(text).not.toContain('未索敵');
  });
});
