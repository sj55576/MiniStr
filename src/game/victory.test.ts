import { describe, expect, it } from 'vitest';
import {
  createBoard, createGameState, evaluateScenario, getConditionProgress, holdConditionKey,
  isGameState, isVictoryConditionMet, maps, updateScenarioProgress, updateScenarioScores, type GameState,
  type ScenarioDefinition, type VictoryCondition,
} from './index';

const unit = (id: string, owner: 'red' | 'blue', x: number, y: number): GameState['units'][number] => ({
  id, owner, kind: 'infantry', position: { x, y }, hp: 100, hasMoved: false, hasActed: false,
});

function scenario(patch: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id: 'test', name: 'Test', briefing: 'Test scenario', board: createBoard(3, 1),
    startingGold: 0, initialUnits: [], victoryConditions: [], defeatConditions: [], ...patch,
  };
}

describe('data-driven victory conditions', () => {
  it('keeps four legacy maps compatible while allowing dedicated scenarios', () => {
    const legacyMaps = maps.filter(map => map.id !== 'landing');
    expect(legacyMaps).toHaveLength(4);
    for (const map of legacyMaps) {
      expect(map.briefing.length).toBeGreaterThan(0);
      expect(map.victoryConditions).toEqual([{ type: 'eliminate' }, { type: 'captureCapital' }]);
      expect(map.defeatConditions).toEqual(map.victoryConditions);
    }
  });

  it('meets eliminate only at zero enemy units', () => {
    const condition: VictoryCondition = { type: 'eliminate' };
    const state = createGameState(createBoard(1, 1));
    state.units = [unit('b', 'blue', 0, 0)];
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(false);
    state.units = [];
    expect(getConditionProgress(state, condition, 'red')).toEqual({ current: 1, target: 1, complete: true });
  });

  it('requires the enemy capital to be gone and a capital to be player-owned for legacy states', () => {
    const condition: VictoryCondition = { type: 'captureCapital' };
    const state = createGameState(createBoard(2, 1));
    state.board.terrain[0]![0] = { kind: 'capital' };
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(false);
    state.board.terrain[0]![0] = { kind: 'capital', owner: 'red' };
    state.board.terrain[0]![1] = { kind: 'capital', owner: 'blue' };
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(false);
    state.board.terrain[0]![1] = { kind: 'capital', owner: 'red' };
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(true);
  });

  it('does not treat a neutral capital captured beyond scenario deployment as victory', () => {
    const condition: VictoryCondition = { type: 'captureCapital' };
    const siege = maps.find(map => map.id === 'siege')!;
    const state = { ...createGameState(structuredClone(siege.board)), scenarioId: siege.id };
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(false);
    state.board.terrain[4]![6] = { kind: 'capital', owner: 'red', capturePoints: 20 };
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(false);
    state.board.terrain[9]![13] = { kind: 'capital', owner: 'red', capturePoints: 20 };
    expect(isVictoryConditionMet(state, condition, 'red')).toBe(true);
  });

  it('counts all hold targets once per completed turn and resets when one is lost', () => {
    const hold: VictoryCondition = { type: 'hold', positions: [{ x: 0, y: 0 }, { x: 2, y: 0 }], turns: 2 };
    const definition = scenario({ victoryConditions: [hold], defeatConditions: [hold] });
    let state = createGameState(definition.board);
    state.units = [unit('r1', 'red', 0, 0), unit('r2', 'red', 2, 0)];
    state = updateScenarioProgress(state, definition, 'red');
    expect(getConditionProgress(state, hold, 'red')).toEqual({ current: 1, target: 2, complete: false });
    state = updateScenarioProgress(state, definition, 'red');
    expect(getConditionProgress(state, hold, 'red').complete).toBe(true);
    state = { ...state, units: [state.units[0]!] };
    state = updateScenarioProgress(state, definition, 'red');
    expect(state.objectiveHoldTurns?.red?.[holdConditionKey(hold)]).toBe(0);
  });

  it('uses inclusive survive and score boundaries while keeping the final numbered turn playable', () => {
    const state = { ...createGameState(createBoard(1, 1)), turn: 5, scores: { red: 9 } };
    expect(isVictoryConditionMet(state, { type: 'survive', untilTurn: 5 }, 'red')).toBe(true);
    expect(isVictoryConditionMet(state, { type: 'survive', untilTurn: 6 }, 'red')).toBe(false);
    expect(isVictoryConditionMet(state, { type: 'score', target: 10 }, 'red')).toBe(false);
    state.scores.red = 10;
    expect(isVictoryConditionMet(state, { type: 'score', target: 10 }, 'red')).toBe(true);
    expect(evaluateScenario({ ...state, turn: 4 }, scenario({ turnLimit: 5 }))).toBeUndefined();
    expect(evaluateScenario(state, scenario({ turnLimit: 5 }))).toBeUndefined();
    expect(evaluateScenario({ ...state, turn: 6 }, scenario({ turnLimit: 5 }))).toBe('blue');
  });

  it('adds score from command state differences without mutating either state', () => {
    const before = createGameState(createBoard(2, 1));
    before.units = [unit('r', 'red', 0, 0), unit('b', 'blue', 1, 0)];
    before.board.terrain[0]![0] = { kind: 'city', owner: 'blue' };
    const after: GameState = {
      ...before,
      units: [before.units[0]!],
      board: { ...before.board, terrain: [[{ kind: 'city', owner: 'red' }, before.board.terrain[0]![1]!]] },
    };
    const scored = updateScenarioScores(before, after);
    expect(scored.scores).toEqual({ red: 2, blue: 0 });
    expect(before.scores).toBeUndefined();
    expect(after.scores).toBeUndefined();
  });

  it('strictly validates optional scenario save fields', () => {
    const valid = { ...createGameState(createBoard(1, 1)), scenarioId: 'skirmish', scores: { red: 2 }, objectiveHoldTurns: { red: { objective: 1 } } };
    expect(isGameState(valid)).toBe(true);
    expect(isGameState({ ...valid, scenarioId: 'missing' })).toBe(false);
    expect(isGameState({ ...valid, scores: { red: -1 } })).toBe(false);
    expect(isGameState({ ...valid, objectiveHoldTurns: { red: { objective: 1.5 } } })).toBe(false);
  });

  it('resolves simultaneous completion in favor of the active player', () => {
    const state = createGameState(createBoard(1, 1));
    state.turn = 3;
    const definition = scenario({
      victoryConditions: [{ type: 'survive', untilTurn: 3 }],
      defeatConditions: [{ type: 'survive', untilTurn: 3 }],
    });
    expect(evaluateScenario(state, definition)).toBe('red');
    expect(evaluateScenario({ ...state, activePlayer: 'blue' }, definition)).toBe('blue');
    expect(evaluateScenario({ ...state, activePlayer: 'blue' }, definition, 'red')).toBe('red');
  });

  it('gives achieved objectives priority over an expiring turn limit', () => {
    const state = createGameState(createBoard(1, 1));
    state.turn = 5;
    state.scores = { red: 10 };
    expect(evaluateScenario(state, scenario({
      victoryConditions: [{ type: 'score', target: 10 }], turnLimit: 5,
    }))).toBe('red');
  });
});
