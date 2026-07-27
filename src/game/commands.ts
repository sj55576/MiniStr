import { movementCost, positionKey, samePosition, terrainAt } from './terrain';
import { playerOwnedProperties, unitAt } from './state';
import { isEmbarkableUnit, transportCapacity, unitStats } from './units';
import { applyDamageVariance, forecastCombat } from './combat';
import { nextRandom } from './rng';
import { canProduceUnit, isPropertyTerrainKind } from './facilities';
import { visibleEnemies, visiblePositions } from './fog';
import { scenarioById } from './maps';
import { updateScenarioProgress, updateScenarioScores, withEvaluatedWinner } from './victory';
import { isDeployedUnit, otherPlayer, type GameResult, type GameState, type PlayerId, type Position, type Unit, type UnitKind } from './types';

const fail = <T = GameState>(error: string): GameResult<T> => ({ ok: false, error });
const succeed = <T>(value: T): GameResult<T> => ({ ok: true, value });

export function moveUnit(state: GameState, unitId: string, destination: Position): GameResult {
  if (state.winner) return fail('Game has finished');
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit) return fail('Unit not found');
  if (!isDeployedUnit(unit)) return fail('Embarked units cannot move');
  if (unit.owner !== state.activePlayer) return fail('Unit belongs to the other player');
  if (unit.hasMoved) return fail('Unit has already moved');
  if (unit.hasActed) return fail('Unit has already acted');
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
  if (!unit || !isDeployedUnit(unit)) return new Map();
  const budget = Math.min(unitStats[unit.kind].movement, unit.fuel ?? unitStats[unit.kind].fuel);
  const occupied = new Set(state.units.filter((candidate): candidate is Unit & { position: Position } => candidate.id !== unitId && isDeployedUnit(candidate)).map(candidate => positionKey(candidate.position)));
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
  if (!unit || !isDeployedUnit(unit)) return [];
  const origin = positionKey(unit.position);
  return [...movementCosts(state, unitId).keys()].filter(key => key !== origin).map(key => {
    const [x, y] = key.split(',').map(Number);
    return { x: x!, y: y! };
  });
}

/** Player-facing preview that omits enemies outside the viewer's reconnaissance range. */
export function reachablePositionsForPlayer(state: GameState, unitId: string, viewer: PlayerId): Position[] {
  const visible = new Set(visiblePositions(state, viewer).map(positionKey));
  const preview = {
    ...state,
    units: state.units.filter(unit => unit.owner === viewer || !isDeployedUnit(unit) || visible.has(positionKey(unit.position))),
  };
  return reachablePositions(preview, unitId);
}

/** When a unit leaves a property it was partway through capturing, the property recovers to full. */
function releaseCaptureProgress(board: GameState['board'], unit: GameState['units'][number]) {
  if (!isDeployedUnit(unit)) return board;
  const tile = terrainAt(board, unit.position);
  if (!tile || !isPropertyTerrainKind(tile.kind) || tile.owner === unit.owner || tile.capturePoints === undefined || tile.capturePoints >= 20) return board;
  return { ...board, terrain: board.terrain.map((row, y) => row.map((cell, x) => samePosition({ x, y }, unit.position) ? { ...cell, capturePoints: 20 } : cell)) };
}

export function collectIncome(state: GameState): GameState {
  const player = state.activePlayer;
  const income = playerOwnedProperties(state, player).length * 1000;
  return {
    ...state,
    players: {
      ...state.players,
      [player]: { gold: state.players[player].gold + income, income },
    },
  };
}

export function produceUnit(state: GameState, facility: Position, kind: UnitKind): GameResult {
  if (state.winner) return fail('Game has finished');
  const terrain = terrainAt(state.board, facility);
  if (!terrain || terrain.owner !== state.activePlayer || !canProduceUnit(terrain.kind, kind))
    return fail('An owned compatible production facility is required');
  if (unitAt(state, facility)) return fail('Production facility is occupied');
  const stats = unitStats[kind];
  if (state.players[state.activePlayer].gold < stats.cost) return fail('Insufficient funds');
  const id = `u${state.nextUnitId}`;
  return succeed({ ...state, nextUnitId: state.nextUnitId + 1,
    players: { ...state.players, [state.activePlayer]: { ...state.players[state.activePlayer], gold: state.players[state.activePlayer].gold - stats.cost } },
    units: [...state.units, { id, kind, owner: state.activePlayer, position: { ...facility }, hp: 100, fuel: stats.fuel, ammo: stats.ammo, hasMoved: true, hasActed: true }],
  });
}

