import { isPropertyTerrainKind } from './facilities';
import { createBoard, createGameState } from './state';
import { unitKindSet, unitStats } from './units';
import { terrainKindSet, type Board, type GameResult, type GameState, type PlayerId, type Position, type TerrainKind, type UnitKind } from './types';

export interface InitialUnit { kind: UnitKind; owner: PlayerId; x: number; y: number }
export interface MapDefinition { id: string; name: string; board: Board; startingGold: number; initialUnits: readonly InitialUnit[] }
export type VictoryCondition =
  | { type: 'eliminate' }
  | { type: 'captureCapital' }
  | { type: 'hold'; positions: Position[]; turns: number }
  | { type: 'survive'; untilTurn: number }
  | { type: 'score'; target: number };
export interface ScenarioDefinition extends MapDefinition {
  briefing: string;
  victoryConditions: VictoryCondition[];
  defeatConditions: VictoryCondition[];
  turnLimit?: number;
}

/** JSON-compatible source shape used for built-in and future imported scenarios. */
export interface ScenarioData {
  id: string;
  name: string;
  briefing: string;
  startingGold: number;
  board: { width: number; height: number; fill?: TerrainKind; cells: readonly (readonly [number, number, TerrainKind, PlayerId?])[] };
  initialUnits: readonly InitialUnit[];
  victoryConditions: readonly VictoryCondition[];
  defeatConditions: readonly VictoryCondition[];
  turnLimit?: number;
}

export interface ScenarioCatalog {
  scenarios: readonly ScenarioDefinition[];
  /** Set only when the requested source was rejected and the supplied fallback was used. */
  error?: string;
}

export interface ScenarioStorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const CUSTOM_SCENARIOS_KEY = 'ministr.scenarios.custom';
export const CUSTOM_SCENARIOS_SCHEMA_VERSION = 1 as const;
export const MAX_CUSTOM_SCENARIO_BYTES = 1_000_000;
export const MAX_CUSTOM_SCENARIOS = 32;

const playerIds = new Set<PlayerId>(['red', 'blue']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const isNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isPosition = (value: unknown): value is Position => isRecord(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);

const cloneJson = (value: unknown): GameResult<unknown> => {
  try { return { ok: true, value: JSON.parse(JSON.stringify(value)) }; }
  catch { return { ok: false, error: 'シナリオ定義はJSON互換である必要があります。' }; }
};

function parseVictoryCondition(value: unknown, width: number, height: number): VictoryCondition | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'eliminate' || value.type === 'captureCapital') return { type: value.type };
  if (value.type === 'hold') {
    if (!Array.isArray(value.positions) || value.positions.length === 0 || value.positions.length > width * height || !isPositiveInteger(value.turns)) return undefined;
    const positions: Position[] = [];
    const seen = new Set<string>();
    for (const position of value.positions) {
      if (!isPosition(position) || position.x < 0 || position.y < 0 || position.x >= width || position.y >= height) return undefined;
      const key = `${position.x},${position.y}`;
      if (seen.has(key)) return undefined;
      seen.add(key);
      positions.push({ x: position.x, y: position.y });
    }
    return { type: 'hold', positions, turns: value.turns };
  }
  if (value.type === 'survive' && isPositiveInteger(value.untilTurn)) return { type: 'survive', untilTurn: value.untilTurn };
  if (value.type === 'score' && isPositiveInteger(value.target)) return { type: 'score', target: value.target };
  return undefined;
}

