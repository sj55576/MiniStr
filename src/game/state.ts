import { isPropertyTerrainKind } from './facilities';
import type { Board, GameState, PlayerId, Position, Terrain, Unit } from './types';

export function createBoard(width: number, height: number, fill: Terrain = { kind: 'plain' }): Board {
  return { width, height, terrain: Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ...fill }))) };
}

export function createGameState(board: Board, seed = 1): GameState {
  return {
    board, units: [], players: { red: { gold: 0, income: 0 }, blue: { gold: 0, income: 0 } },
    activePlayer: 'red', turn: 1, rngSeed: seed >>> 0, nextUnitId: 1,
  };
}

export function unitAt(state: GameState, position: Position): Unit | undefined {
  return state.units.find(unit => unit.position.x === position.x && unit.position.y === position.y);
}

export function playerOwnedProperties(state: GameState, player: PlayerId): Terrain[] {
  return state.board.terrain.flat().filter(tile => tile.owner === player && isPropertyTerrainKind(tile.kind));
}
