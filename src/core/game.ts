/** Framework-independent rules for MiniStr's first playable game. */

export enum Player {
  Blue = "blue",
  Red = "red",
}

export enum UnitType {
  Infantry = "infantry",
  Tank = "tank",
  Artillery = "artillery",
}

export interface Coordinate {
  readonly x: number;
  readonly y: number;
}

export interface Unit {
  readonly id: string;
  readonly player: Player;
  readonly type: UnitType;
  readonly position: Coordinate;
  /** Between 1 and 10 while the unit remains in the game. */
  readonly hp: number;
  /** A unit can move once before it attacks during its owner's turn. */
  readonly hasMoved: boolean;
  /** A unit can attack once; attacking ends its actions for the turn. */
  readonly hasAttacked: boolean;
}

export interface GameState {
  /** The board is always square and coordinates are zero based. */
  readonly boardSize: number;
  readonly units: readonly Unit[];
  readonly activePlayer: Player;
  readonly winner: Player | null;
  readonly turn: number;
}

export interface CreateGameStateOptions {
  readonly boardSize?: number;
  readonly units?: readonly Unit[];
  readonly activePlayer?: Player;
}

export type GameRuleErrorCode =
  | "GAME_OVER"
  | "UNIT_NOT_FOUND"
  | "NOT_YOUR_UNIT"
  | "UNIT_ALREADY_MOVED"
  | "UNIT_ALREADY_ATTACKED"
  | "OUT_OF_BOUNDS"
  | "DESTINATION_OCCUPIED"
  | "OUT_OF_RANGE"
  | "INVALID_TARGET";

export class GameRuleError extends Error {
  constructor(readonly code: GameRuleErrorCode, message: string) {
    super(message);
    this.name = "GameRuleError";
  }
}

export const UNIT_STATS: Readonly<Record<UnitType, Readonly<{
  movement: number;
  range: number;
  damage: number;
}>>> = {
  [UnitType.Infantry]: { movement: 2, range: 1, damage: 3 },
  [UnitType.Tank]: { movement: 3, range: 1, damage: 4 },
  [UnitType.Artillery]: { movement: 1, range: 3, damage: 5 },
};

const DEFAULT_BOARD_SIZE = 8;

const defaultUnits = (): readonly Unit[] => [
  unit("blue-infantry", Player.Blue, UnitType.Infantry, 1, 6),
  unit("blue-tank", Player.Blue, UnitType.Tank, 3, 7),
  unit("blue-artillery", Player.Blue, UnitType.Artillery, 5, 7),
  unit("red-infantry", Player.Red, UnitType.Infantry, 6, 1),
  unit("red-tank", Player.Red, UnitType.Tank, 4, 0),
  unit("red-artillery", Player.Red, UnitType.Artillery, 2, 0),
];

function unit(id: string, player: Player, type: UnitType, x: number, y: number): Unit {
  return { id, player, type, position: { x, y }, hp: 10, hasMoved: false, hasAttacked: false };
}

/**
 * Creates a valid, independent game state. Calling without options starts the
 * standard 8x8 game; supplying units is useful for scenarios and tests.
 */
export function createGameState(options: CreateGameStateOptions = {}): GameState {
  const boardSize = options.boardSize ?? DEFAULT_BOARD_SIZE;
  if (!Number.isInteger(boardSize) || boardSize < 2) {
    throw new Error("boardSize must be an integer of at least 2");
  }

  const units = (options.units ?? defaultUnits()).map((candidate) => ({
    ...candidate,
    position: { ...candidate.position },
    hp: candidate.hp ?? 10,
    hasMoved: candidate.hasMoved ?? false,
    hasAttacked: candidate.hasAttacked ?? false,
  }));
  validateUnits(units, boardSize);
  return {
    boardSize,
    units,
    activePlayer: options.activePlayer ?? Player.Blue,
    winner: getWinner(units),
    turn: 1,
  };
}

/** Returns all legal destination squares for a unit in the current state. */
export function getReachablePositions(state: GameState, unitId: string): Coordinate[] {
  const selected = getUnit(state, unitId);
  assertCanMove(state, selected);
  const maxDistance = UNIT_STATS[selected.type].movement;
  const positions: Coordinate[] = [];

  for (let y = 0; y < state.boardSize; y += 1) {
    for (let x = 0; x < state.boardSize; x += 1) {
      const destination = { x, y };
      if (manhattanDistance(selected.position, destination) === 0 ||
          manhattanDistance(selected.position, destination) > maxDistance ||
          isOccupied(state.units, destination)) {
        continue;
      }
      positions.push(destination);
    }
  }
  return positions;
}

/** Moves one of the active player's units. The input state is never mutated. */
export function moveUnit(state: GameState, unitId: string, destination: Coordinate): GameState {
  const selected = getUnit(state, unitId);
  assertCanMove(state, selected);
  assertInBounds(state, destination);
  if (isOccupied(state.units, destination)) {
    throw new GameRuleError("DESTINATION_OCCUPIED", "A unit already occupies that square.");
  }
  if (manhattanDistance(selected.position, destination) === 0 ||
      manhattanDistance(selected.position, destination) > UNIT_STATS[selected.type].movement) {
    throw new GameRuleError("OUT_OF_RANGE", "That destination is outside this unit's movement range.");
  }
  return replaceUnit(state, { ...selected, position: { ...destination }, hasMoved: true });
}

