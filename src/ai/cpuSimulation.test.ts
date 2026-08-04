import { describe, expect, it } from 'vitest';
import { applyGameCommand, createScenarioInitialState, maps, type GameState } from '../game';
import { chooseCpuAction, type CpuDifficulty } from './rules';

function playTurn(state: GameState, difficulty: CpuDifficulty): GameState {
  let current = state;
  // A side may produce, move, capture, and attack several times. The bound is
  // deliberately generous while still catching a CPU that stops consuming turns.
  for (let steps = 0; steps < 120 && !current.winner; steps += 1) {
    const command = chooseCpuAction(current, difficulty);
    const result = applyGameCommand(current, command);
    expect(result, `${difficulty} ${current.scenarioId ?? 'scenario'}: ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    if (!result.ok) return current;
    current = result.value;
    if (command.type === 'endTurn') return current;
  }
  return current;
}

describe('CPU-versus-CPU scenario regression', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'runs every built-in scenario at %s without issuing illegal commands',
    (difficulty) => {
      for (const scenario of maps) {
        let state = createScenarioInitialState(scenario);
        for (let round = 0; round < 60 && !state.winner; round += 1) {
          const startingTurn = state.turn;
          state = playTurn(state, difficulty);
          if (!state.winner) state = playTurn(state, difficulty);
          expect(Boolean(state.winner) || state.turn > startingTurn, `${scenario.id}/${difficulty} must finish or advance a round`).toBe(true);
        }
      }
    },
    30_000,
  );
});