function parseScenario(value: unknown, ids: Set<string>): GameResult<ScenarioDefinition> {
  if (!isRecord(value)) return { ok: false, error: '各シナリオはオブジェクトである必要があります。' };
  if (typeof value.id !== 'string' || value.id.trim() === '' || ids.has(value.id)) return { ok: false, error: 'シナリオIDが空、または重複しています。' };
  if (typeof value.name !== 'string' || value.name.trim() === '' || typeof value.briefing !== 'string') return { ok: false, error: `シナリオ「${value.id}」の表示文が不正です。` };
  const startingGold = value.startingGold;
  if (!isNonNegativeInteger(startingGold)) return { ok: false, error: `シナリオ「${value.id}」の開始資金が不正です。` };
  if (!isRecord(value.board) || !isPositiveInteger(value.board.width) || !isPositiveInteger(value.board.height)
    || value.board.width > 256 || value.board.height > 256 || !Array.isArray(value.board.cells)) return { ok: false, error: `シナリオ「${value.id}」の盤面が不正です。` };
  const width = value.board.width;
  const height = value.board.height;
  const fill = value.board.fill === undefined ? 'plain' : value.board.fill;
  if (typeof fill !== 'string' || !terrainKindSet.has(fill)) return { ok: false, error: `シナリオ「${value.id}」の既定地形が不正です。` };
  if (value.board.cells.length > width * height) return { ok: false, error: `シナリオ「${value.id}」の地形セルが多すぎます。` };
  const board = createBoard(width, height, { kind: fill as TerrainKind });
  const occupiedCells = new Set<string>();
  for (const cell of value.board.cells) {
    if (!Array.isArray(cell) || (cell.length !== 3 && cell.length !== 4)) return { ok: false, error: `シナリオ「${value.id}」の地形セルが不正です。` };
    const [x, y, terrain, owner] = cell;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height
      || typeof terrain !== 'string' || !terrainKindSet.has(terrain)
      || (owner !== undefined && (typeof owner !== 'string' || !playerIds.has(owner as PlayerId)))) return { ok: false, error: `シナリオ「${value.id}」の地形セルが不正です。` };
    const key = `${x},${y}`;
    if (occupiedCells.has(key)) return { ok: false, error: `シナリオ「${value.id}」に重複した地形セルがあります。` };
    occupiedCells.add(key);
    board.terrain[y]![x] = { kind: terrain as TerrainKind, owner: owner as PlayerId | undefined, capturePoints: isPropertyTerrainKind(terrain as TerrainKind) ? 20 : undefined };
  }
  if (!Array.isArray(value.initialUnits) || value.initialUnits.length > width * height) return { ok: false, error: `シナリオ「${value.id}」の初期ユニットが不正です。` };
  const initialUnits: InitialUnit[] = [];
  const unitPositions = new Set<string>();
  for (const unit of value.initialUnits) {
    if (!isRecord(unit)) return { ok: false, error: `シナリオ「${value.id}」の初期ユニットが不正です。` };
    const x = unit.x;
    const y = unit.y;
    if (typeof unit.kind !== 'string' || !unitKindSet.has(unit.kind)
      || typeof unit.owner !== 'string' || !playerIds.has(unit.owner as PlayerId)
      || !isNonNegativeInteger(x) || !isNonNegativeInteger(y) || x >= width || y >= height) return { ok: false, error: `シナリオ「${value.id}」の初期ユニットが不正です。` };
    const key = `${x},${y}`;
    if (unitPositions.has(key)) return { ok: false, error: `シナリオ「${value.id}」に重複した初期ユニットがあります。` };
    unitPositions.add(key);
    initialUnits.push({ kind: unit.kind as UnitKind, owner: unit.owner as PlayerId, x, y });
  }
  const parseConditions = (conditions: unknown, label: string): GameResult<VictoryCondition[]> => {
    if (!Array.isArray(conditions) || conditions.length === 0 || conditions.length > 32) return { ok: false, error: `シナリオ「${value.id}」の${label}が不正です。` };
    const parsed = conditions.map(condition => parseVictoryCondition(condition, width, height));
    return parsed.every((condition): condition is VictoryCondition => condition !== undefined)
      ? { ok: true, value: parsed }
      : { ok: false, error: `シナリオ「${value.id}」の${label}が不正です。` };
  };
  const victoryConditions = parseConditions(value.victoryConditions, '勝利条件');
  if (!victoryConditions.ok) return victoryConditions;
  const defeatConditions = parseConditions(value.defeatConditions, '敗北条件');
  if (!defeatConditions.ok) return defeatConditions;
  const turnLimit = value.turnLimit;
  if (turnLimit !== undefined && !isPositiveInteger(turnLimit)) return { ok: false, error: `シナリオ「${value.id}」のターン制限が不正です。` };
  ids.add(value.id);
  return { ok: true, value: { id: value.id, name: value.name, briefing: value.briefing, startingGold, board, initialUnits, victoryConditions: victoryConditions.value, defeatConditions: defeatConditions.value, turnLimit } };
}

