import { describe, expect, it } from 'vitest';
import {
  countProductionFacilities, createBoard, createGameState, idleProductionFacilities, productionKindsByTerrain,
  type GameState,
} from './index';

function board(): GameState {
  const state = createGameState(createBoard(4, 2));
  state.board.terrain[0]![0] = { kind: 'port', owner: 'red', capturePoints: 20 };
  state.board.terrain[0]![1] = { kind: 'city', owner: 'red', capturePoints: 20 };
  state.board.terrain[0]![3] = { kind: 'factory', owner: 'red', capturePoints: 20 };
  state.board.terrain[1]![0] = { kind: 'factory', owner: 'red', capturePoints: 20 };
  state.board.terrain[1]![2] = { kind: 'port', owner: 'blue', capturePoints: 20 };
  state.units = [
    { id: 'r1', kind: 'infantry', owner: 'red', position: { x: 0, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
  ];
  return state;
}

describe('production facility scanning', () => {
  it('returns only owned, idle production tiles in row-major order', () => {
    const state = board();
    expect(idleProductionFacilities(state, 'red')).toEqual([
      { position: { x: 0, y: 0 }, kind: 'port', kinds: productionKindsByTerrain.port },
      { position: { x: 3, y: 0 }, kind: 'factory', kinds: productionKindsByTerrain.factory },
    ]);
  });

  it('excludes a facility with a deployed unit on it, but still counts it as owned', () => {
    const state = board();
    // The unit at (0,1) sits on red's second factory.
    expect(idleProductionFacilities(state, 'red').some(facility => facility.position.x === 0 && facility.position.y === 1)).toBe(false);
    expect(countProductionFacilities(state, 'red')).toBe(3);
  });

  it('ignores tiles owned by the other player and non-production property tiles', () => {
    const state = board();
    const redFacilities = idleProductionFacilities(state, 'red');
    expect(redFacilities.every(facility => facility.kind !== 'city')).toBe(true);
    expect(redFacilities.some(facility => facility.position.x === 2 && facility.position.y === 1)).toBe(false);
    expect(idleProductionFacilities(state, 'blue')).toEqual([
      { position: { x: 2, y: 1 }, kind: 'port', kinds: productionKindsByTerrain.port },
    ]);
    expect(countProductionFacilities(state, 'blue')).toBe(1);
  });

  it('ports produce only naval kinds and factories produce only non-naval kinds', () => {
    const state = board();
    const [port, factory] = idleProductionFacilities(state, 'red');
    expect(port!.kinds).toEqual(['destroyer', 'landingShip']);
    expect(port!.kinds).not.toContain('infantry');
    expect(factory!.kinds).not.toContain('destroyer');
    expect(factory!.kinds).not.toContain('landingShip');
    expect(factory!.kinds).toContain('infantry');
  });

  it('reports zero facilities for a player who owns none', () => {
    const state = createGameState(createBoard(2, 1));
    expect(idleProductionFacilities(state, 'red')).toEqual([]);
    expect(countProductionFacilities(state, 'red')).toBe(0);
  });
});
