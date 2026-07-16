import { createBoard } from './state';
import type { Board, PlayerId, TerrainKind, UnitKind } from './types';

export interface InitialUnit { kind: UnitKind; owner: PlayerId; x: number; y: number }
export interface MapDefinition { id: string; name: string; board: Board; startingGold: number; initialUnits: readonly InitialUnit[] }
type Cell = readonly [number, number, TerrainKind, PlayerId?];

const paint = (board: Board, cells: readonly Cell[]): Board => ({ ...board, terrain: board.terrain.map((row, y) => row.map((tile, x) => {
  const hit = cells.find(([cx, cy]) => x === cx && y === cy);
  return hit ? { kind: hit[2], owner: hit[3], capturePoints: ['city', 'factory', 'capital'].includes(hit[2]) ? 20 : undefined } : tile;
})) });

const units = (...initialUnits: InitialUnit[]) => initialUnits;

export const maps: readonly MapDefinition[] = [
  {
    id: 'skirmish', name: '緑の国境', startingGold: 6000,
    board: paint(createBoard(10, 8), [[0, 0, 'capital', 'red'], [1, 0, 'factory', 'red'], [9, 7, 'capital', 'blue'], [8, 7, 'factory', 'blue'], [4, 3, 'city'], [5, 4, 'city'], [4, 4, 'forest'], [5, 3, 'mountain'], [2, 2, 'forest'], [7, 5, 'forest']]),
    initialUnits: units(
      { kind: 'infantry', owner: 'red', x: 0, y: 1 }, { kind: 'tank', owner: 'red', x: 1, y: 1 }, { kind: 'recon', owner: 'red', x: 2, y: 1 },
      { kind: 'infantry', owner: 'blue', x: 9, y: 6 }, { kind: 'tank', owner: 'blue', x: 8, y: 6 }, { kind: 'recon', owner: 'blue', x: 7, y: 6 }),
  },
  {
    id: 'islands', name: '群島補給線', startingGold: 9000,
    board: paint(createBoard(12, 8, { kind: 'sea' }), [[0, 0, 'plain'], [1, 0, 'plain'], [2, 0, 'plain'], [0, 1, 'capital', 'red'], [1, 1, 'factory', 'red'], [2, 1, 'plain'], [0, 2, 'plain'], [1, 2, 'plain'], [2, 2, 'plain'], [9, 5, 'plain'], [10, 5, 'plain'], [11, 5, 'plain'], [9, 6, 'plain'], [10, 6, 'factory', 'blue'], [11, 6, 'capital', 'blue'], [9, 7, 'plain'], [10, 7, 'plain'], [11, 7, 'plain'], [4, 3, 'plain'], [5, 3, 'city'], [6, 4, 'plain'], [7, 4, 'city']]),
    initialUnits: units(
      { kind: 'infantry', owner: 'red', x: 0, y: 2 }, { kind: 'fighter', owner: 'red', x: 1, y: 0 }, { kind: 'destroyer', owner: 'red', x: 3, y: 2 },
      { kind: 'infantry', owner: 'blue', x: 11, y: 5 }, { kind: 'fighter', owner: 'blue', x: 10, y: 7 }, { kind: 'destroyer', owner: 'blue', x: 8, y: 5 }),
  },
  {
    id: 'canyon', name: '峡谷の関門', startingGold: 11000,
    board: paint(createBoard(12, 10), [[0, 1, 'capital', 'red'], [1, 1, 'factory', 'red'], [2, 2, 'city', 'red'], [11, 8, 'capital', 'blue'], [10, 8, 'factory', 'blue'], [9, 7, 'city', 'blue'], [5, 0, 'mountain'], [5, 1, 'mountain'], [5, 2, 'mountain'], [5, 3, 'mountain'], [5, 4, 'mountain'], [5, 6, 'mountain'], [5, 7, 'mountain'], [5, 8, 'mountain'], [5, 9, 'mountain'], [5, 5, 'road'], [6, 5, 'city'], [4, 5, 'road'], [7, 5, 'road'], [8, 5, 'road'], [3, 4, 'forest'], [7, 6, 'forest']]),
    initialUnits: units(
      { kind: 'infantry', owner: 'red', x: 0, y: 2 }, { kind: 'tank', owner: 'red', x: 1, y: 2 }, { kind: 'artillery', owner: 'red', x: 2, y: 3 }, { kind: 'rocket', owner: 'red', x: 1, y: 3 }, { kind: 'bomber', owner: 'red', x: 2, y: 1 },
      { kind: 'infantry', owner: 'blue', x: 11, y: 7 }, { kind: 'tank', owner: 'blue', x: 10, y: 7 }, { kind: 'artillery', owner: 'blue', x: 9, y: 6 }, { kind: 'rocket', owner: 'blue', x: 10, y: 6 }, { kind: 'bomber', owner: 'blue', x: 9, y: 8 }),
  },
  {
    id: 'siege', name: '首都包囲', startingGold: 14000,
    board: paint(createBoard(14, 10), [[0, 0, 'capital', 'red'], [1, 0, 'factory', 'red'], [2, 1, 'city', 'red'], [13, 9, 'capital', 'blue'], [12, 9, 'factory', 'blue'], [11, 8, 'city', 'blue'], [6, 4, 'capital'], [6, 5, 'city'], [7, 4, 'city'], [7, 5, 'factory'], [3, 2, 'forest'], [4, 2, 'forest'], [9, 7, 'forest'], [10, 7, 'forest'], [5, 3, 'road'], [6, 3, 'road'], [7, 3, 'road'], [8, 3, 'road'], [5, 6, 'road'], [6, 6, 'road'], [7, 6, 'road'], [8, 6, 'road']]),
    initialUnits: units(
      { kind: 'infantry', owner: 'red', x: 0, y: 1 }, { kind: 'recon', owner: 'red', x: 1, y: 1 }, { kind: 'tank', owner: 'red', x: 2, y: 0 }, { kind: 'rocket', owner: 'red', x: 2, y: 2 }, { kind: 'fighter', owner: 'red', x: 3, y: 0 },
      { kind: 'infantry', owner: 'blue', x: 13, y: 8 }, { kind: 'recon', owner: 'blue', x: 12, y: 8 }, { kind: 'tank', owner: 'blue', x: 11, y: 9 }, { kind: 'rocket', owner: 'blue', x: 11, y: 7 }, { kind: 'fighter', owner: 'blue', x: 10, y: 9 }),
  },
];