/** Converts JSON-compatible scenario data into safe board state. No validation is repeated on lookup. */
export function loadScenarioDefinitions(source: unknown): GameResult<readonly ScenarioDefinition[]> {
  const cloned = cloneJson(source);
  if (!cloned.ok) return cloned;
  if (!Array.isArray(cloned.value) || cloned.value.length === 0) return { ok: false, error: 'シナリオ定義は空でない配列である必要があります。' };
  const scenarios: ScenarioDefinition[] = [];
  const ids = new Set<string>();
  for (const value of cloned.value) {
    const scenario = parseScenario(value, ids);
    if (!scenario.ok) return scenario;
    scenarios.push(scenario.value);
  }
  return { ok: true, value: scenarios };
}

/** Returns a safe catalog; invalid source never reaches the game and uses the caller's fallback. */
export function createScenarioCatalog(source: unknown, fallback: readonly ScenarioDefinition[]): ScenarioCatalog {
  const loaded = loadScenarioDefinitions(source);
  return loaded.ok ? { scenarios: loaded.value } : { scenarios: fallback, error: loaded.error };
}

const standardVictory = [{ type: 'eliminate' }, { type: 'captureCapital' }] as const;

export const builtInScenarioData = [
  {
    id: 'skirmish', name: '緑の国境', startingGold: 6000,
    briefing: '国境地帯を制圧せよ。敵部隊の全滅、または敵司令部の占領で勝利となる。', victoryConditions: standardVictory, defeatConditions: standardVictory,
    board: { width: 10, height: 8, cells: [[0, 0, 'capital', 'red'], [1, 0, 'factory', 'red'], [9, 7, 'capital', 'blue'], [8, 7, 'factory', 'blue'], [4, 3, 'city'], [5, 4, 'city'], [4, 4, 'forest'], [5, 3, 'mountain'], [2, 2, 'forest'], [7, 5, 'forest']] },
    initialUnits: [{ kind: 'infantry', owner: 'red', x: 0, y: 1 }, { kind: 'tank', owner: 'red', x: 1, y: 1 }, { kind: 'recon', owner: 'red', x: 2, y: 1 }, { kind: 'infantry', owner: 'blue', x: 9, y: 6 }, { kind: 'tank', owner: 'blue', x: 8, y: 6 }, { kind: 'recon', owner: 'blue', x: 7, y: 6 }],
  },
  {
    id: 'islands', name: '群島補給線', startingGold: 9000, briefing: '群島の補給線を確保し、敵の戦力か司令部を無力化せよ。', victoryConditions: standardVictory, defeatConditions: standardVictory,
    board: { width: 12, height: 8, fill: 'sea', cells: [[0, 0, 'plain'], [1, 0, 'plain'], [2, 0, 'plain'], [0, 1, 'capital', 'red'], [1, 1, 'factory', 'red'], [2, 1, 'port', 'red'], [0, 2, 'plain'], [1, 2, 'plain'], [2, 2, 'plain'], [9, 5, 'plain'], [10, 5, 'plain'], [11, 5, 'plain'], [9, 6, 'port', 'blue'], [10, 6, 'factory', 'blue'], [11, 6, 'capital', 'blue'], [9, 7, 'plain'], [10, 7, 'plain'], [11, 7, 'plain'], [4, 3, 'plain'], [5, 3, 'city'], [6, 4, 'plain'], [7, 4, 'city']] },
    initialUnits: [{ kind: 'infantry', owner: 'red', x: 0, y: 2 }, { kind: 'fighter', owner: 'red', x: 1, y: 0 }, { kind: 'destroyer', owner: 'red', x: 3, y: 2 }, { kind: 'infantry', owner: 'blue', x: 11, y: 5 }, { kind: 'fighter', owner: 'blue', x: 10, y: 7 }, { kind: 'destroyer', owner: 'blue', x: 8, y: 5 }],
  },
  {
    id: 'landing', name: '海峡上陸作戦', startingGold: 0, turnLimit: 18, briefing: '海峡の向こうにある敵司令部を占領せよ。歩兵は輸送艦に乗船してから航行し、敵島の海岸へ上陸する必要がある。敵司令部を占領すれば勝利、自軍司令部を占領されれば敗北となる。', victoryConditions: [{ type: 'captureCapital' }], defeatConditions: [{ type: 'captureCapital' }],
    board: { width: 10, height: 6, fill: 'sea', cells: [[0, 0, 'plain'], [1, 0, 'plain'], [2, 0, 'plain'], [0, 1, 'capital', 'red'], [1, 1, 'plain'], [2, 1, 'plain'], [0, 2, 'plain'], [1, 2, 'plain'], [2, 2, 'plain'], [0, 3, 'plain'], [1, 3, 'port', 'red'], [2, 3, 'plain'], [0, 4, 'plain'], [1, 4, 'plain'], [2, 4, 'plain'], [0, 5, 'plain'], [1, 5, 'plain'], [2, 5, 'plain'], [7, 0, 'plain'], [8, 0, 'plain'], [9, 0, 'plain'], [7, 1, 'plain'], [8, 1, 'plain'], [9, 1, 'plain'], [7, 2, 'plain'], [8, 2, 'port', 'blue'], [9, 2, 'plain'], [7, 3, 'plain'], [8, 3, 'plain'], [9, 3, 'plain'], [7, 4, 'plain'], [8, 4, 'plain'], [9, 4, 'capital', 'blue'], [7, 5, 'plain'], [8, 5, 'plain'], [9, 5, 'plain']] },
    initialUnits: [{ kind: 'infantry', owner: 'red', x: 2, y: 2 }, { kind: 'landingShip', owner: 'red', x: 3, y: 2 }, { kind: 'infantry', owner: 'blue', x: 7, y: 4 }, { kind: 'landingShip', owner: 'blue', x: 6, y: 4 }],
  },
  {
    id: 'canyon', name: '峡谷の関門', startingGold: 11000, briefing: '峡谷中央の関門を突破し、敵軍を撃破せよ。', victoryConditions: standardVictory, defeatConditions: standardVictory,
    board: { width: 12, height: 10, cells: [[0, 1, 'capital', 'red'], [1, 1, 'factory', 'red'], [2, 2, 'city', 'red'], [11, 8, 'capital', 'blue'], [10, 8, 'factory', 'blue'], [9, 7, 'city', 'blue'], [5, 0, 'mountain'], [5, 1, 'mountain'], [5, 2, 'mountain'], [5, 3, 'mountain'], [5, 4, 'mountain'], [5, 6, 'mountain'], [5, 7, 'mountain'], [5, 8, 'mountain'], [5, 9, 'mountain'], [5, 5, 'road'], [6, 5, 'city'], [4, 5, 'road'], [7, 5, 'road'], [8, 5, 'road'], [3, 4, 'forest'], [7, 6, 'forest']] },
    initialUnits: [{ kind: 'infantry', owner: 'red', x: 0, y: 2 }, { kind: 'tank', owner: 'red', x: 1, y: 2 }, { kind: 'artillery', owner: 'red', x: 2, y: 3 }, { kind: 'rocket', owner: 'red', x: 1, y: 3 }, { kind: 'bomber', owner: 'red', x: 2, y: 1 }, { kind: 'infantry', owner: 'blue', x: 11, y: 7 }, { kind: 'tank', owner: 'blue', x: 10, y: 7 }, { kind: 'artillery', owner: 'blue', x: 9, y: 6 }, { kind: 'rocket', owner: 'blue', x: 10, y: 6 }, { kind: 'bomber', owner: 'blue', x: 9, y: 8 }],
  },
  {
    id: 'siege', name: '首都包囲', startingGold: 14000, briefing: '中央都市を足掛かりに首都包囲網を完成させ、敵を降伏させよ。', victoryConditions: standardVictory, defeatConditions: standardVictory,
    board: { width: 14, height: 10, cells: [[0, 0, 'capital', 'red'], [1, 0, 'factory', 'red'], [2, 1, 'city', 'red'], [13, 9, 'capital', 'blue'], [12, 9, 'factory', 'blue'], [11, 8, 'city', 'blue'], [6, 4, 'capital'], [6, 5, 'city'], [7, 4, 'city'], [7, 5, 'factory'], [3, 2, 'forest'], [4, 2, 'forest'], [9, 7, 'forest'], [10, 7, 'forest'], [5, 3, 'road'], [6, 3, 'road'], [7, 3, 'road'], [8, 3, 'road'], [5, 6, 'road'], [6, 6, 'road'], [7, 6, 'road'], [8, 6, 'road']] },
    initialUnits: [{ kind: 'infantry', owner: 'red', x: 0, y: 1 }, { kind: 'recon', owner: 'red', x: 1, y: 1 }, { kind: 'tank', owner: 'red', x: 2, y: 0 }, { kind: 'rocket', owner: 'red', x: 2, y: 2 }, { kind: 'fighter', owner: 'red', x: 3, y: 0 }, { kind: 'infantry', owner: 'blue', x: 13, y: 8 }, { kind: 'recon', owner: 'blue', x: 12, y: 8 }, { kind: 'tank', owner: 'blue', x: 11, y: 9 }, { kind: 'rocket', owner: 'blue', x: 11, y: 7 }, { kind: 'fighter', owner: 'blue', x: 10, y: 9 }],
  },
] satisfies readonly ScenarioData[];

