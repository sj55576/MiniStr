import { forecastCombat } from '../game/combat';
import { reachablePositions } from '../game/commands';
import { isPropertyTerrainKind } from '../game/facilities';
import { visibleEnemies } from '../game/fog';
import { unitAt } from '../game/state';
import { defenseStars, manhattanDistance, movementCost, terrainAt } from '../game/terrain';
import { isDeployedUnit, type DeployedUnit, type GameState, type PlayerId, type Position, type Unit, type UnitKind } from '../game/types';
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
  | { type: 'embark'; unitId: string; transportId: string }
  | { type: 'disembark'; transportId: string; destination: Position }
  | { type: 'endTurn' };

const propertyKinds = new Set(['city', 'factory', 'port', 'capital']);
type StandardProductionKind = Extract<UnitKind, 'infantry' | 'tank' | 'artillery'>;
const standardProductionKinds: readonly StandardProductionKind[] = ['infantry', 'tank', 'artillery'];

function orderedUnits(state: GameState, player: PlayerId): DeployedUnit[] {
  return state.units.filter((unit): unit is DeployedUnit => unit.owner === player && isDeployedUnit(unit)).sort((a, b) => a.id.localeCompare(b.id));
}

function canCapture(state: GameState, unit: DeployedUnit): boolean {
  const tile = terrainAt(state.board, unit.position);
  return !unit.hasActed && unitStats[unit.kind].capturePower > 0 && !!tile && propertyKinds.has(tile.kind) && tile.owner !== unit.owner;
}

function favorableAttack(state: GameState, attacker: DeployedUnit, target: Unit, config: CpuDifficultyConfig): boolean {
  const result = forecastCombat(state, attacker, target);
  if (!result.ok) return false;
  // A certain destruction is always worthwhile. Otherwise difficulty controls accepted risk.
  return result.value.defenderDamage >= target.hp
    || result.value.defenderDamage >= result.value.counterDamage + config.attackSafetyMargin;
}

function interruptsCapture(state: GameState, player: PlayerId, target: Unit): boolean {
  if (!isDeployedUnit(target) || target.kind !== 'infantry') return false;
  const terrain = terrainAt(state.board, target.position);
  return !!terrain && isPropertyTerrainKind(terrain.kind) && terrain.owner === player && (terrain.capturePoints ?? 20) < 20;
}

