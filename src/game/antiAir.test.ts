import { describe, expect, it } from 'vitest';
import {
  createBoard, createGameState, createScenarioInitialState, forecastCombat,
  isGameCommand, isGameState, loadScenarioDefinitions, movementCost, produceUnit, unitCategory,
  unitDefinitions, unitKinds, unitStats,
} from './index';

describe('anti-air unit registry', () => {
  it('derives the anti-air category, stats, production, and terrain behavior from one definition', () => {
    expect(unitKinds).toContain('antiAir');
    expect(unitDefinitions.antiAir).toMatchObject({
      category: 'armor', movementProfile: 'vehicle', productionTerrain: 'factory',
      stats: { cost: 8000, movement: 3, range: [1, 2] },
      effectiveness: { air: 1.8 },
    });
    expect(unitCategory.antiAir).toBe('armor');
    expect(unitStats.antiAir).toBe(unitDefinitions.antiAir.stats);
    const board = createBoard(1, 1, { kind: 'forest' });
    expect(movementCost(board, { x: 0, y: 0 }, 'antiAir')).toBe(2);
    board.terrain[0]![0] = { kind: 'mountain' };
    expect(movementCost(board, { x: 0, y: 0 }, 'antiAir')).toBe(Infinity);
  });

  it('is a short-range ground counter to aircraft, not a general-purpose attacker', () => {
    const state = createGameState(createBoard(3, 1));
    const antiAir = { id: 'aa', kind: 'antiAir' as const, owner: 'red' as const, position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false };
    const fighter = { id: 'fighter', kind: 'fighter' as const, owner: 'blue' as const, position: { x: 2, y: 0 }, hp: 100, hasMoved: false, hasActed: false };
    const tank = { id: 'tank', kind: 'tank' as const, owner: 'blue' as const, position: { x: 2, y: 0 }, hp: 100, hasMoved: false, hasActed: false };
    const vsFighter = forecastCombat(state, antiAir, fighter);
    const vsTank = forecastCombat(state, antiAir, tank);
    expect(vsFighter.ok && vsFighter.value.damageToDefender).toBeGreaterThan(vsTank.ok ? vsTank.value.damageToDefender : Infinity);
    expect(forecastCombat(state, antiAir, { ...fighter, position: { x: 3, y: 0 } })).toEqual({ ok: false, error: 'Target is out of range' });
  });

  it('is factory-produced and accepted by scenario parsing and canonical initial-state creation', () => {
    const factoryState = createGameState(createBoard(1, 1, { kind: 'factory', owner: 'red' }));
    factoryState.players.red.gold = unitStats.antiAir.cost;
    expect(produceUnit(factoryState, { x: 0, y: 0 }, 'antiAir').ok).toBe(true);
    const portState = createGameState(createBoard(1, 1, { kind: 'port', owner: 'red' }));
    portState.players.red.gold = unitStats.antiAir.cost;
    expect(produceUnit(portState, { x: 0, y: 0 }, 'antiAir')).toEqual({ ok: false, error: 'An owned compatible production facility is required' });

    const loaded = loadScenarioDefinitions([{
      id: 'anti-air-validation', name: '対空検証', briefing: '', startingGold: 0,
      board: { width: 2, height: 1, cells: [] },
      initialUnits: [{ kind: 'antiAir', owner: 'red', x: 0, y: 0 }, { kind: 'fighter', owner: 'blue', x: 1, y: 0 }],
      victoryConditions: [{ type: 'eliminate' }], defeatConditions: [{ type: 'eliminate' }],
    }]);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(createScenarioInitialState(loaded.value[0]!).units[0]).toMatchObject({ kind: 'antiAir', ammo: unitStats.antiAir.ammo });

    const serializedState = createGameState(createBoard(1, 1));
    serializedState.units = [{ id: 'aa', kind: 'antiAir', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }];
    expect(isGameState(JSON.parse(JSON.stringify(serializedState)))).toBe(true);
    expect(isGameCommand({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'antiAir' })).toBe(true);
  });
});
