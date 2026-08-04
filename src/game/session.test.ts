import { describe, expect, it } from 'vitest';
import {
  applyGameCommand, attackUnit, AUTO_SAVE_KEY, createBoard, createGameState, loadGame, MAX_SAVE_BYTES, moveUnit,
  hasSavedGame, isGameCommand, parseSavedGame, replayCommands, saveGame, SAVE_SCHEMA_VERSION, type GameCommand,
  createScenarioInitialState, saveCustomScenario, scenarioById, type GameState, type StorageLike, unitStats,
  deleteSaveSlot, getStorageUsage, listSaveSlots, loadGameFromSlot, saveGameToSlot, STORAGE_WARNING_BYTES,
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


describe('indirect fire movement rule', () => {
  it('blocks artillery and rockets from attacking after movement while preserving direct fire', () => {
    const artilleryState = createGameState(createBoard(4, 1));
    artilleryState.units = [
      { id: 'artillery', kind: 'artillery', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'target', kind: 'tank', owner: 'blue', position: { x: 3, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    const movedArtillery = moveUnit(artilleryState, 'artillery', { x: 1, y: 0 });
    expect(movedArtillery.ok).toBe(true);
    if (!movedArtillery.ok) return;
    expect(attackUnit(movedArtillery.value, 'artillery', 'target'))
      .toEqual({ ok: false, error: 'Indirect units cannot attack after moving' });

    const tankState = createGameState(createBoard(3, 1));
    tankState.units = [
      { id: 'tank', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'infantry', kind: 'infantry', owner: 'blue', position: { x: 2, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    const movedTank = moveUnit(tankState, 'tank', { x: 1, y: 0 });
    expect(movedTank.ok).toBe(true);
    if (!movedTank.ok) return;
    expect(attackUnit(movedTank.value, 'tank', 'infantry').ok).toBe(true);
  });

  it('marks only artillery and rockets as indirect units', () => {
    expect(unitStats.artillery.indirect).toBe(true);
    expect(unitStats.rocket.indirect).toBe(true);
    expect(unitStats.tank.indirect).toBe(false);
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

  it('migrates a valid v1 save and prefers a valid auto-save over corrupt manual data', () => {
    const storage = new MemoryStorage();
    const initialState = canonicalSkirmish();
    expect(saveGame(storage, AUTO_SAVE_KEY, { mapId: 'skirmish', difficulty: 'normal', initialState, commands: [], gameState: initialState }).ok).toBe(true);
    const legacy = { ...JSON.parse(storage.data.get(AUTO_SAVE_KEY)!), schemaVersion: 1 };
    expect(parseSavedGame(JSON.stringify(legacy)).ok).toBe(true);
    storage.setItem('ministr.save.manual', '{broken');
    expect(hasSavedGame(storage)).toBe(true);
    expect(loadGame(storage)?.ok).toBe(true);
  });

  it('round-trips a valid saved game containing an anti-air unit', () => {
    const storage = new MemoryStorage();
    const scenario = saveCustomScenario(storage, {
      id: 'anti-air-save-round-trip', name: '対空セーブ検証', briefing: '', startingGold: 0,
      board: { width: 2, height: 1, cells: [] },
      initialUnits: [{ kind: 'antiAir', owner: 'red', x: 0, y: 0 }, { kind: 'fighter', owner: 'blue', x: 1, y: 0 }],
      victoryConditions: [{ type: 'eliminate' }], defeatConditions: [{ type: 'eliminate' }],
    });
    expect(scenario.ok).toBe(true);
    if (!scenario.ok) return;
    const initialState = createScenarioInitialState(scenario.value);
    expect(saveGame(storage, AUTO_SAVE_KEY, {
      mapId: scenario.value.id, difficulty: 'normal', initialState, commands: [], gameState: initialState,
    }).ok).toBe(true);
    const loaded = loadGame(storage);
    expect(loaded?.ok && loaded.value.initialState.units).toEqual(initialState.units);
    expect(loaded?.ok && loaded.value.gameState.units.find(unit => unit.kind === 'antiAir')).toMatchObject({ id: 'r1', kind: 'antiAir' });
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


describe('wait command persistence', () => {
  it('replays and validates explicit wait commands', () => {
    const initial = withUnit();
    const commands: GameCommand[] = [{ type: 'wait', unitId: 'r1' }, { type: 'endTurn' }, { type: 'endTurn' }];
    const replayed = replayCommands(initial, commands);
    expect(replayed.ok && replayed.value.units[0]).toMatchObject({ hasMoved: false, hasActed: false });
    expect(isGameCommand({ type: 'wait', unitId: 'r1' })).toBe(true);
    expect(isGameCommand({ type: 'wait', unitId: 1 })).toBe(false);
  });

  it('migrates a v2 save to the current schema', () => {
    const storage = new MemoryStorage();
    const initialState = canonicalSkirmish();
    expect(saveGame(storage, AUTO_SAVE_KEY, { mapId: 'skirmish', difficulty: 'normal', initialState, commands: [], gameState: initialState }).ok).toBe(true);
    const legacy = { ...JSON.parse(storage.data.get(AUTO_SAVE_KEY)!), schemaVersion: 2 };
    const parsed = parseSavedGame(JSON.stringify(legacy));
    expect(parsed.ok && parsed.value.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });
});

describe('named save slots', () => {
  it('lists, loads, replaces, and deletes independently named saves', () => {
    const storage = new MemoryStorage();
    const initialState = canonicalSkirmish();
    const game = { mapId: 'skirmish', difficulty: 'hard' as const, initialState, commands: [], gameState: initialState };
    expect(saveGameToSlot(storage, 'campaign-one', '国境戦役', game).ok).toBe(true);
    expect(listSaveSlots(storage)).toEqual([expect.objectContaining({
      id: 'campaign-one', name: '国境戦役', mapId: 'skirmish', difficulty: 'hard', turn: 1, source: 'slot',
    })]);
    expect(loadGameFromSlot(storage, 'campaign-one')?.ok).toBe(true);
    expect(saveGameToSlot(storage, 'campaign-one', '国境戦役・続き', game).ok).toBe(true);
    expect(listSaveSlots(storage)[0]).toEqual(expect.objectContaining({ name: '国境戦役・続き' }));
    expect(deleteSaveSlot(storage, 'campaign-one')).toEqual({ ok: true, value: undefined });
    expect(loadGameFromSlot(storage, 'campaign-one')).toBeUndefined();
  });

  it('keeps legacy manual saves readable and rejects unsafe slot identifiers', () => {
    const storage = new MemoryStorage();
    const initialState = canonicalSkirmish();
    expect(saveGame(storage, AUTO_SAVE_KEY, { mapId: 'skirmish', difficulty: 'normal', initialState, commands: [], gameState: initialState }).ok).toBe(true);
    expect(listSaveSlots(storage)).toEqual([expect.objectContaining({ id: 'auto', source: 'legacy' })]);
    expect(loadGameFromSlot(storage, 'auto')?.ok).toBe(true);
    expect(saveGameToSlot(storage, '../unsafe', 'x', { mapId: 'skirmish', difficulty: 'normal', initialState, commands: [], gameState: initialState }))
      .toEqual({ ok: false, error: 'セーブスロット名またはIDが不正です。' });
  });

  it('reports the complete app storage footprint when keys can be enumerated', () => {
    const values = new Map<string, string>([
      ['ministr.save.auto', 'abc'], ['ministr.customScenarios', 'def'], ['foreign.key', 'ignored'],
    ]);
    const storage: StorageLike = {
      get length() { return values.size; },
      key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    };
    expect(getStorageUsage(storage)).toMatchObject({ itemCount: 2, warning: false });
    values.set('ministr.large', 'x'.repeat(STORAGE_WARNING_BYTES));
    expect(getStorageUsage(storage).warning).toBe(true);
  });
});
