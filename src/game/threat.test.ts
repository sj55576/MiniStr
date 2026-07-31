import { describe, expect, it } from 'vitest';
import { createBoard, createGameState } from './state';
import { enemyThreatPreview } from './threat';

describe('next-turn enemy threat preview', () => {
  it('does not depend on an enemy action history', () => {
    const board = createBoard(6, 2);
    const state = createGameState(board);
    state.units = [
      { id: 'red', kind: 'recon', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'blue', kind: 'tank', owner: 'blue', position: { x: 3, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    const ready = enemyThreatPreview(state, 'blue', 'red');
    const spent = enemyThreatPreview({ ...state, units: state.units.map(unit => unit.id === 'blue' ? { ...unit, hasMoved: true, hasActed: true } : unit) }, 'blue', 'red');
    expect([...spent.movement].sort()).toEqual([...ready.movement].sort());
    expect([...spent.attack].sort()).toEqual([...ready.attack].sort());
    expect(ready.attack.size).toBeGreaterThan(0);
  });

  it('keeps indirect fire at its current position even after it acted', () => {
    const state = createGameState(createBoard(6, 1));
    state.units = [{ id: 'blue', kind: 'artillery', owner: 'blue', position: { x: 2, y: 0 }, hp: 100, hasMoved: true, hasActed: true }];
    const threat = enemyThreatPreview(state, 'blue', 'red');
    expect(threat.movement).toEqual(new Set());
    expect(threat.attack.has('0,0')).toBe(true);
    expect(threat.attack.has('5,0')).toBe(true);
  });
  it('does not reveal an unseen enemy blocking the previewed unit path', () => {
    const board = createBoard(8, 1);
    const base = createGameState(board);
    base.units = [
      { id: 'scout', kind: 'recon', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'blue-tank', kind: 'tank', owner: 'blue', position: { x: 3, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    const withHiddenBlocker = {
      ...base,
      units: [...base.units, { id: 'hidden', kind: 'infantry' as const, owner: 'blue' as const, position: { x: 7, y: 0 }, hp: 100, hasMoved: false, hasActed: false }],
    };

    const expected = enemyThreatPreview(base, 'blue-tank', 'red');
    const actual = enemyThreatPreview(withHiddenBlocker, 'blue-tank', 'red');
    expect([...actual.movement].sort()).toEqual([...expected.movement].sort());
    expect([...actual.attack].sort()).toEqual([...expected.attack].sort());
  });

});
