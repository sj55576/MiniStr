import { describe, expect, it } from 'vitest';
import {
  applyGameCommand, AUTO_SAVE_KEY, createBoard, createGameState, loadGame, MAX_SAVE_BYTES,
  parseSavedGame, replayCommands, saveGame, SAVE_SCHEMA_VERSION, type GameCommand,
  createScenarioInitialState, scenarioById, type GameState, type StorageLike, unitStats,
} from './index';

function withUnit(): GameState {
  const state = createGameState(createBoard(3, 1), 42);
  state.units = [{
    id: 'r1', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100,
    fuel: unitStats.infantry.fuel, ammo: unitStats.infantry.ammo, hasMoved: false, hasActed: false,
  }];
  return state;
}

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function replay(initialState: GameState, commands: GameCommand[]): GameState {
  const result = replayCommands(initialState, commands);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function canonicalSkirmish(): GameState {
  return createScenarioInitialState(scenarioById('skirmish')!);
}

describe('Phase 5.1 command history', () => {
  it('replays the same initial state and command sequence deterministically', () => {
    const initial = withUnit();
    const commands: GameCommand[] = [
      { type: 'move', unitId: 'r1', destination: { x: 2, y: 0 } },
      { type: 'endTurn' },
      { type: 'endTurn' },
    ];
    const replayed = replayCommands(initial, commands);
    let applied = structuredClone(initial);
    for (const command of commands) {
      const result = applyGameCommand(applied, command);
      expect(result.ok).toBe(true);
      if (result.ok) applied = result.value;
    }
    expect(replayed.ok && replayed.value).toEqual(applied);
    expect(initial.units[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('reports the command index when replay contains an illegal action', () => {
    expect(replayCommands(withUnit(), [{ type: 'move', unitId: 'missing', destination: { x: 1, y: 0 } }]))
      .toEqual({ ok: false, error: 'Command 1: Unit not found' });
  });
});

describe('versioned save persistence', () => {
  it('round-trips a save and verifies its final state against replay', () => {
    const storage = new MemoryStorage();
    const initialState = canonicalSkirmish();
    const commands: GameCommand[] = [];
    const gameState = replay(initialState, commands);
    expect(saveGame(storage, AUTO_SAVE_KEY, { mapId: 'skirmish', difficulty: 'normal', initialState, commands, gameState }).ok).toBe(true);
    const loaded = loadGame(storage);
    expect(loaded?.ok).toBe(true);
    expect(loaded?.ok && loaded.value.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded?.ok && loaded.value.gameState).toEqual(gameState);
  });

  it('preserves a valid campaign battle marker and rejects a mismatched marker', () => {
    const storage = new MemoryStorage();
    const initialState = canonicalSkirmish();
    const saved = saveGame(storage, AUTO_SAVE_KEY, {
      mapId: 'skirmish', difficulty: 'normal', initialState, commands: [],
      gameState: initialState, campaignScenarioId: 'skirmish',
    });
    expect(saved.ok && saved.value.campaignScenarioId).toBe('skirmish');
    const raw = JSON.parse(storage.data.get(AUTO_SAVE_KEY)!);
    raw.campaignScenarioId = 'canyon';
    expect(parseSavedGame(JSON.stringify(raw))).toEqual({ ok: false, error: 'セーブデータの内容が不正です。' });
  });

  it('rejects malformed JSON and unsupported versions without throwing', () => {
    expect(parseSavedGame('{broken')).toEqual({ ok: false, error: 'セーブデータが壊れています。' });
    expect(parseSavedGame(JSON.stringify({ schemaVersion: 999 }))).toEqual({ ok: false, error: '未対応のセーブデータです。' });
  });

  it('rejects structurally invalid commands and state', () => {
    const initialState = canonicalSkirmish();
    const invalid = {
      schemaVersion: SAVE_SCHEMA_VERSION, mapId: 'skirmish', difficulty: 'normal',
      savedAt: new Date().toISOString(), initialState, gameState: initialState,
      commands: [{ type: 'move', unitId: 'r1', destination: { x: 'bad', y: 0 } }],
    };
    expect(parseSavedGame(JSON.stringify(invalid))).toEqual({ ok: false, error: 'セーブデータの内容が不正です。' });
  });

  it('rejects a final state that does not match the command history', () => {
    const initialState = canonicalSkirmish();
    const commands: GameCommand[] = [];
    const invalid = {
      schemaVersion: SAVE_SCHEMA_VERSION, mapId: 'skirmish', difficulty: 'normal',
      savedAt: new Date().toISOString(), initialState, commands, gameState: { ...initialState, turn: initialState.turn + 1 },
    };
    expect(parseSavedGame(JSON.stringify(invalid))).toEqual({ ok: false, error: 'セーブデータの状態がコマンド履歴と一致しません。' });
  });

  it('rejects a self-consistent save whose initial gold was edited', () => {
    const initialState = canonicalSkirmish();
    const edited = { ...initialState, players: { ...initialState.players, red: { ...initialState.players.red, gold: 999999 } } };
    const invalid = {
      schemaVersion: SAVE_SCHEMA_VERSION, mapId: 'skirmish', difficulty: 'normal',
      savedAt: new Date().toISOString(), initialState: edited, commands: [], gameState: edited,
    };
    expect(parseSavedGame(JSON.stringify(invalid))).toEqual({ ok: false, error: 'セーブデータの内容が不正です。' });
  });

  it('rejects oversized data before parsing it', () => {
    expect(parseSavedGame(' '.repeat(MAX_SAVE_BYTES + 1))).toEqual({ ok: false, error: 'セーブデータが大きすぎます。' });
  });

  it('handles unavailable browser storage without throwing', () => {
    const unavailable: StorageLike = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const initialState = canonicalSkirmish();
    expect(loadGame(unavailable)).toEqual({ ok: false, error: 'セーブデータを読み込めませんでした。' });
    expect(saveGame(unavailable, AUTO_SAVE_KEY, {
      mapId: 'skirmish', difficulty: 'normal', initialState, commands: [], gameState: initialState,
    })).toEqual({ ok: false, error: 'セーブデータを書き込めませんでした。' });
  });
});
