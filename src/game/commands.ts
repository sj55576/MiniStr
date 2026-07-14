import { movementCost, positionKey, samePosition, terrainAt } from './terrain';
import { playerOwnedProperties, unitAt } from './state';
import { unitStats } from './units';
import { forecastCombat } from './combat';
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
  const reachable = reachablePositions(state, unitId);
  if (!reachable.some(position => samePosition(position, destination))) return fail('Destination is out of range');
  return succeed({ ...state, units: state.units.map(candidate => candidate.id === unitId ? { ...candidate, position: { ...destination }, hasMoved: true, fuel: (candidate.fuel ?? unitStats[candidate.kind].fuel) - 1 } : candidate) });
}

/** All tiles reachable through unoccupied orthogonal tiles within the unit movement budget. */
export function reachablePositions(state: GameState, unitId: string): Position[] {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit) return [];
  const budget = unitStats[unit.kind].movement;
  const occupied = new Set(state.units.filter(candidate => candidate.id !== unitId).map(candidate => positionKey(candidate.position)));
  const costs = new Map<string, number>([[positionKey(unit.position), 0]]);
  const queue: Position[] = [{ ...unit.position }];
  const reached: Position[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    const currentCost = costs.get(positionKey(current))!;
    for (const next of [{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y }, { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }]) {
      if (occupied.has(positionKey(next))) continue;
      const step = movementCost(state.board, next, unit.kind);
      const total = currentCost + step;
      const key = positionKey(next);
      if (!Number.isFinite(step) || total > budget || total >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, total);
      queue.push(next);
      reached.push(next);
    }
  }
  return reached;
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
  const forecast = forecastCombat(state, attacker, defender);
  if (!forecast.ok) return forecast;
  const nextUnits = state.units.map(unit => {
    if (unit.id === attacker.id) return { ...unit, hp: Math.max(0, unit.hp - forecast.value.counterDamage), ammo: (unit.ammo ?? unitStats[unit.kind].ammo) - 1, hasActed: true };
    if (unit.id === defender.id) return { ...unit, hp: Math.max(0, unit.hp - forecast.value.defenderDamage) };
    return unit;
  }).filter(unit => unit.hp > 0);
  const enemyAlive = nextUnits.some(unit => unit.owner === otherPlayer(state.activePlayer));
  return succeed({ ...state, units: nextUnits, winner: enemyAlive ? undefined : state.activePlayer });
}

export function endTurn(state: GameState): GameState {
  const activePlayer = otherPlayer(state.activePlayer);
  const refreshed = state.units.map(unit => unit.owner === activePlayer ? { ...unit, hasMoved: false, hasActed: false } : unit);
  return collectIncome({ ...state, activePlayer, turn: state.turn + 1, units: refreshed });
}
