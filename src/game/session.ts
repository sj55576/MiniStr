import { attackUnit, captureProperty, disembarkUnit, embarkUnit, endTurn, moveUnit, produceUnit, waitUnit } from './commands';
import { createScenarioInitialState, scenarioById } from './maps';
import { terrainKindSet, type GameResult, type GameState, type Position, type UnitKind } from './types';
import { isEmbarkableUnit, transportCapacity, unitKindSet } from './units';

/**
 * Schema v3 adds the explicit `wait` command. Malformed cargo is rejected
 * by `isGameState` instead of being repaired during load.
 */
export const SAVE_SCHEMA_VERSION = 3 as const;
export const MAX_SAVE_BYTES = 1_000_000;
export const MANUAL_SAVE_KEY = 'ministr.save.manual';
export const AUTO_SAVE_KEY = 'ministr.save.auto';

export type GameCommand =
  | { type: 'move'; unitId: string; destination: Position }
  | { type: 'wait'; unitId: string }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'capture'; unitId: string }
  | { type: 'produce'; factory: Position; kind: UnitKind }
  | { type: 'embark'; unitId: string; transportId: string }
  | { type: 'disembark'; transportId: string; destination: Position }
  | { type: 'endTurn' };

export interface SavedGame {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  mapId: string;
  difficulty: 'easy' | 'normal' | 'hard';
  initialState: GameState;
  commands: GameCommand[];
  gameState: GameState;
  /** Present only when this save belongs to an active campaign battle. */
  campaignScenarioId?: string;
  savedAt: string;
}

/** v1 had the same fields; keeping named migrations makes later changes append-only. */
function migrateSaveV1ToV2(value: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(value), schemaVersion: 2 };
}
function migrateSaveV2ToV3(value: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(value), schemaVersion: SAVE_SCHEMA_VERSION };
}

function migrateSavedGame(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (value.schemaVersion === SAVE_SCHEMA_VERSION) return value;
  if (value.schemaVersion === 2) return migrateSaveV2ToV3(value);
  if (value.schemaVersion === 1) return migrateSaveV2ToV3(migrateSaveV1ToV2(value));
  return undefined;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function applyGameCommand(state: GameState, command: GameCommand): GameResult {
  switch (command.type) {
    case 'move': return moveUnit(state, command.unitId, command.destination);
    case 'wait': return waitUnit(state, command.unitId);
    case 'attack': return attackUnit(state, command.unitId, command.targetId);
    case 'capture': return captureProperty(state, command.unitId);
    case 'produce': return produceUnit(state, command.factory, command.kind);
    case 'embark': return embarkUnit(state, command.unitId, command.transportId);
    case 'disembark': return disembarkUnit(state, command.transportId, command.destination);
    case 'endTurn': return { ok: true, value: endTurn(state) };
  }
}

export function replayCommands(initialState: GameState, commands: readonly GameCommand[]): GameResult {
  let state = structuredClone(initialState);
  for (let index = 0; index < commands.length; index += 1) {
    const result = applyGameCommand(state, commands[index]!);
    if (!result.ok) return { ok: false, error: `Command ${index + 1}: ${result.error}` };
    state = result.value;
  }
  return { ok: true, value: state };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isPosition = (value: unknown): value is Position =>
  isRecord(value) && Number.isInteger(value.x) && Number.isInteger(value.y);
const players = new Set(['red', 'blue']);

const isScenarioScores = (value: unknown): boolean => {
  if (!isRecord(value) || Object.keys(value).some(key => !players.has(key))) return false;
  return Object.values(value).every(score => isFiniteNumber(score) && score >= 0);
};

const isHoldProgress = (value: unknown): boolean => {
  if (!isRecord(value) || Object.keys(value).some(key => !players.has(key))) return false;
  return Object.values(value).every(progress => isRecord(progress)
    && Object.values(progress).every(turns => Number.isSafeInteger(turns) && (turns as number) >= 0));
};

function sameValue(left: unknown, right: unknown): boolean {
  const stack: Array<[unknown, unknown]> = [[left, right]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (Object.is(a, b)) continue;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) stack.push([a[index], b[index]]);
      continue;
    }
    if (isRecord(a) || isRecord(b)) {
      if (!isRecord(a) || !isRecord(b)) return false;
      // JSON drops object properties whose value is undefined, so persisted
      // deployed units may omit `embarkedIn` while replayed units carry it as
      // an explicit undefined value.
      const keys = Object.keys(a).filter(key => a[key] !== undefined);
      const otherKeys = Object.keys(b).filter(key => b[key] !== undefined);
      if (keys.length !== otherKeys.length || !keys.every(key => Object.hasOwn(b, key) && b[key] !== undefined)) return false;
      for (const key of keys) stack.push([a[key], b[key]]);
      continue;
    }
    return false;
  }
  return true;
}

