import { describe, expect, it } from 'vitest';
import {
  canProduceUnit, countProductionFacilities, createBoard, createGameState, idleProductionFacilities,
  productionKindsByTerrain, productionKindsForRule,
} from './index';
import { loadScenarioDefinitions, maps, scenarioDefinitionToData } from './maps';
import type { GameState } from './types';

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

describe('production facilities', () => {
  it('returns only owned, idle production tiles in row-major order', () => {
    const state = board();
    expect(idleProductionFacilities(state, 'red')).toEqual([
      { position: { x: 0, y: 0 }, kind: 'port', kinds: productionKindsByTerrain.port },
      { position: { x: 3, y: 0 }, kind: 'factory', kinds: productionKindsByTerrain.factory },
    ]);
  });

  it('excludes a facility with a deployed unit on it, but still counts it as owned', () => {
    const state = board();
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

  it('reports zero facilities for a player who owns none', () => {
    const state = createGameState(createBoard(2, 1));
    expect(idleProductionFacilities(state, 'red')).toEqual([]);
    expect(countProductionFacilities(state, 'red')).toBe(0);
  });

  it('separates ground, air, and naval production for new scenarios', () => {
    expect(canProduceUnit('factory', 'tank')).toBe(true);
    expect(canProduceUnit('factory', 'fighter')).toBe(false);
    expect(canProduceUnit('airport', 'fighter')).toBe(true);
    expect(canProduceUnit('port', 'destroyer')).toBe(true);
    expect(canProduceUnit('port', 'bomber')).toBe(false);
  });

  it('keeps legacy factory-air behavior for scenario JSON without a rule marker', () => {
    const source = [{
      id: 'legacy', name: 'Legacy', briefing: '', startingGold: 0,
      board: { width: 2, height: 1, cells: [[0, 0, 'factory', 'red']] },
      initialUnits: [], victoryConditions: [{ type: 'eliminate' }], defeatConditions: [{ type: 'eliminate' }],
    }];
    const loaded = loadScenarioDefinitions(source);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value[0]!.productionRules).toBe('legacy-factory-air');
    expect(productionKindsForRule(loaded.value[0]!.productionRules).factory).toContain('fighter');
  });

  it('round-trips airport cells and the explicit production rule marker', () => {
    const loaded = loadScenarioDefinitions([{
      id: 'airport-round-trip', name: 'Airport', briefing: '', startingGold: 0,
      productionRules: 'facility-v2',
      board: { width: 2, height: 1, cells: [[0, 0, 'airport', 'red'], [1, 0, 'capital', 'blue']] },
      initialUnits: [], victoryConditions: [{ type: 'eliminate' }], defeatConditions: [{ type: 'eliminate' }],
    }]);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const serialized = scenarioDefinitionToData(loaded.value[0]!);
    expect(serialized.productionRules).toBe('facility-v2');
    expect(serialized.board.cells).toContainEqual([0, 0, 'airport', 'red']);
    const reloaded = loadScenarioDefinitions([serialized]);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.value[0]!.board.terrain[0]![0]).toMatchObject({ kind: 'airport', owner: 'red' });
  });

  it('marks built-in scenarios as the new facility rule and provides airports for starting air forces', () => {
    expect(maps.every(scenario => scenario.productionRules === 'facility-v2')).toBe(true);
    for (const scenario of maps) {
      const airOwners = new Set(scenario.initialUnits.filter(unit => ['fighter', 'bomber'].includes(unit.kind)).map(unit => unit.owner));
      for (const owner of airOwners) {
        expect(scenario.board.terrain.flat().some(tile => tile.kind === 'airport' && tile.owner === owner)).toBe(true);
      }
    }
  });
});
