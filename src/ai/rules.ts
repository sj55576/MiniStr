import { forecastCombat } from '../game/combat';
import { reachablePositions } from '../game/commands';
import { unitAt } from '../game/state';
import { manhattanDistance, terrainAt } from '../game/terrain';
import type { GameState, PlayerId, Position, Unit, UnitKind } from '../game/types';
import { unitStats } from '../game/units';

/** The CPU does not use hidden randomness: the same state always gives the same order. */
export type CpuDifficulty = 'easy' | 'normal' | 'hard';

export interface CpuDifficultyConfig {
  /** Extra damage, over expected counter-damage, required before taking a non-lethal attack. */
  attackSafetyMargin: number;
  /** Whether a capital is preferred over other enemy objectives when moving. */
  prioritizeCapital: boolean;
}

export const cpuDifficultyConfig: Record<CpuDifficulty, CpuDifficultyConfig> = {
  easy: { attackSafetyMargin: 20, prioritizeCapital: false },
  normal: { attackSafetyMargin: 0, prioritizeCapital: true },
  hard: { attackSafetyMargin: -15, prioritizeCapital: true },
};

export type CpuAction =
  | { type: 'capture'; unitId: string }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'produce'; factory: Position; kind: UnitKind }
  | { type: 'move'; unitId: string; destination: Position }
  | { type: 'endTurn' };

const propertyKinds = new Set(['city', 'factory', 'capital']);
type StandardProductionKind = Extract<UnitKind, 'infantry' | 'tank' | 'artillery'>;
const standardProductionKinds: readonly StandardProductionKind[] = ['infantry', 'tank', 'artillery'];

function orderedUnits(state: GameState, player: PlayerId): Unit[] {
  return state.units.filter(unit => unit.owner === player).sort((a, b) => a.id.localeCompare(b.id));
}

function canCapture(state: GameState, unit: Unit): boolean {
  const tile = terrainAt(state.board, unit.position);
  return !unit.hasActed && unitStats[unit.kind].capturePower > 0 && !!tile && propertyKinds.has(tile.kind) && tile.owner !== unit.owner;
}

function favorableAttack(state: GameState, attacker: Unit, target: Unit, config: CpuDifficultyConfig): boolean {
  const result = forecastCombat(state, attacker, target);
  if (!result.ok) return false;
  // A certain destruction is always worthwhile. Otherwise difficulty controls accepted risk.
  return result.value.defenderDamage >= target.hp
    || result.value.defenderDamage >= result.value.counterDamage + config.attackSafetyMargin;
}

function attackAction(state: GameState, player: PlayerId, config: CpuDifficultyConfig): CpuAction | undefined {
  for (const attacker of orderedUnits(state, player)) {
    if (attacker.hasActed) continue;
    const target = state.units
      .filter(unit => unit.owner !== player && favorableAttack(state, attacker, unit, config))
      .sort((a, b) => {
        const aForecast = forecastCombat(state, attacker, a);
        const bForecast = forecastCombat(state, attacker, b);
        const aScore = aForecast.ok ? aForecast.value.defenderDamage - aForecast.value.counterDamage : -Infinity;
        const bScore = bForecast.ok ? bForecast.value.defenderDamage - bForecast.value.counterDamage : -Infinity;
        return bScore - aScore || a.hp - b.hp || a.id.localeCompare(b.id);
      })[0];
    if (target) return { type: 'attack', unitId: attacker.id, targetId: target.id };
  }
  return undefined;
}

function preferredProduction(state: GameState, player: PlayerId): UnitKind | undefined {
  const gold = state.players[player].gold;
  const counts: Record<StandardProductionKind, number> = { infantry: 0, tank: 0, artillery: 0 };
  for (const unit of state.units) if (unit.owner === player && unit.kind in counts) counts[unit.kind as StandardProductionKind] += 1;
  // Fill the requested 2:2:1 force mix before starting the next batch.
  const weights: Record<StandardProductionKind, number> = { infantry: 2, tank: 2, artillery: 1 };
  return standardProductionKinds
    .filter(kind => unitStats[kind].cost <= gold)
    .sort((a, b) => (weights[b] - counts[b]) - (weights[a] - counts[a]) || unitStats[a].cost - unitStats[b].cost)[0];
}

function productionAction(state: GameState, player: PlayerId): CpuAction | undefined {
  const kind = preferredProduction(state, player);
  if (!kind) return undefined;
  for (let y = 0; y < state.board.height; y += 1) for (let x = 0; x < state.board.width; x += 1) {
    const factory = { x, y };
    const tile = terrainAt(state.board, factory);
    if (tile?.kind === 'factory' && tile.owner === player && !unitAt(state, factory)) return { type: 'produce', factory, kind };
  }
  return undefined;
}

function objectives(state: GameState, player: PlayerId, config: CpuDifficultyConfig): Position[] {
  const capitals: Position[] = [];
  const properties: Position[] = [];
  for (let y = 0; y < state.board.height; y += 1) for (let x = 0; x < state.board.width; x += 1) {
    const tile = state.board.terrain[y]?.[x];
    if (!tile || tile.owner === player || !propertyKinds.has(tile.kind)) continue;
    (tile.kind === 'capital' ? capitals : properties).push({ x, y });
  }
  const enemies = state.units.filter(unit => unit.owner !== player).map(unit => unit.position);
  return config.prioritizeCapital ? [...capitals, ...properties, ...enemies] : [...properties, ...capitals, ...enemies];
}

function moveAction(state: GameState, player: PlayerId, config: CpuDifficultyConfig): CpuAction | undefined {
  const targets = objectives(state, player, config);
  if (!targets.length) return undefined;
  for (const unit of orderedUnits(state, player)) {
    if (unit.hasMoved) continue;
    const currentDistance = Math.min(...targets.map(target => manhattanDistance(unit.position, target)));
    // Advance across the unit's whole movement range (Dijkstra reachability), not one tile at a time.
    const destination = reachablePositions(state, unit.id)
      .map(position => ({ position, distance: Math.min(...targets.map(target => manhattanDistance(position, target))) }))
      .filter(candidate => candidate.distance < currentDistance)
      .sort((a, b) => a.distance - b.distance || a.position.y - b.position.y || a.position.x - b.position.x)[0]?.position;
    if (destination) return { type: 'move', unitId: unit.id, destination };
  }
  return undefined;
}

/** Select the next legal high-level CPU order. The caller applies it with the game command layer. */
export function chooseCpuAction(state: GameState, difficulty: CpuDifficulty = 'normal', player: PlayerId = state.activePlayer): CpuAction {
  if (state.winner || player !== state.activePlayer) return { type: 'endTurn' };
  const config = cpuDifficultyConfig[difficulty];
  const capture = orderedUnits(state, player).find(unit => canCapture(state, unit));
  if (capture) return { type: 'capture', unitId: capture.id };
  return attackAction(state, player, config)
    ?? productionAction(state, player)
    ?? moveAction(state, player, config)
    ?? { type: 'endTurn' };
}
