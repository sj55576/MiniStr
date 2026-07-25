import { isPropertyTerrainKind } from './facilities';
import { loadScenarioDefinitions, type InitialUnit, type ScenarioData, type VictoryCondition } from './maps';
import type { GameResult, PlayerId, Position, TerrainKind, UnitKind } from './types';

export interface ScenarioEditorState {
  data: ScenarioData;
  selected: Position;
  tool: 'terrain' | 'unit' | 'eraseUnit';
  terrain: TerrainKind;
  owner?: PlayerId;
  unitKind: UnitKind;
  unitOwner: PlayerId;
}

const defaultVictory: VictoryCondition[] = [{ type: 'captureCapital' }];
const defaultDefeat: VictoryCondition[] = [{ type: 'captureCapital' }];

export function createScenarioEditor(): ScenarioEditorState {
  return {
    data: {
      id: 'custom-operation', name: '新規作戦', briefing: 'ここに作戦概要を入力してください。', startingGold: 6000,
      board: { width: 8, height: 6, cells: [] }, initialUnits: [],
      victoryConditions: defaultVictory, defeatConditions: defaultDefeat,
    },
    selected: { x: 0, y: 0 }, tool: 'terrain', terrain: 'plain', owner: undefined,
    unitKind: 'infantry', unitOwner: 'red',
  };
}

function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function cellsExcept(cells: readonly (readonly [number, number, TerrainKind, PlayerId?])[], position: Position) {
  return cells.filter(([x, y]) => x !== position.x || y !== position.y);
}

/** Applies one board edit immutably; validation remains centralized at export/import time. */
export function applyEditorTool(state: ScenarioEditorState, position: Position): ScenarioEditorState {
  const selected = { ...position };
  if (state.tool === 'terrain') {
    const cells = cellsExcept(state.data.board.cells, position);
    const owner = isPropertyTerrainKind(state.terrain) ? state.owner : undefined;
    return { ...state, selected, data: { ...state.data, board: { ...state.data.board, cells: [...cells, [position.x, position.y, state.terrain, owner]] } } };
  }
  const initialUnits = state.tool === 'eraseUnit'
    ? state.data.initialUnits.filter(unit => !samePosition(unit, position))
    : [...state.data.initialUnits.filter(unit => !samePosition(unit, position)), { kind: state.unitKind, owner: state.unitOwner, x: position.x, y: position.y }];
  return { ...state, selected, data: { ...state.data, initialUnits } };
}

/** Replaces user-entered JSON only when it contains exactly one valid scenario. */
export function importScenarioEditorJson(text: string, state: ScenarioEditorState): GameResult<ScenarioEditorState> {
  let source: unknown;
  try { source = JSON.parse(text); } catch { return { ok: false, error: 'JSONを読み取れませんでした。' }; }
  const scenarios = loadScenarioDefinitions(Array.isArray(source) ? source : [source]);
  if (!scenarios.ok) return scenarios;
  if (scenarios.value.length !== 1) return { ok: false, error: '読み込めるシナリオは1件だけです。' };
  return { ok: true, value: { ...state, data: scenarioToData(scenarios.value[0]!), selected: { x: 0, y: 0 } } };
}

/** Validates the editor source through the same boundary used by built-in scenarios. */
export function validateEditorScenario(state: ScenarioEditorState) {
  return loadScenarioDefinitions([state.data]);
}

export function exportScenarioEditorJson(state: ScenarioEditorState): string {
  return JSON.stringify(state.data, null, 2);
}

function scenarioToData(scenario: { id: string; name: string; briefing: string; startingGold: number; board: { width: number; height: number; terrain: { kind: TerrainKind; owner?: PlayerId }[][] }; initialUnits: readonly InitialUnit[]; victoryConditions: readonly VictoryCondition[]; defeatConditions: readonly VictoryCondition[]; turnLimit?: number }): ScenarioData {
  const cells: [number, number, TerrainKind, PlayerId?][] = [];
  for (let y = 0; y < scenario.board.height; y += 1) for (let x = 0; x < scenario.board.width; x += 1) {
    const terrain = scenario.board.terrain[y]![x]!;
    if (terrain.kind !== 'plain' || terrain.owner !== undefined) cells.push([x, y, terrain.kind, terrain.owner]);
  }
  return {
    id: scenario.id, name: scenario.name, briefing: scenario.briefing, startingGold: scenario.startingGold,
    board: { width: scenario.board.width, height: scenario.board.height, cells },
    initialUnits: scenario.initialUnits.map(unit => ({ ...unit })),
    victoryConditions: scenario.victoryConditions.map(condition => structuredClone(condition)),
    defeatConditions: scenario.defeatConditions.map(condition => structuredClone(condition)),
    turnLimit: scenario.turnLimit,
  };
}