// A compact, independently valid fallback keeps the app playable even if a
// future edit corrupts the larger built-in data set. Keep this separate from
// `builtInScenarioData`: it must still work when that entire catalog is bad.
const emergencyScenarioData = [{
  id: 'emergency-skirmish',
  name: '緊急スカーミッシュ',
  briefing: 'シナリオ定義を読み込めなかったため、最小の対戦マップを開始しました。',
  startingGold: 0,
  board: { width: 2, height: 1, cells: [[0, 0, 'capital', 'red'], [1, 0, 'capital', 'blue']] },
  initialUnits: [
    { kind: 'infantry', owner: 'red', x: 0, y: 0 },
    { kind: 'infantry', owner: 'blue', x: 1, y: 0 },
  ],
  victoryConditions: [{ type: 'captureCapital' }],
  defeatConditions: [{ type: 'captureCapital' }],
}] satisfies readonly ScenarioData[];

// Its validity is a source invariant, so fail fast only for this
// developer-owned emergency definition.
const fallbackLoad = loadScenarioDefinitions(emergencyScenarioData);
if (!fallbackLoad.ok) throw new Error(`Fallback scenario definition is invalid: ${fallbackLoad.error}`);
const builtInCatalog = createScenarioCatalog(builtInScenarioData, fallbackLoad.value);

