import { createScenarioInitialState, scenarioById } from './maps';
import {
  applyGameCommand, isGameCommand, isGameState, replayCommands, type GameCommand,
} from './session';
import { countDestroyedDeployedUnits } from './victory';
import { type GameResult, type GameState, type PlayerId } from './types';

/**
 * Schema v1 is additive: `Unit.embarkedIn` is optional, so pre-landing-ship
 * replays remain valid.  Invalid cargo links are rejected by `isGameState` and
 * are never inferred or repaired while importing a replay.
 */
export const REPLAY_SCHEMA_VERSION = 2 as const;
export const MAX_REPLAY_BYTES = 1_000_000;
const MAX_REPLAY_COMMANDS = 100_000;

export type ReplayDifficulty = 'easy' | 'normal' | 'hard';

export interface ReplaySummary {
  mapId: string;
  difficulty: ReplayDifficulty;
  winner: PlayerId;
  turns: number;
  kills: Record<PlayerId, number>;
  captures: Record<PlayerId, number>;
}

export interface ReplayFile {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  mapId: string;
  difficulty: ReplayDifficulty;
  initialState: GameState;
  commands: GameCommand[];
  finalState: GameState;
  summary: ReplaySummary;
  createdAt: string;
}

function migrateReplayV1ToV2(value: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(value), schemaVersion: REPLAY_SCHEMA_VERSION };
}

function migrateReplay(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (value.schemaVersion === REPLAY_SCHEMA_VERSION) return value;
  if (value.schemaVersion === 1) return migrateReplayV1ToV2(value);
  return undefined;
}

export interface ReplayInput {
  mapId: string;
  difficulty: ReplayDifficulty;
  initialState: GameState;
  commands: readonly GameCommand[];
}

const difficulties = new Set<ReplayDifficulty>(['easy', 'normal', 'hard']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function isCountPair(value: unknown): value is Record<PlayerId, number> {
  return isRecord(value) && hasOnlyKeys(value, ['red', 'blue'])
    && Number.isSafeInteger(value.red) && (value.red as number) >= 0
    && Number.isSafeInteger(value.blue) && (value.blue as number) >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function isReplaySummary(value: unknown): value is ReplaySummary {
  return isRecord(value)
    && hasOnlyKeys(value, ['mapId', 'difficulty', 'winner', 'turns', 'kills', 'captures'])
    && typeof value.mapId === 'string' && scenarioById(value.mapId) !== undefined
    && typeof value.difficulty === 'string' && difficulties.has(value.difficulty as ReplayDifficulty)
    && (value.winner === 'red' || value.winner === 'blue')
    && Number.isSafeInteger(value.turns) && (value.turns as number) >= 1
    && isCountPair(value.kills) && isCountPair(value.captures);
}

function hasSafeJsonDepth(value: unknown, maxDepth = 128): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) return false;
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      for (const item of Object.values(current.value)) stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  return true;
}

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

function validateReplayShape(value: unknown): value is ReplayFile {
  const scenario = isRecord(value) && typeof value.mapId === 'string' ? scenarioById(value.mapId) : undefined;
  if (!hasSafeJsonDepth(value) || !isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'mapId', 'difficulty', 'initialState', 'commands', 'finalState', 'summary', 'createdAt'])
    || value.schemaVersion !== REPLAY_SCHEMA_VERSION
    || typeof value.mapId !== 'string' || scenario === undefined
    || typeof value.difficulty !== 'string' || !difficulties.has(value.difficulty as ReplayDifficulty)
    || !isGameState(value.initialState) || !sameValue(value.initialState, createScenarioInitialState(scenario)) || !isGameState(value.finalState)
    || !Array.isArray(value.commands) || value.commands.length > MAX_REPLAY_COMMANDS
    || !value.commands.every(isGameCommand)
    || !isReplaySummary(value.summary)
    || !isIsoTimestamp(value.createdAt)) return false;
  return value.summary.mapId === value.mapId && value.summary.difficulty === value.difficulty;
}