function attackAction(state: GameState, player: PlayerId, config: CpuDifficultyConfig): CpuAction | undefined {
  const visibleTargets = visibleEnemies(state, player);
  for (const attacker of orderedUnits(state, player)) {
    if (attacker.hasActed) continue;
    const target = visibleTargets
      .filter(unit => favorableAttack(state, attacker, unit, config))
      .sort((a, b) => {
        const aForecast = forecastCombat(state, attacker, a);
        const bForecast = forecastCombat(state, attacker, b);
        const aScore = aForecast.ok ? aForecast.value.defenderDamage - aForecast.value.counterDamage : -Infinity;
        const bScore = bForecast.ok ? bForecast.value.defenderDamage - bForecast.value.counterDamage : -Infinity;
        const interruption = Number(interruptsCapture(state, player, b)) - Number(interruptsCapture(state, player, a));
        return interruption || bScore - aScore || a.hp - b.hp || a.id.localeCompare(b.id);
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

function emptyOwnedFacility(state: GameState, player: PlayerId, kind: UnitKind): Position | undefined {
  for (let y = 0; y < state.board.height; y += 1) for (let x = 0; x < state.board.width; x += 1) {
    const position = { x, y };
    const tile = terrainAt(state.board, position);
    if (tile?.owner === player && !unitAt(state, position)) {
      const canBuild = (tile.kind === 'factory' && !['destroyer', 'landingShip'].includes(kind))
        || (tile.kind === 'port' && ['destroyer', 'landingShip'].includes(kind));
      if (canBuild) return position;
    }
  }
  return undefined;
}

/** Production reacts only to confirmed units and board topology, never hidden enemies. */
function specialistProduction(state: GameState, player: PlayerId): CpuAction | undefined {
  const gold = state.players[player].gold;
  const visible = visibleEnemies(state, player).filter(isDeployedUnit);
  const hasSea = state.board.terrain.some(row => row.some(tile => tile.kind === 'sea'));
  const ownKinds = new Set(state.units.filter(unit => unit.owner === player).map(unit => unit.kind));
  const candidates: UnitKind[] = [];
  if (hasSea && !ownKinds.has('destroyer') && (visible.some(unit => unit.kind === 'destroyer' || unit.kind === 'landingShip') || state.board.terrain.some(row => row.some(tile => tile.kind === 'port')))) candidates.push('destroyer');
  if (!ownKinds.has('fighter') && visible.some(unit => unit.kind === 'fighter' || unit.kind === 'bomber')) candidates.push('fighter');
  if (!ownKinds.has('bomber') && visible.some(unit => ['tank', 'artillery', 'rocket', 'destroyer'].includes(unit.kind))) candidates.push('bomber');
  for (const kind of candidates) {
    if (unitStats[kind].cost > gold) continue;
    const factory = emptyOwnedFacility(state, player, kind);
    if (factory) return { type: 'produce', factory, kind };
  }
  return undefined;
}

function productionAction(state: GameState, player: PlayerId, config: CpuDifficultyConfig): CpuAction | undefined {
  const targets = objectives(state, player, config);
  const hasRemoteInfantry = orderedUnits(state, player)
    .filter(unit => unit.kind === 'infantry')
    .some(unit => targets.some(target => !sameLandComponent(state, unit.position, target)));
  const hasLandingShip = state.units.some(unit => unit.owner === player && unit.kind === 'landingShip');
  if (hasRemoteInfantry && !hasLandingShip && state.players[player].gold >= unitStats.landingShip.cost) {
    const port = emptyOwnedFacility(state, player, 'landingShip');
    if (port) return { type: 'produce', factory: port, kind: 'landingShip' };
  }
  const specialist = specialistProduction(state, player);
  if (specialist) return specialist;
  const kind = preferredProduction(state, player);
  if (!kind) return undefined;
  const factory = emptyOwnedFacility(state, player, kind);
  return factory ? { type: 'produce', factory, kind } : undefined;
}

function objectives(state: GameState, player: PlayerId, config: CpuDifficultyConfig): Position[] {
  const capitals: Position[] = [];
  const properties: Position[] = [];
  for (let y = 0; y < state.board.height; y += 1) for (let x = 0; x < state.board.width; x += 1) {
    const tile = state.board.terrain[y]?.[x];
    if (!tile || tile.owner === player || !propertyKinds.has(tile.kind)) continue;
    (tile.kind === 'capital' ? capitals : properties).push({ x, y });
  }
  // Enemy formations participate only after reconnaissance has revealed them.
  const enemies = visibleEnemies(state, player).filter(isDeployedUnit).map(unit => unit.position);
  return config.prioritizeCapital ? [...capitals, ...properties, ...enemies] : [...properties, ...capitals, ...enemies];
}

const adjacentPositions = (position: Position): Position[] => [
  { x: position.x + 1, y: position.y }, { x: position.x - 1, y: position.y },
  { x: position.x, y: position.y + 1 }, { x: position.x, y: position.y - 1 },
];

function isAdjacent(first: Position, second: Position): boolean {
  return manhattanDistance(first, second) === 1;
}

/**
 * Land components deliberately use infantry movement rules. This lets the CPU distinguish
 * a remote island from a route it can simply walk, without treating a port as open sea.
 */
function sameLandComponent(state: GameState, first: Position, second: Position): boolean {
  if (!Number.isFinite(movementCost(state.board, first, 'infantry')) || !Number.isFinite(movementCost(state.board, second, 'infantry'))) return false;
  const pending = [first];
  const seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    const currentKey = `${current.x},${current.y}`;
    if (seen.has(currentKey)) continue;
    if (current.x === second.x && current.y === second.y) return true;
    seen.add(currentKey);
    for (const next of adjacentPositions(current)) {
      if (Number.isFinite(movementCost(state.board, next, 'infantry')) && !seen.has(`${next.x},${next.y}`)) pending.push(next);
    }
  }
  return false;
}

function nearestTarget(position: Position, targets: readonly Position[]): Position | undefined {
  return [...targets].sort((a, b) => manhattanDistance(position, a) - manhattanDistance(position, b) || a.y - b.y || a.x - b.x)[0];
}

function needsSupply(unit: DeployedUnit): boolean {
  const stats = unitStats[unit.kind];
  return (unit.fuel ?? stats.fuel) <= Math.max(6, Math.floor(stats.fuel / 3))
    || ((unit.ammo ?? stats.ammo) > 0 && (unit.ammo ?? stats.ammo) <= Math.max(1, Math.floor(stats.ammo / 3)));
}

/**
 * Scores a legal destination from knowledge available to the CPU.  Visible opponents
 * contribute counterattack risk; unseen units are intentionally absent from this function.
 */
export function evaluateCpuPosition(state: GameState, player: PlayerId, unit: DeployedUnit, destination: Position, targets: readonly Position[]): number {
  const terrain = terrainAt(state.board, destination);
  if (!terrain) return Number.NEGATIVE_INFINITY;
  const moved: DeployedUnit = { ...unit, position: { ...destination } };
  const projected = { ...state, units: state.units.map(candidate => candidate.id === unit.id ? moved : candidate) };
  const defense = defenseStars(terrain) * 9;
  const supply = needsSupply(unit) && isPropertyTerrainKind(terrain.kind) && terrain.owner === player ? 80 : 0;
  const distance = targets.length ? Math.min(...targets.map(target => manhattanDistance(destination, target))) : 0;
  const pressure = visibleEnemies(state, player).filter(isDeployedUnit).reduce((risk, enemy) => {
    const forecast = forecastCombat(projected, enemy, moved);
    return risk + (forecast.ok ? forecast.value.defenderDamage * 1.4 : 0);
  }, 0);
  const captureThreat = visibleEnemies(state, player).some(enemy => interruptsCapture(state, player, enemy))
    ? visibleEnemies(state, player).filter((enemy): enemy is DeployedUnit => isDeployedUnit(enemy) && interruptsCapture(state, player, enemy))
      .reduce((best, enemy) => Math.min(best, manhattanDistance(destination, enemy.position)), Infinity)
    : Infinity;
  const response = Number.isFinite(captureThreat) ? Math.max(0, 36 - captureThreat * 7) : 0;
  return defense + supply + response - distance * 6 - pressure;
}

/** Choose one transport step before ordinary movement so island objectives are never stranded. */
function transportAction(state: GameState, player: PlayerId, config: CpuDifficultyConfig): CpuAction | undefined {
  const targets = objectives(state, player, config);
  if (!targets.length) return undefined;
  const units = orderedUnits(state, player);

  // An unloaded ship gets priority: landing the cargo is the only way it can capture remote properties.
  for (const transport of units.filter(unit => unit.kind === 'landingShip' && !unit.hasMoved && !unit.hasActed)) {
    const cargo = state.units.find(unit => unit.embarkedIn === transport.id);
    if (!cargo) continue;
    const destination = adjacentPositions(transport.position)
      .filter(position => Number.isFinite(movementCost(state.board, position, 'infantry')) && !unitAt(state, position)
        && targets.some(target => sameLandComponent(state, position, target)))
      .map(position => ({ position, target: nearestTarget(position, targets) }))
      .filter((candidate): candidate is { position: Position; target: Position } => candidate.target !== undefined)
      .sort((a, b) => manhattanDistance(a.position, a.target) - manhattanDistance(b.position, b.target)
        || a.position.y - b.position.y || a.position.x - b.position.x)[0]?.position;
    if (destination) return { type: 'disembark', transportId: transport.id, destination };
  }

  // Board an infantry unit only if an objective lies on a different land component.
  for (const infantry of units.filter(unit => unit.kind === 'infantry' && !unit.hasActed)) {
    const remoteObjective = targets.some(target => !sameLandComponent(state, infantry.position, target));
    if (!remoteObjective) continue;
    const transport = units.find(candidate => candidate.kind === 'landingShip' && !candidate.hasMoved && !candidate.hasActed
      && isAdjacent(infantry.position, candidate.position) && !state.units.some(unit => unit.embarkedIn === candidate.id));
    if (transport) return { type: 'embark', unitId: infantry.id, transportId: transport.id };
  }

  // Carry cargo toward the closest remote objective. This is finite because it only accepts a strict
  // Manhattan-distance improvement; otherwise normal actions/end-turn take over.
  for (const transport of units.filter(unit => unit.kind === 'landingShip' && !unit.hasMoved)) {
    if (!state.units.some(unit => unit.embarkedIn === transport.id)) continue;
    const target = nearestTarget(transport.position, targets);
    if (!target) continue;
    const currentDistance = manhattanDistance(transport.position, target);
    const destination = reachablePositions(state, transport.id)
      .filter(position => manhattanDistance(position, target) < currentDistance)
      .sort((a, b) => manhattanDistance(a, target) - manhattanDistance(b, target) || a.y - b.y || a.x - b.x)[0];
    if (destination) return { type: 'move', unitId: transport.id, destination };
  }
  return undefined;
}

function moveAction(state: GameState, player: PlayerId, config: CpuDifficultyConfig): CpuAction | undefined {
  const targets = objectives(state, player, config);
  if (!targets.length) return undefined;
  for (const unit of orderedUnits(state, player)) {
    if (unit.hasMoved) continue;
    // Advance across the unit's whole movement range (Dijkstra reachability), weighing cover,
    // resupply and visible counterattack risk instead of raw distance alone.
    const destination = reachablePositions(state, unit.id)
      .map(position => ({ position, score: evaluateCpuPosition(state, player, unit, position, targets) }))
      .sort((a, b) => b.score - a.score || a.position.y - b.position.y || a.position.x - b.position.x)[0]?.position;
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
    ?? transportAction(state, player, config)
    ?? productionAction(state, player, config)
    ?? moveAction(state, player, config)
    ?? { type: 'endTurn' };
}