export function captureProperty(state: GameState, unitId: string): GameResult {
  if (state.winner) return fail('Game has finished');
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit || !isDeployedUnit(unit) || unit.owner !== state.activePlayer) return fail('An active player unit is required');
  if (unit.hasActed) return fail('Unit has already acted');
  const terrain = terrainAt(state.board, unit.position);
  if (!terrain || !isPropertyTerrainKind(terrain.kind) || terrain.owner === unit.owner) return fail('No enemy property to capture');
  const power = unitStats[unit.kind].capturePower * unit.hp / 100;
  if (!power) return fail('Unit cannot capture');
  const remaining = (terrain.capturePoints ?? 20) - power;
  const board = { ...state.board, terrain: state.board.terrain.map((row, y) => row.map((tile, x) => samePosition({ x, y }, unit.position) ? (remaining <= 0 ? { ...tile, owner: unit.owner, capturePoints: 20 } : { ...tile, capturePoints: remaining }) : tile)) };
  const next = updateScenarioScores(state, { ...state, board, units: state.units.map(candidate => candidate.id === unitId ? { ...candidate, hasActed: true } : candidate) });
  return succeed(withEvaluatedWinner(next, [{ type: 'captureCapital' }]));
}

export function attackUnit(state: GameState, attackerId: string, defenderId: string): GameResult {
  if (state.winner) return fail('Game has finished');
  const attacker = state.units.find(unit => unit.id === attackerId);
  const defender = state.units.find(unit => unit.id === defenderId);
  if (!attacker || !defender || !isDeployedUnit(attacker) || !isDeployedUnit(defender) || attacker.owner !== state.activePlayer || attacker.hasActed) return fail('Unit cannot attack');
  if ((attacker.ammo ?? unitStats[attacker.kind].ammo) <= 0) return fail('Unit is out of ammunition');
  if (defender.owner !== attacker.owner && !visibleEnemies(state, attacker.owner).some(unit => unit.id === defender.id)) return fail('Target is not visible');
  const forecast = forecastCombat(state, attacker, defender);
  if (!forecast.ok) return forecast;
  const attackRoll = nextRandom(state.rngSeed);
  const damageToDefender = applyDamageVariance(forecast.value.damageToDefender, attackRoll.value);
  // Counterattack damage must use the defender's actual post-roll HP.  A unit
  // that the expected forecast destroys can still survive a low damage roll.
  const counterForecast = defender.hp > damageToDefender
    ? forecastCombat(state, { ...defender, hp: defender.hp - damageToDefender }, attacker)
    : undefined;
  const canCounter = counterForecast?.ok ?? false;
  const counterRoll = canCounter ? nextRandom(attackRoll.seed) : undefined;
  const damageToAttacker = counterRoll && counterForecast?.ok
    ? applyDamageVariance(counterForecast.value.damageToDefender, counterRoll.value)
    : 0;
  const rngSeed = counterRoll?.seed ?? attackRoll.seed;
  const damagedUnits = state.units.map(unit => {
    if (unit.id === attacker.id) return { ...unit, hp: Math.max(0, unit.hp - damageToAttacker), ammo: (unit.ammo ?? unitStats[unit.kind].ammo) - 1, hasActed: true };
    if (unit.id === defender.id) return { ...unit, hp: Math.max(0, unit.hp - damageToDefender), ammo: canCounter ? (unit.ammo ?? unitStats[unit.kind].ammo) - 1 : unit.ammo };
    return unit;
  });
  const destroyedUnitIds = new Set(damagedUnits.filter(unit => unit.hp <= 0).map(unit => unit.id));
  const nextUnits = damagedUnits.filter(unit => unit.hp > 0 && (!unit.embarkedIn || !destroyedUnitIds.has(unit.embarkedIn)));
  const next = updateScenarioScores(state, { ...state, units: nextUnits, rngSeed });
  return succeed(withEvaluatedWinner(next, [{ type: 'eliminate' }]));
}

function adjacent(first: Position, second: Position): boolean {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y) === 1;
}

