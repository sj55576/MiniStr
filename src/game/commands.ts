import { movementCost, positionKey, samePosition, terrainAt } from './terrain';
import { playerOwnedProperties, unitAt } from './state';
import { unitStats } from './units';
import { forecastCombat } from './combat';
import { visibleEnemies } from './fog';
import { otherPlayer, type GameResult, type GameState, type PlayerId, type Position, type UnitKind } from './types';

const fail = <T = GameState>(error: string): GameResult<T> => ({ ok: false, error });
const succeed = <T>(value: T): GameResult<T> => ({ ok: true, value });

export function moveUnit(state: GameState, unitId: string, destination: Position): GameResult {
  if (state.winner) return fail('Game has finished');
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit) return fail('Unit not found');
  if (unit.owner !== state.activePlayer) return fail('Unit belongs to the other player');
  if (unit.hasMoved) return fail('Unit has already moved');
  if ((unit.fuel ?? unitStats[unit.kind].fuel) <= 0) return fail('Unit is out of fuel');
  if (unitAt(state, destination)) return fail('Destination is occupied');
  const costs = movementCosts(state, unitId);
  const spent = costs.get(positionKey(destination));
  if (spent === undefined) return fail('Destination is out of range');
  const fuel = (unit.fuel ?? unitStats[unit.kind].fuel) - spent;
  const board = releaseCaptureProgress(state.board, unit);
  return succeed({ ...state, board, units: state.units.map(candidate => candidate.id === unitId ? { ...candidate, position: { ...destination }, hasMoved: true, fuel } : candidate) });
}

/**
 * Least movement cost to every tile reachable through unoccupied orthogonal tiles,
 * keyed by "x,y". Uses Dijkstra because terrain costs vary (forest/mountain = 2), and
 * caps the budget at the unit's remaining fuel so a near-empty tank cannot outrun it.
 * The unit's own tile is included at cost 0.
 */
export function movementCosts(state: GameState, unitId: string): Map<string, number> {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit) return new Map();
  const budget = Math.min(unitStats[unit.kind].movement, unit.fuel ?? unitStats[unit.kind].fuel);
  const occupied = new Set(state.units.filter(candidate => candidate.id !== unitId).map(candidate => positionKey(candidate.position)));
  const costs = new Map<string, number>([[positionKey(unit.position), 0]]);
  // Small frontier, so a linear-scan priority queue keeps the code simple without hurting performance.
  const frontier = new Map<string, { position: Position; cost: number }>([[positionKey(unit.position), { position: { ...unit.position }, cost: 0 }]]);
  while (frontier.size) {
    let bestKey = '';
    let best: { position: Position; cost: number } | undefined;
    for (const [candidateKey, entry] of frontier) if (!best || entry.cost < best.cost) { best = entry; bestKey = candidateKey; }
    frontier.delete(bestKey);
    const current = best!;
    for (const next of [{ x: current.position.x + 1, y: current.position.y }, { x: current.position.x - 1, y: current.position.y }, { x: current.position.x, y: current.position.y + 1 }, { x: current.position.x, y: current.position.y - 1 }]) {
      const key = positionKey(next);
      if (occupied.has(key)) continue;
      const step = movementCost(state.board, next, unit.kind);
      const total = current.cost + step;
      if (!Number.isFinite(step) || total > budget || total >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, total);
      frontier.set(key, { position: next, cost: total });
    }
  }
  return costs;
}

/** Tiles the unit can move to (excludes its current tile), for UI highlighting and AI planning. */
export function reachablePositions(state: GameState, unitId: string): Position[] {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit) return [];
  const origin = positionKey(unit.position);
  return [...movementCosts(state, unitId).keys()].filter(key => key !== origin).map(key => {
    const [x, y] = key.split(',').map(Number);
    return { x: x!, y: y! };
  });
}

/** When a unit leaves a property it was partway through capturing, the property recovers to full. */
function releaseCaptureProgress(board: GameState['board'], unit: GameState['units'][number]) {
  const tile = terrainAt(board, unit.position);
  if (!tile || tile.owner === unit.owner || tile.capturePoints === undefined || tile.capturePoints >= 20) return board;
  return { ...board, terrain: board.terrain.map((row, y) => row.map((cell, x) => samePosition({ x, y }, unit.position) ? { ...cell, capturePoints: 20 } : cell)) };
}

export function collectIncome(state: GameState): GameState {
  const players = (['red', 'blue'] as const).reduce((result, player) => {
    const income = playerOwnedProperties(state, player).length * 1000;
    result[player] = { gold: state.players[player].gold + income, income };
    return result;
  }, {} as GameState['players']);
  return { ...state, players };
}

