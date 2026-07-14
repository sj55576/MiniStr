import { createBoard } from './state';
import type { Board, PlayerId, TerrainKind } from './types';

export interface MapDefinition { id: string; name: string; board: Board; startingGold: number }
const paint = (board: Board, cells: readonly [number, number, TerrainKind, PlayerId?][]): Board => ({ ...board, terrain: board.terrain.map((row, y) => row.map((tile, x) => {
  const hit = cells.find(([cx, cy]) => x === cx && y === cy);
  return hit ? { kind: hit[2], owner: hit[3], capturePoints: hit[2] === 'city' || hit[2] === 'factory' || hit[2] === 'capital' ? 20 : undefined } : tile;
})) });

export const maps: readonly MapDefinition[] = [
  { id: 'skirmish', name: '緑の国境', startingGold: 6000, board: paint(createBoard(10, 8), [[0, 0, 'capital', 'red'], [1, 0, 'factory', 'red'], [9, 7, 'capital', 'blue'], [8, 7, 'factory', 'blue'], [4, 3, 'city'], [5, 4, 'city'], [4, 4, 'forest'], [5, 3, 'mountain']]) },
  { id: 'islands', name: '島嶼戦', startingGold: 9000, board: paint(createBoard(12, 8, { kind: 'sea' }), [[0, 1, 'capital', 'red'], [1, 1, 'factory', 'red'], [11, 6, 'capital', 'blue'], [10, 6, 'factory', 'blue'], [4, 3, 'plain'], [5, 3, 'city'], [6, 4, 'plain'], [7, 4, 'city']]) },
];
