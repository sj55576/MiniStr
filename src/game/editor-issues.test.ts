import { describe, expect, it } from 'vitest';
import { createScenarioEditor, exportScenarioEditorJson, importScenarioEditorJson } from './editor';

describe('issue #88 scenario editor production rules', () => {
  it('defaults new scenarios to facility-v2', () => {
    expect(createScenarioEditor().data.productionRules).toBe('facility-v2');
  });

  it.each(['facility-v2', 'legacy-factory-air'] as const)('round-trips %s explicitly', rule => {
    const state = createScenarioEditor();
    state.data.productionRules = rule;
    const imported = importScenarioEditorJson(exportScenarioEditorJson(state), state);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.value.data.productionRules).toBe(rule);
  });
});

