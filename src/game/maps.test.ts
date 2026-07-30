import { describe, expect, it } from 'vitest';
import { CUSTOM_SCENARIOS_KEY, availableScenarios, createBuiltInScenarioCatalog, createScenarioEditor, createScenarioInitialState, importScenarioEditorJson, loadCustomScenarios, loadScenarioDefinitions, maps, saveCustomScenario, scenarioById, unitStats, type ScenarioData, type ScenarioStorageLike } from './index';

class MemoryStorage implements ScenarioStorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const customScenario: ScenarioData = {
  id: 'test-custom-persistence', name: '保存テスト', briefing: '検証済みのカスタム作戦。', startingGold: 1234,
  board: { width: 2, height: 1, cells: [[0, 0, 'capital', 'red'], [1, 0, 'capital', 'blue']] },
  initialUnits: [{ kind: 'infantry', owner: 'red', x: 0, y: 0 }, { kind: 'infantry', owner: 'blue', x: 1, y: 0 }],
  victoryConditions: [{ type: 'captureCapital' }], defeatConditions: [{ type: 'captureCapital' }],
};

describe('expanded map roster', () => {
  it('falls back to a playable emergency scenario when the built-in catalog is invalid', () => {
    const catalog = createBuiltInScenarioCatalog([{ id: 'broken' }]);
    expect(catalog.error).toBeDefined();
    expect(catalog.scenarios.map(scenario => scenario.id)).toEqual(['emergency-skirmish']);
    expect(createScenarioInitialState(catalog.scenarios[0]!).units).toHaveLength(2);
  });

  it('offers five distinct scenarios with map-owned starting forces', () => {
    expect(maps.map(map => map.id)).toEqual(['skirmish', 'islands', 'landing', 'canyon', 'siege']);
    for (const map of maps) {
      expect(map.initialUnits.some(unit => unit.owner === 'red')).toBe(true);
      expect(map.initialUnits.some(unit => unit.owner === 'blue')).toBe(true);
      for (const unit of map.initialUnits) {
        expect(unit.x).toBeGreaterThanOrEqual(0);
        expect(unit.y).toBeGreaterThanOrEqual(0);
        expect(unit.x).toBeLessThan(map.board.width);
        expect(unit.y).toBeLessThan(map.board.height);
      }
    }
  });

  it('adds reconnaissance cars and self-propelled rocket artillery', () => {
    expect(unitStats.recon).toMatchObject({ movement: 7, vision: 5 });
    expect(unitStats.rocket).toMatchObject({ range: [3, 5], attack: 90 });
    expect(maps.some(map => map.initialUnits.some(unit => unit.kind === 'recon'))).toBe(true);
    expect(maps.some(map => map.initialUnits.some(unit => unit.kind === 'rocket'))).toBe(true);
  });

  it('persists custom scenarios, restores them into the selectable catalog, and creates canonical initial state', () => {
    const storage = new MemoryStorage();
    const saved = saveCustomScenario(storage, customScenario);
    expect(saved.ok).toBe(true);
    expect(scenarioById(customScenario.id)?.name).toBe(customScenario.name);
    expect(availableScenarios().some(scenario => scenario.id === customScenario.id)).toBe(true);
    if (saved.ok) expect(createScenarioInitialState(saved.value)).toMatchObject({
      scenarioId: customScenario.id,
      players: { red: { gold: 1234 }, blue: { gold: 1234 } },
      units: [{ id: 'r1' }, { id: 'b1' }],
    });

    loadCustomScenarios(new MemoryStorage());
    expect(scenarioById(customScenario.id)).toBeUndefined();
    expect(loadCustomScenarios(storage).ok).toBe(true);
    expect(scenarioById(customScenario.id)?.board.width).toBe(2);
  });


  it('rejects unsafe scenario IDs from JSON imports and saved custom scenario data', () => {
    for (const id of ["unsafe\"quote", "unsafe<angle", "unsafe'apostrophe"]) {
      const source = { ...customScenario, id };
      expect(loadScenarioDefinitions([source]).ok).toBe(false);
      expect(importScenarioEditorJson(JSON.stringify(source), createScenarioEditor()).ok).toBe(false);
    }

    const storage = new MemoryStorage();
    storage.setItem(CUSTOM_SCENARIOS_KEY, JSON.stringify({
      schemaVersion: 1,
      scenarios: [{ ...customScenario, id: 'unsafe\"persisted' }],
    }));
    expect(loadCustomScenarios(storage).ok).toBe(false);
    expect(scenarioById('unsafe\"persisted')).toBeUndefined();
  });
});