export function produceUnit(state: GameState, factory: Position, kind: UnitKind): GameResult {
  const terrain = terrainAt(state.board, factory);
  if (!terrain || terrain.kind !== 'factory' || terrain.owner !== state.activePlayer) return fail('An owned factory is required');
  if (unitAt(state, factory)) return fail('Factory is occupied');
  const stats = unitStats[kind];
  if (state.players[state.activePlayer].gold < stats.cost) return fail('Insufficient funds');
  const id = `u${state.nextUnitId}`;
  return succeed({ ...state, nextUnitId: state.nextUnitId + 1,
    players: { ...state.players, [state.activePlayer]: { ...state.players[state.activePlayer], gold: state.players[state.activePlayer].gold - stats.cost } },
    units: [...state.units, { id, kind, owner: state.activePlayer, position: { ...factory }, hp: 100, fuel: stats.fuel, ammo: stats.ammo, hasMoved: true, hasActed: true }],
  });
}

export function captureProperty(state: GameState, unitId: string): GameResult {
  if (state.winner) return fail('Game has finished');
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit || unit.owner !== state.activePlayer) return fail('An active player unit is required');
  if (unit.hasActed) return fail('Unit has already acted');
  const terrain = terrainAt(state.board, unit.position);
  if (!terrain || !['city', 'factory', 'capital'].includes(terrain.kind) || terrain.owner === unit.owner) return fail('No enemy property to capture');
  const power = unitStats[unit.kind].capturePower * unit.hp / 100;
  if (!power) return fail('Unit cannot capture');
  const remaining = (terrain.capturePoints ?? 20) - power;
  const board = { ...state.board, terrain: state.board.terrain.map((row, y) => row.map((tile, x) => samePosition({ x, y }, unit.position) ? (remaining <= 0 ? { ...tile, owner: unit.owner, capturePoints: 20 } : { ...tile, capturePoints: remaining }) : tile)) };
  const capturedCapital = terrain.kind === 'capital' && remaining <= 0;
  return succeed({ ...state, board, winner: capturedCapital ? unit.owner : state.winner, units: state.units.map(candidate => candidate.id === unitId ? { ...candidate, hasActed: true } : candidate) });
}

export function attackUnit(state: GameState, attackerId: string, defenderId: string): GameResult {
  if (state.winner) return fail('Game has finished');
  const attacker = state.units.find(unit => unit.id === attackerId);
  const defender = state.units.find(unit => unit.id === defenderId);
  if (!attacker || !defender || attacker.owner !== state.activePlayer || attacker.hasActed) return fail('Unit cannot attack');
  if ((attacker.ammo ?? unitStats[attacker.kind].ammo) <= 0) return fail('Unit is out of ammunition');
  if (defender.owner !== attacker.owner && !visibleEnemies(state, attacker.owner).some(unit => unit.id === defender.id)) return fail('Target is not visible');
  const forecast = forecastCombat(state, attacker, defender);
  if (!forecast.ok) return forecast;
  const nextUnits = state.units.map(unit => {
    if (unit.id === attacker.id) return { ...unit, hp: Math.max(0, unit.hp - forecast.value.counterDamage), ammo: (unit.ammo ?? unitStats[unit.kind].ammo) - 1, hasActed: true };
    if (unit.id === defender.id) return { ...unit, hp: Math.max(0, unit.hp - forecast.value.defenderDamage), ammo: forecast.value.canCounter ? (unit.ammo ?? unitStats[unit.kind].ammo) - 1 : unit.ammo };
    return unit;
  }).filter(unit => unit.hp > 0);
  const enemyAlive = nextUnits.some(unit => unit.owner === otherPlayer(state.activePlayer));
  return succeed({ ...state, units: nextUnits, winner: enemyAlive ? undefined : state.activePlayer });
}

export function endTurn(state: GameState): GameState {
  const activePlayer = otherPlayer(state.activePlayer);
  const refreshed = state.units.map(unit => {
    if (unit.owner !== activePlayer) return unit;
    const terrain = terrainAt(state.board, unit.position);
    const onOwnedProperty = !!terrain && ['city', 'factory', 'capital'].includes(terrain.kind) && terrain.owner === activePlayer;
    if (!onOwnedProperty) return { ...unit, hasMoved: false, hasActed: false };
    const stats = unitStats[unit.kind];
    return { ...unit, hasMoved: false, hasActed: false, fuel: stats.fuel, ammo: stats.ammo, hp: Math.min(100, unit.hp + 20) };
  });
  return collectIncome({ ...state, activePlayer, turn: state.turn + 1, units: refreshed });
}