function canDeployEmbarkableUnit(state: GameState, destination: Position, kind: UnitKind): boolean {
  const terrain = terrainAt(state.board, destination);
  return !!terrain && terrain.kind !== 'sea' && Number.isFinite(movementCost(state.board, destination, kind));
}

/** Boards an adjacent allied transport. Both units are spent to prevent a same-turn sea crossing. */
export function embarkUnit(state: GameState, unitId: string, transportId: string): GameResult {
  if (state.winner) return fail('Game has finished');
  const unit = state.units.find(candidate => candidate.id === unitId);
  const transport = state.units.find(candidate => candidate.id === transportId);
  if (!unit || !transport || !isDeployedUnit(unit) || !isDeployedUnit(transport)) return fail('A deployed embarkable unit and transport are required');
  if (unit.owner !== state.activePlayer || transport.owner !== unit.owner) return fail('An active player transport is required');
  if (!isEmbarkableUnit(unit.kind)) return fail('This unit cannot embark');
  if (transportCapacity(transport.kind) === 0) return fail('A transport unit is required');
  if (unit.hasActed || transport.hasMoved || transport.hasActed) return fail('Unit or transport has already acted');
  if (!canDeployEmbarkableUnit(state, unit.position, unit.kind) || !adjacent(unit.position, transport.position)) return fail('Infantry must embark from an adjacent coast');
  if (state.units.filter(candidate => candidate.embarkedIn === transport.id).length >= transportCapacity(transport.kind)) return fail('Transport is already at capacity');
  return succeed({ ...state, units: state.units.map(candidate => candidate.id === unit.id
    ? { ...candidate, position: undefined, embarkedIn: transport.id, hasMoved: true, hasActed: true }
    : candidate.id === transport.id ? { ...candidate, hasMoved: true, hasActed: true } : candidate) });
}

/** Lands carried cargo onto an adjacent, vacant land tile. */
export function disembarkUnit(state: GameState, transportId: string, destination: Position): GameResult {
  if (state.winner) return fail('Game has finished');
  const transport = state.units.find(candidate => candidate.id === transportId);
  if (!transport || !isDeployedUnit(transport) || transportCapacity(transport.kind) === 0) return fail('A deployed transport unit is required');
  if (transport.owner !== state.activePlayer) return fail('Unit belongs to the other player');
  if (transport.hasMoved || transport.hasActed) return fail('Transport has already acted');
  const cargo = state.units.find(candidate => candidate.embarkedIn === transport.id);
  if (!cargo || !isEmbarkableUnit(cargo.kind) || cargo.owner !== transport.owner) return fail('Transport has no valid cargo');
  if (!adjacent(transport.position, destination) || unitAt(state, destination) || !canDeployEmbarkableUnit(state, destination, cargo.kind)) return fail('Destination must be an adjacent vacant land tile');
  return succeed({ ...state, units: state.units.map(candidate => candidate.id === cargo.id
    ? { ...candidate, position: { ...destination }, embarkedIn: undefined, hasMoved: true, hasActed: true }
    : candidate.id === transport.id ? { ...candidate, hasMoved: true, hasActed: true } : candidate) });
}

export function endTurn(state: GameState): GameState {
  if (state.winner) return state;
  const actor = state.activePlayer;
  const scenario = scenarioById(state.scenarioId);
  const progressed = scenario ? updateScenarioProgress(state, scenario, actor) : state;
  const activePlayer = otherPlayer(state.activePlayer);
  const refreshed = progressed.units.map(unit => {
    if (unit.owner !== activePlayer) return unit;
    if (!isDeployedUnit(unit)) return { ...unit, hasMoved: false, hasActed: false };
    const terrain = terrainAt(progressed.board, unit.position);
    const onOwnedProperty = !!terrain && isPropertyTerrainKind(terrain.kind) && terrain.owner === activePlayer;
    if (!onOwnedProperty) return { ...unit, hasMoved: false, hasActed: false };
    const stats = unitStats[unit.kind];
    return { ...unit, hasMoved: false, hasActed: false, fuel: stats.fuel, ammo: stats.ammo, hp: Math.min(100, unit.hp + 20) };
  });
  return withEvaluatedWinner(collectIncome({
    ...progressed,
    activePlayer,
    turn: state.turn + (activePlayer === 'red' ? 1 : 0),
    units: refreshed,
  }), [], actor);
}