export function summarizeReplay(
  initialState: GameState,
  commands: readonly GameCommand[],
  mapId: string,
  difficulty: ReplayDifficulty,
): GameResult<ReplaySummary> {
  const scenario = scenarioById(mapId);
  if (!scenario || !difficulties.has(difficulty) || !isGameState(initialState)
    || !sameValue(initialState, createScenarioInitialState(scenario))
    || commands.length > MAX_REPLAY_COMMANDS || !commands.every(isGameCommand))
    return { ok: false, error: 'リプレイデータの内容が不正です。' };

  let state = structuredClone(initialState);
  const kills: Record<PlayerId, number> = { red: 0, blue: 0 };
  const captures: Record<PlayerId, number> = { red: 0, blue: 0 };

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (state.winner) return { ok: false, error: `Command ${index + 1}: Game has finished` };
    const previous = state;
    const result = applyGameCommand(previous, command);
    if (!result.ok) return { ok: false, error: `Command ${index + 1}: ${result.error}` };
    state = result.value;

    if (command.type === 'attack') {
      const destroyed = countDestroyedDeployedUnits(previous, state);
      kills.red += destroyed.red;
      kills.blue += destroyed.blue;
    }

    if (command.type === 'capture') {
      for (let y = 0; y < state.board.height; y += 1) {
        for (let x = 0; x < state.board.width; x += 1) {
          const beforeOwner = previous.board.terrain[y]?.[x]?.owner;
          const afterOwner = state.board.terrain[y]?.[x]?.owner;
          if (afterOwner && afterOwner !== beforeOwner) captures[afterOwner] += 1;
        }
      }
    }
  }

  if (!state.winner) return { ok: false, error: 'リプレイに対局結果がありません。' };
  return {
    ok: true,
    value: { mapId, difficulty, winner: state.winner, turns: state.turn, kills, captures },
  };
}

export function createReplay(input: ReplayInput): GameResult<ReplayFile> {
  const scenario = isRecord(input) && typeof input.mapId === 'string' ? scenarioById(input.mapId) : undefined;
  if (!isRecord(input) || !hasOnlyKeys(input, ['mapId', 'difficulty', 'initialState', 'commands'])
    || typeof input.mapId !== 'string' || scenario === undefined
    || typeof input.difficulty !== 'string' || !difficulties.has(input.difficulty as ReplayDifficulty)
    || !isGameState(input.initialState) || !sameValue(input.initialState, createScenarioInitialState(scenario)) || !Array.isArray(input.commands)
    || input.commands.length > MAX_REPLAY_COMMANDS || !input.commands.every(isGameCommand))
    return { ok: false, error: 'リプレイデータの内容が不正です。' };

  const replayed = replayCommands(input.initialState, input.commands);
  if (!replayed.ok) return { ok: false, error: `リプレイを再現できません: ${replayed.error}` };
  const summary = summarizeReplay(input.initialState, input.commands, input.mapId, input.difficulty);
  if (!summary.ok) return summary;
  const replay: ReplayFile = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    mapId: input.mapId,
    difficulty: input.difficulty,
    initialState: structuredClone(input.initialState),
    commands: [...structuredClone(input.commands)],
    finalState: replayed.value,
    summary: summary.value,
    createdAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(replay);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_BYTES)
    return { ok: false, error: 'リプレイデータが大きすぎます。' };
  return { ok: true, value: replay };
}

function validateReplayConsistency(replay: ReplayFile): GameResult<ReplayFile> {
  const replayed = replayCommands(replay.initialState, replay.commands);
  if (!replayed.ok) return { ok: false, error: `リプレイを再現できません: ${replayed.error}` };
  if (!sameValue(replayed.value, replay.finalState))
    return { ok: false, error: 'リプレイの最終状態がコマンド履歴と一致しません。' };
  const summary = summarizeReplay(replay.initialState, replay.commands, replay.mapId, replay.difficulty);
  if (!summary.ok) return summary;
  if (!sameValue(summary.value, replay.summary))
    return { ok: false, error: 'リプレイの対局サマリーがコマンド履歴と一致しません。' };
  return { ok: true, value: structuredClone(replay) };
}

export function serializeReplay(replay: ReplayFile): GameResult<string> {
  if (!validateReplayShape(replay)) return { ok: false, error: 'リプレイデータの内容が不正です。' };
  const validated = validateReplayConsistency(replay);
  if (!validated.ok) return validated;
  const serialized = JSON.stringify(validated.value);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_BYTES)
    return { ok: false, error: 'リプレイデータが大きすぎます。' };
  return { ok: true, value: serialized };
}

export function parseReplay(serialized: string): GameResult<ReplayFile> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_BYTES)
    return { ok: false, error: 'リプレイデータが大きすぎます。' };
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { return { ok: false, error: 'リプレイデータが壊れています。' }; }
  if (!isRecord(value)) return { ok: false, error: 'リプレイデータの形式が不正です。' };
  const migrated = migrateReplay(value);
  if (!migrated)
    return { ok: false, error: '未対応のリプレイデータです。' };
  if (!validateReplayShape(migrated)) return { ok: false, error: 'リプレイデータの内容が不正です。' };
  try { return validateReplayConsistency(migrated); }
  catch { return { ok: false, error: 'リプレイデータの内容が不正です。' }; }
}
