import { describe, expect, it } from 'vitest';
import { applyGameCommand, createBoard, createGameState, endTurn, maps, reachablePositions, type GameState } from '../game';
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

function islandTransportState(withShip = true): GameState {
  const board = createBoard(8, 3, { kind: 'sea' });
  for (let y = 0; y < 3; y += 1) {
    board.terrain[y]![0] = { kind: 'plain' };
    board.terrain[y]![1] = { kind: 'plain' };
  }
  board.terrain[1]![7] = { kind: 'capital', owner: 'red', capturePoints: 20 };
  board.terrain[0]![0] = { kind: 'port', owner: 'blue', capturePoints: 20 };
  const state = createGameState(board);
  state.activePlayer = 'blue';
  state.players.blue.gold = 10_000;
  state.units = [
    { id: 'infantry', kind: 'infantry', owner: 'blue', position: { x: 1, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
    ...(withShip ? [{ id: 'ship', kind: 'landingShip' as const, owner: 'blue' as const, position: { x: 2, y: 1 }, hp: 100, hasMoved: false, hasActed: false }] : []),
  ];
  return state;
}

describe('CPU amphibious transport', () => {
  it('boards, sails, and lands infantry toward a remote capital with only legal commands', () => {
    let state = islandTransportState();
    const first = chooseCpuAction(state);
    expect(first).toEqual({ type: 'embark', unitId: 'infantry', transportId: 'ship' });
    let result = applyGameCommand(state, first);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = endTurn(endTurn(result.value));

    const sail = chooseCpuAction(state);
    expect(sail).toMatchObject({ type: 'move', unitId: 'ship' });
    result = applyGameCommand(state, sail);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = endTurn(endTurn(result.value));

    const land = chooseCpuAction(state);
    expect(land).toEqual({ type: 'disembark', transportId: 'ship', destination: { x: 7, y: 1 } });
    expect(applyGameCommand(state, land).ok).toBe(true);
  });

  it('builds a landing ship at an empty port before factory units when an infantry objective is remote', () => {
    const action = chooseCpuAction(islandTransportState(false));
    expect(action).toEqual({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'landingShip' });
  });

  it('includes a dedicated scenario whose capital objective cannot be reached by walking', () => {
    const scenario = maps.find(map => map.id === 'landing');
    expect(scenario?.victoryConditions).toEqual([{ type: 'captureCapital' }]);
    const state = createGameState(scenario!.board);
    const redInfantry = scenario!.initialUnits.find(unit => unit.owner === 'red' && unit.kind === 'infantry')!;
    const enemyCapital = { x: 9, y: 4 };
    state.units = [{ id: 'red-infantry', kind: 'infantry', owner: 'red', position: { x: redInfantry.x, y: redInfantry.y }, hp: 100, hasMoved: false, hasActed: false }];
    expect(reachablePositions(state, 'red-infantry')).not.toContainEqual(enemyCapital);
    expect(scenario!.initialUnits.some(unit => unit.owner === 'red' && unit.kind === 'landingShip')).toBe(true);
  });
});