/** Validated exactly once during module initialization. */
export const maps: readonly ScenarioDefinition[] = builtInCatalog.scenarios;
/** Diagnostics for UI/telemetry; normal built-in data leaves this undefined. */
export const scenarioLoadError: string | undefined = builtInCatalog.error;

// Campaign uses the immutable built-in `maps`; regular play may include these persisted definitions.
const customScenarios = new Map<string, ScenarioDefinition>();
export function availableScenarios(): readonly ScenarioDefinition[] { return [...maps, ...customScenarios.values()]; }
export function scenarioById(id: string | undefined): ScenarioDefinition | undefined {
  return id === undefined ? undefined : maps.find(map => map.id === id) ?? customScenarios.get(id);
}

/** The only valid turn-one state for a scenario, shared by runtime and persistence checks. */
export function createScenarioInitialState(scenario: ScenarioDefinition): GameState {
  const base = createGameState(scenario.board);
  const nextId: Record<PlayerId, number> = { red: 0, blue: 0 };
  return {
    ...base, scenarioId: scenario.id,
    players: { red: { gold: scenario.startingGold, income: 0 }, blue: { gold: scenario.startingGold, income: 0 } },
    units: scenario.initialUnits.map(unit => {
      nextId[unit.owner] += 1;
      const stats = unitStats[unit.kind];
      return { id: `${unit.owner[0]}${nextId[unit.owner]}`, kind: unit.kind, owner: unit.owner, position: { x: unit.x, y: unit.y }, hp: 100, fuel: stats.fuel, ammo: stats.ammo, hasMoved: false, hasActed: false };
    }),
  };
}

