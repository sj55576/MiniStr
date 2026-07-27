import { describe, expect, it } from 'vitest';
import {
  createReplay, createScenarioInitialState, MAX_REPLAY_BYTES, parseReplay,
  REPLAY_SCHEMA_VERSION, saveCustomScenario, serializeReplay, summarizeReplay, type GameCommand,
  type GameState, type ScenarioData,
} from './index';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const replayScenario: ScenarioData = {
  id: 'replay-test-scenario', name: 'リプレイ試験', briefing: '', startingGold: 0,
  board: { width: 2, height: 1, cells: [] },
  initialUnits: [{ kind: 'bomber', owner: 'red', x: 0, y: 0 }, { kind: 'infantry', owner: 'blue', x: 1, y: 0 }],
  victoryConditions: [{ type: 'eliminate' }], defeatConditions: [{ type: 'eliminate' }],
};
const savedScenario = saveCustomScenario(new MemoryStorage(), replayScenario);
if (!savedScenario.ok) throw new Error(savedScenario.error);
const duel = (): GameState => createScenarioInitialState(savedScenario.value);
const mapId = replayScenario.id;

function finishedReplay() {
  const result = createReplay({
    mapId,
    difficulty: 'normal',
    initialState: duel(),
    commands: [{ type: 'attack', unitId: 'r1', targetId: 'b1' }],
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('replay summaries', () => {
  it('counts destroyed units and returns the deterministic result', () => {
    const summary = summarizeReplay(
      duel(),
      [{ type: 'attack', unitId: 'r1', targetId: 'b1' }],
      mapId,
      'hard',
    );
    expect(summary).toEqual({
      ok: true,
      value: {
        mapId,
        difficulty: 'hard',
        winner: 'red',
        turns: 1,
        kills: { red: 1, blue: 0 },
        captures: { red: 0, blue: 0 },
      },
    });
  });

  it('counts a completed property capture', () => {
    const summary = summarizeReplay(duel(), [{ type: 'attack', unitId: 'r1', targetId: 'b1' }], mapId, 'easy');
    expect(summary.ok && summary.value.captures).toEqual({ red: 0, blue: 0 });
    expect(summary.ok && summary.value.winner).toBe('red');
  });

  it('includes CPU commands without rerunning AI decisions', () => {
    const commands: GameCommand[] = [{ type: 'attack', unitId: 'r1', targetId: 'b1' }];
    const summary = summarizeReplay(duel(), commands, mapId, 'normal');
    expect(summary.ok && summary.value).toMatchObject({
      winner: 'red',
      turns: 1,
      kills: { red: 1, blue: 0 },
    });
  });

  it('rejects commands appended after the result is decided', () => {
    const result = createReplay({
      mapId,
      difficulty: 'normal',
      initialState: duel(),
      commands: [
        { type: 'attack', unitId: 'r1', targetId: 'b1' },
        { type: 'endTurn' },
      ],
    });
    expect(result).toEqual({ ok: false, error: 'Command 2: Game has finished' });
  });

  it('rejects an unfinished or illegal command sequence', () => {
    expect(summarizeReplay(duel(), [], mapId, 'normal'))
      .toEqual({ ok: false, error: 'リプレイに対局結果がありません。' });
    expect(summarizeReplay(
      duel(),
      [{ type: 'attack', unitId: 'missing', targetId: 'b1' }],
      mapId,
      'normal',
    )).toEqual({ ok: false, error: 'Command 1: Unit cannot attack' });
  });
});

describe('versioned replay files', () => {
  it('creates, serializes, and parses a replay round trip', () => {
    const replay = finishedReplay();
    expect(replay.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(replay.finalState.winner).toBe('red');

    const serialized = serializeReplay(replay);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = parseReplay(serialized.value);
    expect(parsed).toEqual({ ok: true, value: replay });
  });

  it('rejects malformed, unsupported, oversized, and structurally invalid data', () => {
    expect(parseReplay('{broken')).toEqual({ ok: false, error: 'リプレイデータが壊れています。' });
    expect(parseReplay(JSON.stringify({ schemaVersion: 999 })))
      .toEqual({ ok: false, error: '未対応のリプレイデータです。' });
    expect(parseReplay(' '.repeat(MAX_REPLAY_BYTES + 1)))
      .toEqual({ ok: false, error: 'リプレイデータが大きすぎます。' });

    const invalid = { ...finishedReplay(), unexpected: true };
    expect(parseReplay(JSON.stringify(invalid)))
      .toEqual({ ok: false, error: 'リプレイデータの内容が不正です。' });
  });

  it('rejects deeply nested unknown data without throwing', () => {
    const serialized = serializeReplay(finishedReplay());
    if (!serialized.ok) throw new Error(serialized.error);
    const depth = 20_000;
    const nested = '{"next":'.repeat(depth) + 'null' + '}'.repeat(depth);
    const deeplyNested = serialized.value.replace(
      '"initialState":{',
      `"initialState":{"unknown":${nested},`,
    );
    let result: ReturnType<typeof parseReplay> | undefined;
    expect(() => { result = parseReplay(deeplyNested); }).not.toThrow();
    expect(result).toEqual({ ok: false, error: 'リプレイデータの内容が不正です。' });
  });

  it('rejects invalid commands and mismatched final state', () => {
    const replay = finishedReplay();
    const invalidCommand = {
      ...replay,
      commands: [{ type: 'move', unitId: 'r1', destination: { x: 'bad', y: 0 } }],
    };
    expect(parseReplay(JSON.stringify(invalidCommand)))
      .toEqual({ ok: false, error: 'リプレイデータの内容が不正です。' });

    const mismatched = {
      ...replay,
      finalState: { ...replay.finalState, turn: replay.finalState.turn + 1 },
    };
    expect(parseReplay(JSON.stringify(mismatched)))
      .toEqual({ ok: false, error: 'リプレイの最終状態がコマンド履歴と一致しません。' });
  });

  it('rejects a replay whose otherwise self-consistent initial units were edited', () => {
    const replay = finishedReplay();
    const editedInitial = { ...replay.initialState, units: replay.initialState.units.slice(0, 1) };
    const edited = { ...replay, initialState: editedInitial, finalState: editedInitial, commands: [] };
    expect(parseReplay(JSON.stringify(edited)))
      .toEqual({ ok: false, error: 'リプレイデータの内容が不正です。' });
  });

  it('rejects a summary that does not match the command history', () => {
    const replay = finishedReplay();
    const mismatched = {
      ...replay,
      summary: { ...replay.summary, kills: { red: 0, blue: 1 } },
    };
    expect(parseReplay(JSON.stringify(mismatched)))
      .toEqual({ ok: false, error: 'リプレイの対局サマリーがコマンド履歴と一致しません。' });
  });
});