export function isGameCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'endTurn') return true;
  if (value.type === 'move') return typeof value.unitId === 'string' && isPosition(value.destination);
  if (value.type === 'wait') return typeof value.unitId === 'string';
  if (value.type === 'attack') return typeof value.unitId === 'string' && typeof value.targetId === 'string';
  if (value.type === 'capture') return typeof value.unitId === 'string';
  if (value.type === 'embark') return typeof value.unitId === 'string' && typeof value.transportId === 'string';
  if (value.type === 'disembark') return typeof value.transportId === 'string' && isPosition(value.destination);
  return value.type === 'produce' && isPosition(value.factory)
    && typeof value.kind === 'string' && unitKindSet.has(value.kind);
}

export function isGameState(value: unknown): value is GameState {
  if (!isRecord(value) || !isRecord(value.board) || !Array.isArray(value.board.terrain)
    || !Array.isArray(value.units) || !isRecord(value.players)) return false;
  const width = value.board.width;
  const height = value.board.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || (width as number) <= 0 || (height as number) <= 0
    || (width as number) > 256 || (height as number) > 256
    || value.board.terrain.length !== height) return false;
  if (!value.board.terrain.every(row => Array.isArray(row) && row.length === width && row.every(tile =>
    isRecord(tile) && typeof tile.kind === 'string' && terrainKindSet.has(tile.kind)
    && (tile.owner === undefined || players.has(tile.owner as string))
    && (tile.capturePoints === undefined || (isFiniteNumber(tile.capturePoints) && tile.capturePoints >= 0 && tile.capturePoints <= 20))))) return false;

  if (value.units.length > 4096) return false;
  const ids = new Set<string>();
  const positions = new Set<string>();
  const unitsById = new Map<string, Record<string, unknown>>();
  for (const unit of value.units) {
    if (!isRecord(unit) || typeof unit.id !== 'string' || ids.has(unit.id)
      || typeof unit.kind !== 'string' || !unitKindSet.has(unit.kind)
      || typeof unit.owner !== 'string' || !players.has(unit.owner)
      || !isFiniteNumber(unit.hp) || unit.hp <= 0 || unit.hp > 100
      || (unit.fuel !== undefined && (!isFiniteNumber(unit.fuel) || unit.fuel < 0))
      || (unit.ammo !== undefined && (!isFiniteNumber(unit.ammo) || unit.ammo < 0))
      || typeof unit.hasMoved !== 'boolean' || typeof unit.hasActed !== 'boolean') return false;
    const deployed = unit.position !== undefined && unit.embarkedIn === undefined;
    const embarked = unit.position === undefined && typeof unit.embarkedIn === 'string';
    if (!deployed && !embarked) return false;
    if (deployed) {
      if (!isPosition(unit.position) || unit.position.x < 0 || unit.position.y < 0
        || unit.position.x >= (width as number) || unit.position.y >= (height as number)) return false;
      const position = `${unit.position.x},${unit.position.y}`;
      if (positions.has(position)) return false;
      positions.add(position);
    }
    ids.add(unit.id);
    unitsById.set(unit.id, unit);
  }
  const cargoByTransport = new Map<string, number>();
  for (const unit of value.units) {
    if (!isRecord(unit) || unit.embarkedIn === undefined) continue;
    const transport = unitsById.get(unit.embarkedIn as string);
    if (!transport || typeof transport.kind !== 'string' || !unitKindSet.has(transport.kind)
      || transport.owner !== unit.owner || transport.embarkedIn !== undefined
      || typeof unit.kind !== 'string' || !unitKindSet.has(unit.kind) || !isEmbarkableUnit(unit.kind as UnitKind)) return false;
    const cargoCount = (cargoByTransport.get(unit.embarkedIn as string) ?? 0) + 1;
    if (cargoCount > transportCapacity(transport.kind as UnitKind)) return false;
    cargoByTransport.set(unit.embarkedIn as string, cargoCount);
  }
  const validPlayerState = (state: unknown) =>
    isRecord(state) && isFiniteNumber(state.gold) && state.gold >= 0
    && isFiniteNumber(state.income) && state.income >= 0;
  return validPlayerState(value.players.red) && validPlayerState(value.players.blue)
    && typeof value.activePlayer === 'string' && players.has(value.activePlayer)
    && Number.isInteger(value.turn) && (value.turn as number) >= 1
    && Number.isSafeInteger(value.rngSeed) && (value.rngSeed as number) >= 0 && (value.rngSeed as number) <= 0xffff_ffff
    && Number.isSafeInteger(value.nextUnitId) && (value.nextUnitId as number) >= 1
    && (value.winner === undefined || players.has(value.winner as string))
    && (value.scenarioId === undefined || (typeof value.scenarioId === 'string' && scenarioById(value.scenarioId) !== undefined))
    && (value.scores === undefined || isScenarioScores(value.scores))
    && (value.objectiveHoldTurns === undefined || isHoldProgress(value.objectiveHoldTurns));
}

