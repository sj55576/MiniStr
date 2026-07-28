import { scenarioById, type ScenarioDefinition, type VictoryCondition } from './maps';
import { isDeployedUnit, otherPlayer, type GameState, type PlayerId, type Position } from './types';

export interface ConditionProgress { current: number; target: number; complete: boolean }

const positionKey = ({ x, y }: Position) => `${x},${y}`;

/** Stable key used to persist a hold condition's consecutive-turn progress. */
export function holdConditionKey(condition: Extract<VictoryCondition, { type: 'hold' }>): string {
  return `hold:${condition.positions.map(positionKey).join('|')}:${condition.turns}`;
}

function playerHoldsPositions(state: GameState, player: PlayerId, positions: readonly Position[]): boolean {
  return positions.length > 0 && positions.every(position => state.units.some(unit =>
    unit.owner === player && isDeployedUnit(unit) && unit.position.x === position.x && unit.position.y === position.y));
}

export function getConditionProgress(state: GameState, condition: VictoryCondition, player: PlayerId): ConditionProgress {
  let current: number;
  let target: number;
  switch (condition.type) {
    case 'eliminate': {
      const enemies = state.units.filter(unit => unit.owner === otherPlayer(player) && isDeployedUnit(unit)).length;
      current = enemies === 0 ? 1 : 0;
      target = 1;
      break;
    }
    case 'captureCapital': {
      const scenario = scenarioById(state.scenarioId);
      if (scenario) {
        const enemy = otherPlayer(player);
        // A known scenario establishes which HQs belong to the opponent. Capturing
        // a neutral capital must not complete this objective, even if it increases
        // the player's total number of capitals.
        const capturedEnemyCapital = scenario.board.terrain.some((row, y) => row.some((initialTile, x) =>
          initialTile.kind === 'capital'
          && initialTile.owner === enemy
          && state.board.terrain[y]?.[x]?.kind === 'capital'
          && state.board.terrain[y]?.[x]?.owner === player));
        current = capturedEnemyCapital ? 1 : 0;
      } else {
        const ownedCapitals = state.board.terrain.flat().filter(tile => tile.kind === 'capital' && tile.owner === player).length;
        const enemyCapitals = state.board.terrain.flat()
          .filter(tile => tile.kind === 'capital' && tile.owner === otherPlayer(player)).length;
        // Legacy saves without a resolvable scenario keep their board-only rule.
        current = enemyCapitals === 0 && ownedCapitals > 0 ? 1 : 0;
      }
      target = 1;
      break;
    }
    case 'hold':
      current = state.objectiveHoldTurns?.[player]?.[holdConditionKey(condition)] ?? 0;
      target = condition.turns;
      break;
    case 'survive':
      current = state.turn;
      target = condition.untilTurn;
      break;
    case 'score':
      current = state.scores?.[player] ?? 0;
      target = condition.target;
      break;
  }
  return { current, target, complete: current >= target };
}

export function isVictoryConditionMet(state: GameState, condition: VictoryCondition, player: PlayerId): boolean {
  return getConditionProgress(state, condition, player).complete;
}

export function describeVictoryCondition(condition: VictoryCondition): string {
  switch (condition.type) {
    case 'eliminate': return '敵部隊を全滅させる';
    case 'captureCapital': return '敵司令部を占領する';
    case 'hold': return `指定地点を${condition.turns}ターン連続で保持する`;
    case 'survive': return `${condition.untilTurn}ターンまで生存する`;
    case 'score': return `スコア${condition.target}を獲得する`;
  }
}

/**
 * Counts destroyed deployed units for score and replay summaries. Cargo lost
 * with a transport is intentionally not counted: it was not a board combatant
 * at the time it disappeared.
 */
export function countDestroyedDeployedUnits(previous: GameState, next: GameState): Record<PlayerId, number> {
  const destroyed: Record<PlayerId, number> = { red: 0, blue: 0 };
  const survivors = new Set(next.units.map(unit => unit.id));
  for (const unit of previous.units) {
    if (isDeployedUnit(unit) && !survivors.has(unit.id)) destroyed[otherPlayer(unit.owner)] += 1;
  }
  return destroyed;
}

/**
 * Records one completed turn for hold objectives. Progress is consecutive: leaving
 * any required tile resets that player's counter. Other players' progress is kept.
 */
export function updateScenarioProgress(state: GameState, scenario: ScenarioDefinition, player: PlayerId): GameState {
  const holdConditions = [...scenario.victoryConditions, ...scenario.defeatConditions]
    .filter((condition): condition is Extract<VictoryCondition, { type: 'hold' }> => condition.type === 'hold');
  if (holdConditions.length === 0) return state;
  const previous = state.objectiveHoldTurns?.[player] ?? {};
  const next = { ...previous };
  const updated = new Set<string>();
  for (const condition of holdConditions) {
    const key = holdConditionKey(condition);
    if (updated.has(key)) continue;
    updated.add(key);
    next[key] = playerHoldsPositions(state, player, condition.positions) ? (previous[key] ?? 0) + 1 : 0;
  }
  return { ...state, objectiveHoldTurns: { ...state.objectiveHoldTurns, [player]: next } };
}

/** Adds one point per enemy destroyed and per property newly captured in a command. */
export function updateScenarioScores(previous: GameState, next: GameState): GameState {
  const scores = { red: previous.scores?.red ?? 0, blue: previous.scores?.blue ?? 0 };
  const destroyed = countDestroyedDeployedUnits(previous, next);
  scores.red += destroyed.red;
  scores.blue += destroyed.blue;
  for (let y = 0; y < next.board.height; y += 1) {
    for (let x = 0; x < next.board.width; x += 1) {
      const before = previous.board.terrain[y]?.[x]?.owner;
      const after = next.board.terrain[y]?.[x]?.owner;
      if (after && after !== before) scores[after] += 1;
    }
  }
  return scores.red === (previous.scores?.red ?? 0) && scores.blue === (previous.scores?.blue ?? 0)
    ? next : { ...next, scores };
}

/**
 * Scenarios describe the red player's victory list and the blue player's mirrored
 * defeat list. If both sides meet a condition on the same state, the active player
 * wins, making simultaneous resolution deterministic. Legacy turn limits are
 * normalized to blue's survive condition while loading a scenario.
 */
export function evaluateScenario(state: GameState, scenario: ScenarioDefinition, tieBreaker: PlayerId = state.activePlayer): PlayerId | undefined {
  if (state.winner) return state.winner;
  const redWon = scenario.victoryConditions.some(condition => isVictoryConditionMet(state, condition, 'red'));
  const blueWon = scenario.defeatConditions.some(condition => isVictoryConditionMet(state, condition, 'blue'));
  if (redWon && blueWon) return tieBreaker;
  if (redWon) return 'red';
  if (blueWon) return 'blue';
  return undefined;
}

/** Applies a selected scenario, or only the event-specific rule supplied for legacy states. */
export function withEvaluatedWinner(
  state: GameState,
  legacyConditions: readonly VictoryCondition[] = [],
  tieBreaker: PlayerId = state.activePlayer,
): GameState {
  const scenario = scenarioById(state.scenarioId);
  const winner = scenario
    ? evaluateScenario(state, scenario, tieBreaker)
    : legacyConditions.some(condition => isVictoryConditionMet(state, condition, state.activePlayer))
      ? state.activePlayer : state.winner;
  return winner === state.winner ? state : { ...state, winner };
}
