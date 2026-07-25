import { describe, expect, it } from 'vitest';
import { applyEditorTool, createScenarioEditor, exportScenarioEditorJson, importScenarioEditorJson, validateEditorScenario } from './editor';

describe('minimal scenario editor', () => {
  it('places terrain owners and replaces units without creating duplicate positions', () => {
    let editor = createScenarioEditor();
    editor = { ...editor, terrain: 'factory', owner: 'red' };
    editor = applyEditorTool(editor, { x: 2, y: 3 });
    editor = { ...editor, tool: 'unit', unitKind: 'infantry', unitOwner: 'red' };
    editor = applyEditorTool(editor, { x: 2, y: 3 });
    editor = { ...editor, unitKind: 'tank', unitOwner: 'blue' };
    editor = applyEditorTool(editor, { x: 2, y: 3 });
    expect(editor.data.board.cells).toContainEqual([2, 3, 'factory', 'red']);
    expect(editor.data.initialUnits).toEqual([{ kind: 'tank', owner: 'blue', x: 2, y: 3 }]);
  });

  it('round-trips exported JSON through the shared scenario validator', () => {
    let editor = createScenarioEditor();
    editor = { ...editor, terrain: 'capital', owner: 'red' };
    editor = applyEditorTool(editor, { x: 0, y: 0 });
    editor = { ...editor, terrain: 'capital', owner: 'blue' };
    editor = applyEditorTool(editor, { x: 7, y: 5 });
    const imported = importScenarioEditorJson(exportScenarioEditorJson(editor), createScenarioEditor());
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(validateEditorScenario(imported.value).ok).toBe(true);
  });

  it('rejects malformed or out-of-bounds JSON without changing editor state', () => {
    const editor = createScenarioEditor();
    expect(importScenarioEditorJson('{broken', editor)).toMatchObject({ ok: false });
    expect(importScenarioEditorJson(JSON.stringify({ ...editor.data, initialUnits: [{ kind: 'infantry', owner: 'red', x: 99, y: 0 }] }), editor)).toMatchObject({ ok: false });
  });
});
