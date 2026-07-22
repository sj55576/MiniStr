import { attackUnit, captureProperty, endTurn, moveUnit, produceUnit } from './commands';
import { maps } from './maps';
import type { GameResult, GameState, Position, UnitKind } from './types';

export const SAVE_SCHEMA_VERSION = 1 as const;
export const MAX_SAVE_BYTES = 1_000_000;
export const MANUAL_SAVE_KEY = 'ministr.save.manual';
export const AUTO_SAVE_KEY = 'ministr.save.auto';

export type GameCommand =
  | { type: 'move'; unitId: string; destination: Position }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'capture'; unitId: string }
  | { type: 'produce'; factory: Position; kind: UnitKind }
  | { type: 'endTurn' };

export interface SavedGame {
  schemaVersion: typeof SAVE_SCHEMA_VERSION;
  mapId: string;
  difficulty: 'easy' | 'normal' | 'hard';
  initialState: GameState;
  commands: GameCommand[];
  gameState: GameState;
  savedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function applyGameCommand(state: GameState, command: GameCommand): GameResult {
  switch (command.type) {
    case 'move': return moveUnit(state, command.unitId, command.destination);
    case 'attack': return attackUnit(state, command.unitId, command.targetId);
    case 'capture': return captureProperty(state, command.unitId);
    case 'produce': return produceUnit(state, command.factory, command.kind);
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
const unitKinds = new Set<UnitKind>(['infantry', 'tank', 'artillery', 'fighter', 'bomber', 'destroyer', 'recon', 'rocket']);
const terrainKinds = new Set(['plain', 'forest', 'road', 'mountain', 'sea', 'city', 'factory', 'capital']);
const players = new Set(['red', 'blue']);
const mapIds = new Set(maps.map(map => map.id));

export function isGameCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'endTurn') return true;
  if (value.type === 'move') return typeof value.unitId === 'string' && isPosition(value.destination);
  if (value.type === 'attack') return typeof value.unitId === 'string' && typeof value.targetId === 'string';
  if (value.type === 'capture') return typeof value.unitId === 'string';
  return value.type === 'produce' && isPosition(value.factory)
    && typeof value.kind === 'string' && unitKinds.has(value.kind as UnitKind);
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
    isRecord(tile) && typeof tile.kind === 'string' && terrainKinds.has(tile.kind)
    && (tile.owner === undefined || players.has(tile.owner as string))
    && (tile.capturePoints === undefined || (isFiniteNumber(tile.capturePoints) && tile.capturePoints >= 0 && tile.capturePoints <= 20))))) return false;

  if (value.units.length > 4096) return false;
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const unit of value.units) {
    if (!isRecord(unit) || typeof unit.id !== 'string' || ids.has(unit.id)
      || typeof unit.kind !== 'string' || !unitKinds.has(unit.kind as UnitKind)
      || typeof unit.owner !== 'string' || !players.has(unit.owner)
      || !isPosition(unit.position) || unit.position.x < 0 || unit.position.y < 0
      || unit.position.x >= (width as number) || unit.position.y >= (height as number)
      || !isFiniteNumber(unit.hp) || unit.hp <= 0 || unit.hp > 100
      || (unit.fuel !== undefined && (!isFiniteNumber(unit.fuel) || unit.fuel < 0))
      || (unit.ammo !== undefined && (!isFiniteNumber(unit.ammo) || unit.ammo < 0))
      || typeof unit.hasMoved !== 'boolean' || typeof unit.hasActed !== 'boolean') return false;
    const position = `${unit.position.x},${unit.position.y}`;
    if (positions.has(position)) return false;
    ids.add(unit.id);
    positions.add(position);
  }
  const validPlayerState = (state: unknown) =>
    isRecord(state) && isFiniteNumber(state.gold) && state.gold >= 0
    && isFiniteNumber(state.income) && state.income >= 0;
  return validPlayerState(value.players.red) && validPlayerState(value.players.blue)
    && typeof value.activePlayer === 'string' && players.has(value.activePlayer)
    && Number.isInteger(value.turn) && (value.turn as number) >= 1
    && Number.isSafeInteger(value.rngSeed) && (value.rngSeed as number) >= 0 && (value.rngSeed as number) <= 0xffff_ffff
    && Number.isSafeInteger(value.nextUnitId) && (value.nextUnitId as number) >= 1
    && (value.winner === undefined || players.has(value.winner as string));
}

export function parseSavedGame(serialized: string): GameResult<SavedGame> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVE_BYTES)
    return { ok: false, error: 'セーブデータが大きすぎます。' };
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { return { ok: false, error: 'セーブデータが壊れています。' }; }
  if (!isRecord(value)) return { ok: false, error: 'セーブデータの形式が不正です。' };
  if (value.schemaVersion !== SAVE_SCHEMA_VERSION) return { ok: false, error: '未対応のセーブデータです。' };
  if (typeof value.mapId !== 'string' || !mapIds.has(value.mapId)
    || !['easy', 'normal', 'hard'].includes(String(value.difficulty))
    || typeof value.savedAt !== 'string' || !isGameState(value.initialState) || !isGameState(value.gameState)
    || !Array.isArray(value.commands) || value.commands.length > 100_000 || !value.commands.every(isGameCommand))
    return { ok: false, error: 'セーブデータの内容が不正です。' };
  const saved = value as unknown as SavedGame;
  const replayed = replayCommands(saved.initialState, saved.commands);
  if (!replayed.ok) return { ok: false, error: `セーブデータを再現できません: ${replayed.error}` };
  if (JSON.stringify(replayed.value) !== JSON.stringify(saved.gameState))
    return { ok: false, error: 'セーブデータの状態がコマンド履歴と一致しません。' };
  return { ok: true, value: saved };
}

export function saveGame(storage: StorageLike, key: string, game: Omit<SavedGame, 'schemaVersion' | 'savedAt'>): GameResult<SavedGame> {
  const saved: SavedGame = { schemaVersion: SAVE_SCHEMA_VERSION, ...structuredClone(game), savedAt: new Date().toISOString() };
  const serialized = JSON.stringify(saved);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAVE_BYTES)
    return { ok: false, error: 'セーブデータが大きすぎます。' };
  try { storage.setItem(key, serialized); return { ok: true, value: saved }; }
  catch { return { ok: false, error: 'セーブデータを書き込めませんでした。' }; }
}

export function loadGame(storage: StorageLike, keys: readonly string[] = [MANUAL_SAVE_KEY, AUTO_SAVE_KEY]): GameResult<SavedGame> | undefined {
  for (const key of keys) {
    let raw: string | null;
    try { raw = storage.getItem(key); }
    catch { return { ok: false, error: 'セーブデータを読み込めませんでした。' }; }
    if (raw !== null) return parseSavedGame(raw);
  }
  return undefined;
}

export function hasSavedGame(storage: StorageLike): boolean {
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