/** Resolves deterministic damage, a possible close-range counterattack, and victory. */
export function attackUnit(state: GameState, attackerId: string, targetId: string): GameState {
  const attacker = getUnit(state, attackerId);
  const target = getUnit(state, targetId);
  assertCanAttack(state, attacker);
  if (attacker.player === target.player) {
    throw new GameRuleError("INVALID_TARGET", "A unit cannot attack an ally.");
  }
  if (manhattanDistance(attacker.position, target.position) > UNIT_STATS[attacker.type].range) {
    throw new GameRuleError("OUT_OF_RANGE", "That target is outside this unit's attack range.");
  }

  const woundedTarget = { ...target, hp: target.hp - UNIT_STATS[attacker.type].damage };
  let units = state.units
    .filter((item) => item.id !== target.id)
    .map((item) => item.id === attacker.id ? { ...item, hasAttacked: true } : item);
  if (woundedTarget.hp > 0) {
    units = [...units, woundedTarget];
    // Only a defender that can reach the attacker gets to counterattack.
    if (manhattanDistance(attacker.position, target.position) <= UNIT_STATS[target.type].range) {
      const counterDamage = UNIT_STATS[target.type].damage;
      units = units
        .map((item) => item.id === attacker.id ? { ...item, hp: item.hp - counterDamage } : item)
        .filter((item) => item.hp > 0);
    }
  }
  return withUnits(state, units);
}

/** Ends the active player's turn and refreshes every unit of the next player. */
export function endTurn(state: GameState): GameState {
  assertGameInProgress(state);
  const activePlayer = otherPlayer(state.activePlayer);
  return {
    ...state,
    activePlayer,
    turn: state.turn + 1,
    units: state.units.map((item) => item.player === activePlayer
      ? { ...item, hasMoved: false, hasAttacked: false }
      : item),
  };
}

export function manhattanDistance(a: Coordinate, b: Coordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function withUnits(state: GameState, units: readonly Unit[]): GameState {
  return { ...state, units, winner: getWinner(units) };
}

function replaceUnit(state: GameState, replacement: Unit): GameState {
  return withUnits(state, state.units.map((item) => item.id === replacement.id ? replacement : item));
}

function getUnit(state: GameState, unitId: string): Unit {
  const selected = state.units.find((item) => item.id === unitId);
  if (!selected) throw new GameRuleError("UNIT_NOT_FOUND", `No unit exists with id ${unitId}.`);
  return selected;
}

function assertOwnedByActivePlayer(state: GameState, selected: Unit): void {
  assertGameInProgress(state);
  if (selected.player !== state.activePlayer) {
    throw new GameRuleError("NOT_YOUR_UNIT", "Only the active player's units can act.");
  }
}

function assertCanMove(state: GameState, selected: Unit): void {
  assertOwnedByActivePlayer(state, selected);
  if (selected.hasMoved || selected.hasAttacked) {
    throw new GameRuleError("UNIT_ALREADY_MOVED", "This unit cannot move again this turn.");
  }
}

function assertCanAttack(state: GameState, selected: Unit): void {
  assertOwnedByActivePlayer(state, selected);
  if (selected.hasAttacked) {
    throw new GameRuleError("UNIT_ALREADY_ATTACKED", "This unit has already attacked this turn.");
  }
}

function assertGameInProgress(state: GameState): void {
  if (state.winner !== null) throw new GameRuleError("GAME_OVER", "The game has already ended.");
}

function assertInBounds(state: GameState, coordinate: Coordinate): void {
  if (!Number.isInteger(coordinate.x) || !Number.isInteger(coordinate.y) ||
      coordinate.x < 0 || coordinate.y < 0 ||
      coordinate.x >= state.boardSize || coordinate.y >= state.boardSize) {
    throw new GameRuleError("OUT_OF_BOUNDS", "That coordinate is outside the board.");
  }
}

function isOccupied(units: readonly Unit[], coordinate: Coordinate): boolean {
  return units.some((item) => item.position.x === coordinate.x && item.position.y === coordinate.y);
}

function otherPlayer(player: Player): Player {
  return player === Player.Blue ? Player.Red : Player.Blue;
}

function getWinner(units: readonly Unit[]): Player | null {
  const blueExists = units.some((item) => item.player === Player.Blue);
  const redExists = units.some((item) => item.player === Player.Red);
  if (blueExists && redExists) return null;
  return blueExists ? Player.Blue : redExists ? Player.Red : null;
}

function validateUnits(units: readonly Unit[], boardSize: number): void {
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const candidate of units) {
    if (!candidate.id || ids.has(candidate.id)) throw new Error("Unit ids must be unique.");
    ids.add(candidate.id);
    if (!Object.values(Player).includes(candidate.player)) throw new Error("Unit player is invalid.");
    if (!Object.values(UnitType).includes(candidate.type)) throw new Error("Unit type is invalid.");
    if (!Number.isInteger(candidate.hp) || candidate.hp < 1 || candidate.hp > 10) {
      throw new Error("Unit hp must be an integer from 1 through 10.");
    }
    if (!Number.isInteger(candidate.position.x) || !Number.isInteger(candidate.position.y) ||
        candidate.position.x < 0 || candidate.position.y < 0 ||
        candidate.position.x >= boardSize || candidate.position.y >= boardSize) {
      throw new Error("Every unit must be placed inside the board.");
    }
    const key = `${candidate.position.x},${candidate.position.y}`;
    if (positions.has(key)) throw new Error("Two units cannot occupy the same square.");
    positions.add(key);
  }
}
