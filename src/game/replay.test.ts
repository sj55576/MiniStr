import { describe, expect, it } from 'vitest';
import {
  createBoard, createGameState, createReplay, MAX_REPLAY_BYTES, parseReplay,
  REPLAY_SCHEMA_VERSION, serializeReplay, summarizeReplay, type GameCommand,
  type GameState, type PlayerId, type UnitKind, unitStats,
} from './index';

function unit(
  id: string,
  owner: PlayerId,
  x: number,
  hp: number,
  kind: UnitKind = 'infantry',
) {
  const stats = unitStats[kind];
  return {
    id, kind, owner, position: { x, y: 0 }, hp,
    fuel: stats.fuel, ammo: stats.ammo, hasMoved: false, hasActed: false,
  };
}

function duel(redHp = 100, blueHp = 1): GameState {
  const state = createGameState(createBoard(2, 1), 42);
  state.units = [unit('r1', 'red', 0, redHp), unit('b1', 'blue', 1, blueHp)];
  return state;
}

function finishedReplay() {
  const result = createReplay({
    mapId: 'skirmish',
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
      'skirmish',
      'hard',
    );
    expect(summary).toEqual({
      ok: true,
      value: {
        mapId: 'skirmish',
        difficulty: 'hard',
        winner: 'red',
        turns: 1,
        kills: { red: 1, blue: 0 },
        captures: { red: 0, blue: 0 },
      },
    });
  });

  it('counts a completed property capture', () => {
    const state = createGameState(createBoard(2, 1), 7);
    state.board.terrain[0]![0] = { kind: 'capital', owner: 'blue', capturePoints: 1 };
    state.units = [unit('r1', 'red', 0, 100), unit('b1', 'blue', 1, 100)];
    const summary = summarizeReplay(
      state,
      [{ type: 'capture', unitId: 'r1' }],
      'skirmish',
      'easy',
    );
    expect(summary.ok && summary.value.captures).toEqual({ red: 1, blue: 0 });
    expect(summary.ok && summary.value.winner).toBe('red');
  });

  it('includes CPU commands without rerunning AI decisions', () => {
    const commands: GameCommand[] = [
      { type: 'endTurn' },
      { type: 'attack', unitId: 'b1', targetId: 'r1' },
    ];
    const summary = summarizeReplay(duel(1, 100), commands, 'skirmish', 'normal');
    expect(summary.ok && summary.value).toMatchObject({
      winner: 'blue',
      turns: 2,
      kills: { red: 0, blue: 1 },
    });
  });

  it('rejects an unfinished or illegal command sequence', () => {
    expect(summarizeReplay(duel(), [], 'skirmish', 'normal'))
      .toEqual({ ok: false, error: 'リプレイに対局結果がありません。' });
    expect(summarizeReplay(
      duel(),
      [{ type: 'attack', unitId: 'missing', targetId: 'b1' }],
      'skirmish',
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