function validateSavedGameShape(value: unknown): value is SavedGame {
  const scenario = isRecord(value) && typeof value.mapId === 'string' ? scenarioById(value.mapId) : undefined;
  return isRecord(value) && value.schemaVersion === SAVE_SCHEMA_VERSION
    && typeof value.mapId === 'string' && scenario !== undefined
    && ['easy', 'normal', 'hard'].includes(String(value.difficulty))
    && typeof value.savedAt === 'string' && isGameState(value.initialState) && isGameState(value.gameState)
    // A self-consistent edited save/replay must not be able to alter the map's
    // turn-one gold, board, or forces. Custom IDs resolve through the loaded,
    // persisted custom catalog rather than trusting the save payload.
    && sameValue(value.initialState, createScenarioInitialState(scenario))
    && (value.campaignScenarioId === undefined || value.campaignScenarioId === value.mapId)
    && Array.isArray(value.commands) && value.commands.length <= 100_000 && value.commands.every(isGameCommand);
}

function validateSavedGameConsistency(saved: SavedGame): GameResult<SavedGame> {
  const replayed = replayCommands(saved.initialState, saved.commands);
  if (!replayed.ok) return { ok: false, error: `セーブデータを再現できません: ${replayed.error}` };
  if (!sameValue(replayed.value, saved.gameState))
    return { ok: false, error: 'セーブデータの状態がコマンド履歴と一致しません。' };
  return { ok: true, value: saved };
}

export function parseSavedGame(serialized: string): GameResult<SavedGame> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVE_BYTES)
    return { ok: false, error: 'セーブデータが大きすぎます。' };
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { return { ok: false, error: 'セーブデータが壊れています。' }; }
  if (!isRecord(value)) return { ok: false, error: 'セーブデータの形式が不正です。' };
  const migrated = migrateSavedGame(value);
  if (!migrated) return { ok: false, error: '未対応のセーブデータです。' };
  if (!validateSavedGameShape(migrated)) return { ok: false, error: 'セーブデータの内容が不正です。' };
  return validateSavedGameConsistency(migrated);
}

export function saveGame(storage: StorageLike, key: string, game: Omit<SavedGame, 'schemaVersion' | 'savedAt'>): GameResult<SavedGame> {
  const saved: SavedGame = { schemaVersion: SAVE_SCHEMA_VERSION, ...structuredClone(game), savedAt: new Date().toISOString() };
  if (!validateSavedGameShape(saved)) return { ok: false, error: 'セーブデータの内容が不正です。' };
  // Runtime saves originate from the already-applied command stream. Replaying
  // that entire stream for every autosave is O(n²); untrusted serialized data
  // is still replayed by parseSavedGame/loadGame before it can be used.
  const serialized = JSON.stringify(saved);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVE_BYTES)
    return { ok: false, error: 'セーブデータが大きすぎます。' };
  try { storage.setItem(key, serialized); return { ok: true, value: saved }; }
  catch { return { ok: false, error: 'セーブデータを書き込めませんでした。' }; }
}

export function loadGame(storage: StorageLike, keys: readonly string[] = [MANUAL_SAVE_KEY, AUTO_SAVE_KEY]): GameResult<SavedGame> | undefined {
  let firstError: GameResult<SavedGame> | undefined;
  for (const key of keys) {
    let raw: string | null;
    try { raw = storage.getItem(key); }
    catch { return { ok: false, error: 'セーブデータを読み込めませんでした。' }; }
    if (raw === null) continue;
    const parsed = parseSavedGame(raw);
    if (parsed.ok) return parsed;
    firstError ??= parsed;
  }
  return firstError;
}

export function hasSavedGame(storage: StorageLike): boolean {
  try { return [MANUAL_SAVE_KEY, AUTO_SAVE_KEY].some(key => {
    const raw = storage.getItem(key);
    return raw !== null && parseSavedGame(raw).ok;
  }); }
  catch { return false; }
}

/** Presence-only check used to offer explicit recovery for invalid saves. */
export function hasStoredSaveData(storage: StorageLike): boolean {
  try { return storage.getItem(MANUAL_SAVE_KEY) !== null || storage.getItem(AUTO_SAVE_KEY) !== null; }
  catch { return false; }
}

export function deleteSaves(storage: StorageLike): GameResult<void> {
  try {
    storage.removeItem(MANUAL_SAVE_KEY);
    storage.removeItem(AUTO_SAVE_KEY);
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: 'セーブデータを削除できませんでした。' };
  }
}
