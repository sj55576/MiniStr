import { describe, expect, it } from 'vitest';
import { canProduceUnit, productionKindsForRule } from './facilities';
import { loadScenarioDefinitions, maps, scenarioDefinitionToData } from './maps';

describe('production facilities', () => {
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
