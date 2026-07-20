import { describe, expect, it } from 'vitest';
import { createBoard, createGameState, type GameState } from '../game';
import { chooseCpuAction } from './rules';

const stateWith = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch });

describe('Phase 3 rule-based CPU', () => {
  it('captures an enemy property before taking other actions', () => {
    const board = createBoard(2, 1);
    board.terrain[0]![0] = { kind: 'city', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'infantry', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'tank', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'capture', unitId: 'infantry' });
  });

  it('attacks a favorable target that is in range', () => {
    const state = stateWith(createGameState(createBoard(2, 1)), { units: [
      { id: 'tank', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'infantry', kind: 'infantry', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'attack', unitId: 'tank', targetId: 'infantry' });
  });

  it('produces toward the 2 infantry : 2 tanks : 1 artillery mix', () => {
    const board = createBoard(1, 1, { kind: 'factory', owner: 'red' });
    const state = stateWith(createGameState(board), { players: { red: { gold: 7000, income: 0 }, blue: { gold: 0, income: 0 } }, units: [
      { id: 'i1', kind: 'infantry', owner: 'red', position: { x: 3, y: 3 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'i2', kind: 'infantry', owner: 'red', position: { x: 4, y: 3 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'tank' });
  });

  it('advances its full movement range toward an enemy capital in one order', () => {
    const board = createBoard(6, 1);
    board.terrain[0]![5] = { kind: 'capital', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    // Infantry move 3 on open plains, so it should cover three tiles rather than crawling one.
    expect(chooseCpuAction(state, 'normal')).toEqual({ type: 'move', unitId: 'i', destination: { x: 3, y: 0 } });
  });

  it('steps onto an adjacent enemy capital so it can capture next', () => {
    const board = createBoard(3, 1);
    board.terrain[0]![2] = { kind: 'capital', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'i', kind: 'infantry', owner: 'red', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state, 'normal')).toEqual({ type: 'move', unitId: 'i', destination: { x: 2, y: 0 } });
  });
});


describe('CPU fog-of-war attacks', () => {
  it('does not choose an attack against an in-range enemy outside allied vision', () => {
    const state = stateWith(createGameState(createBoard(5, 1)), { units: [
      { id: 'rocket', kind: 'rocket', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 5, hasMoved: false, hasActed: false },
      { id: 'target', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).not.toMatchObject({ type: 'attack' });
  });

  it('chooses the attack once an allied scout makes the target visible', () => {
    const state = stateWith(createGameState(createBoard(5, 2)), { units: [
      { id: 'rocket', kind: 'rocket', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 5, hasMoved: false, hasActed: false },
      { id: 'spotter', kind: 'recon', owner: 'red', position: { x: 0, y: 1 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'target', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'attack', unitId: 'rocket', targetId: 'target' });
  });
});
