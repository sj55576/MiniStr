import { describe, expect, it } from 'vitest';
import {
  countDestroyedDeployedUnits, createBoard, createGameState, evaluateScenario, getConditionProgress, holdConditionKey,
  isGameState, isVictoryConditionMet, loadScenarioDefinitions, maps, updateScenarioProgress, updateScenarioScores, type GameState,
  type ScenarioDefinition, type VictoryCondition,
} from './index';

const unit = (id: string, owner: 'red' | 'blue', x: number, y: number): GameState['units'][number] => ({
  id, owner, kind: 'infantry', position: { x, y }, hp: 100, hasMoved: false, hasActed: false,
});

function scenario(patch: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id: 'test', name: 'Test', briefing: 'Test scenario', board: createBoard(3, 1), theme: 'temperate',
    productionRules: 'facility-v2', startingGold: 0, initialUnits: [], victoryConditions: [], defeatConditions: [], ...patch,
  };
}

/** Scenarios that deliberately replace the shared eliminate/capture objective pair. */
const dedicatedObjectiveIds = new Set(['landing', 'industrial', 'tundra']);

describe('data-driven victory conditions', () => {
  it('keeps the standard-objective maps mirrored while allowing dedicated scenarios', () => {
    const standardMaps = maps.filter(map => !dedicatedObjectiveIds.has(map.id));
    expect(standardMaps.map(map => map.id)).toEqual(['skirmish', 'islands', 'canyon', 'siege', 'river', 'outpost']);
    for (const map of standardMaps) {
      expect(map.briefing.length).toBeGreaterThan(0);
      expect(map.victoryConditions).toEqual([{ type: 'eliminate' }, { type: 'captureCapital' }]);
      // A turn limit is normalized into an extra survive condition on blue's list.
      expect(map.defeatConditions).toEqual(map.turnLimit === undefined
        ? map.victoryConditions
        : [...map.victoryConditions, { type: 'survive', untilTurn: map.turnLimit + 1 }]);
    }
  });

  it('gives the dedicated scenarios their own briefed objectives', () => {
    const dedicated = maps.filter(map => dedicatedObjectiveIds.has(map.id));
    expect(dedicated.map(map => map.id)).toEqual(['landing', 'industrial', 'tundra']);
    for (const map of dedicated) {
      expect(map.briefing.length).toBeGreaterThan(0);
      expect(map.victoryConditions).not.toEqual([{ type: 'eliminate' }, { type: 'captureCapital' }]);
      expect(map.victoryConditions.length).toBeGreaterThan(0);
      expect(map.defeatConditions.length).toBeGreaterThan(0);
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
    const loaded = loadScenarioDefinitions([{
      id: 'legacy-timeout', name: 'Legacy timeout', briefing: 'Test', startingGold: 0,
      board: { width: 1, height: 1, cells: [] }, initialUnits: [],
      victoryConditions: [{ type: 'score', target: 99 }],
      defeatConditions: [{ type: 'score', target: 99 }],
      turnLimit: 5,
    }]);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const timedScenario = loaded.value[0]!;
    expect(timedScenario.defeatConditions).toContainEqual({ type: 'survive', untilTurn: 6 });
    expect(evaluateScenario({ ...state, turn: 4 }, timedScenario)).toBeUndefined();
    expect(evaluateScenario(state, timedScenario)).toBeUndefined();
    expect(evaluateScenario({ ...state, turn: 6 }, timedScenario)).toBe('blue');
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

  it('resolves an objective and normalized turn limit together through the active-player tie breaker', () => {
    const loaded = loadScenarioDefinitions([{
      id: 'timeout-tie', name: 'Timeout tie', briefing: 'Test', startingGold: 0,
      board: { width: 1, height: 1, cells: [] }, initialUnits: [],
      victoryConditions: [{ type: 'score', target: 10 }],
      defeatConditions: [{ type: 'survive', untilTurn: 7 }],
      turnLimit: 5,
    }]);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const state = { ...createGameState(loaded.value[0]!.board), turn: 6, scores: { red: 10 } };
    expect(evaluateScenario(state, loaded.value[0]!)).toBe('red');
    expect(evaluateScenario({ ...state, activePlayer: 'blue' }, loaded.value[0]!)).toBe('blue');
  });
});

describe('destroyed-unit accounting', () => {
  it('consistently excludes cargo lost with its transport from scores and replay summaries', () => {
    const previous = createGameState(createBoard(2, 1));
    previous.units = [
      { id: 'r-ship', kind: 'landingShip', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 0, hasMoved: false, hasActed: false },
      { id: 'r-cargo', kind: 'infantry', owner: 'red', embarkedIn: 'r-ship', hp: 100, ammo: 9, hasMoved: false, hasActed: false },
    ];
    expect(countDestroyedDeployedUnits(previous, { ...previous, units: [] })).toEqual({ red: 0, blue: 1 });
  });
});
