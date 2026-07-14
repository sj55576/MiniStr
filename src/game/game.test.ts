import { describe, expect, it } from 'vitest';
import { captureProperty, collectIncome, createBoard, createGameState, forecastCombat, moveUnit, nextRandom, produceUnit, terrainRules, type GameState } from './index';

const stateWith = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch });

describe('Phase 2 game rules', () => {
  it('defines terrain movement and defense effects', () => {
    expect(terrainRules.forest.movement.tank).toBe(2);
    expect(terrainRules.mountain.movement.tank).toBe(Infinity);
    expect(terrainRules.city.defense).toBeGreaterThan(terrainRules.plain.defense);
  });

  it('moves an active unit onto an enterable adjacent tile without mutation', () => {
    const state = createGameState(createBoard(2, 1));
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }];
    const result = moveUnit(state, 'i', { x: 1, y: 0 });
    expect(result.ok && result.value.units[0]?.position).toEqual({ x: 1, y: 0 });
    expect(state.units[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('collects income from every owned property including a capital', () => {
    const board = createBoard(3, 1);
    board.terrain[0]![0] = { kind: 'city', owner: 'red' };
    board.terrain[0]![1] = { kind: 'factory', owner: 'red' };
    board.terrain[0]![2] = { kind: 'capital', owner: 'red' };
    expect(collectIncome(createGameState(board)).players.red).toEqual({ gold: 3000, income: 3000 });
  });

  it('produces a unit at an owned unoccupied factory', () => {
    const board = createBoard(1, 1, { kind: 'factory', owner: 'red' });
    const state = stateWith(createGameState(board), { players: { red: { gold: 1000, income: 0 }, blue: { gold: 0, income: 0 } } });
    const result = produceUnit(state, { x: 0, y: 0 }, 'infantry');
    expect(result.ok && result.value.players.red.gold).toBe(0);
    expect(result.ok && result.value.units[0]?.id).toBe('u1');
  });

  it('captures a capital over two infantry actions and ends the game', () => {
    const board = createBoard(1, 1, { kind: 'capital', owner: 'blue', capturePoints: 20 });
    const base = createGameState(board);
    const first = captureProperty(stateWith(base, { units: [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }] }), 'i');
    expect(first.ok && first.value.winner).toBeUndefined();
    const secondState = first.ok ? stateWith(first.value, { units: [{ ...first.value.units[0]!, hasActed: false }] }) : base;
    const second = captureProperty(secondState, 'i');
    expect(second.ok && second.value.winner).toBe('red');
  });

  it('forecasts combat with terrain mitigation and no artillery counterattack at range one', () => {
    const board = createBoard(2, 1);
    board.terrain[0]![1] = { kind: 'forest' };
    const state = createGameState(board);
    const result = forecastCombat(state,
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'artillery', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    expect(result.ok && result.value).toMatchObject({ defenderDamage: 74, counterDamage: 0, canCounter: false });
  });

  it('uses deterministic random state', () => {
    expect(nextRandom(42)).toEqual(nextRandom(42));
  });
});