export function scenarioDefinitionToData(scenario: ScenarioDefinition): ScenarioData {
  const cells: [number, number, TerrainKind, PlayerId?][] = [];
  for (let y = 0; y < scenario.board.height; y += 1) for (let x = 0; x < scenario.board.width; x += 1) {
    const tile = scenario.board.terrain[y]![x]!;
    if (tile.kind !== 'plain' || tile.owner !== undefined) cells.push([x, y, tile.kind, tile.owner]);
  }
  return { id: scenario.id, name: scenario.name, briefing: scenario.briefing, startingGold: scenario.startingGold,
    board: { width: scenario.board.width, height: scenario.board.height, cells }, initialUnits: scenario.initialUnits.map(unit => ({ ...unit })),
    victoryConditions: scenario.victoryConditions.map(condition => structuredClone(condition)), defeatConditions: scenario.defeatConditions.map(condition => structuredClone(condition)), turnLimit: scenario.turnLimit };
}

function replaceCustomScenarios(scenarios: readonly ScenarioDefinition[]): void {
  customScenarios.clear();
  for (const scenario of scenarios) customScenarios.set(scenario.id, scenario);
}

function parseCustomScenarioData(value: unknown): GameResult<readonly ScenarioDefinition[]> {
  if (!isRecord(value) || value.schemaVersion !== CUSTOM_SCENARIOS_SCHEMA_VERSION || !Array.isArray(value.scenarios) || value.scenarios.length > MAX_CUSTOM_SCENARIOS)
    return { ok: false, error: 'カスタムシナリオの内容が不正です。' };
  const loaded = loadScenarioDefinitions(value.scenarios);
  if (!loaded.ok || loaded.value.some(scenario => maps.some(builtIn => builtIn.id === scenario.id)))
    return { ok: false, error: 'カスタムシナリオの内容が不正です。' };
  return loaded;
}

export function loadCustomScenarios(storage: ScenarioStorageLike): GameResult<readonly ScenarioDefinition[]> {
  let serialized: string | null;
  try { serialized = storage.getItem(CUSTOM_SCENARIOS_KEY); } catch { return { ok: false, error: 'カスタムシナリオを読み込めませんでした。' }; }
  if (serialized === null) { replaceCustomScenarios([]); return { ok: true, value: [] }; }
  if (new TextEncoder().encode(serialized).byteLength > MAX_CUSTOM_SCENARIO_BYTES) return { ok: false, error: 'カスタムシナリオのデータが大きすぎます。' };
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { return { ok: false, error: 'カスタムシナリオのデータが壊れています。' }; }
  const loaded = parseCustomScenarioData(parsed);
  if (!loaded.ok) { replaceCustomScenarios([]); return loaded; }
  replaceCustomScenarios(loaded.value);
  return { ok: true, value: [...loaded.value] };
}

export function saveCustomScenario(storage: ScenarioStorageLike, source: ScenarioData): GameResult<ScenarioDefinition> {
  const loaded = loadScenarioDefinitions([source]);
  if (!loaded.ok) return loaded;
  const scenario = loaded.value[0]!;
  if (maps.some(builtIn => builtIn.id === scenario.id)) return { ok: false, error: '組み込みシナリオのIDは上書きできません。' };
  const next = new Map(customScenarios); next.set(scenario.id, scenario);
  if (next.size > MAX_CUSTOM_SCENARIOS) return { ok: false, error: `カスタムシナリオは${MAX_CUSTOM_SCENARIOS}件までです。` };
  const serialized = JSON.stringify({ schemaVersion: CUSTOM_SCENARIOS_SCHEMA_VERSION, scenarios: [...next.values()].map(scenarioDefinitionToData) });
  if (new TextEncoder().encode(serialized).byteLength > MAX_CUSTOM_SCENARIO_BYTES) return { ok: false, error: 'カスタムシナリオのデータが大きすぎます。' };
  try { storage.setItem(CUSTOM_SCENARIOS_KEY, serialized); } catch { return { ok: false, error: 'カスタムシナリオを書き込めませんでした。' }; }
  replaceCustomScenarios([...next.values()]);
  return { ok: true, value: scenario };
}
