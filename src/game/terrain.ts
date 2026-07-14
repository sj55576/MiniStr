import type { Board, Position, Terrain, TerrainKind, UnitKind } from './types';

const land = { infantry: 1, tank: 1, artillery: 1, fighter: 1, bomber: 1, destroyer: Infinity } as const;
export const terrainRules: Record<TerrainKind, { movement: Record<UnitKind, number>; defense: number }> = {
  plain: { movement: land, defense: 1 }, forest: { movement: { ...land, tank: 2, artillery: 2 }, defense: 2 }, road: { movement: land, defense: 0 },
  mountain: { movement: { ...land, infantry: 2, tank: Infinity, artillery: Infinity }, defense: 4 },
  sea: { movement: { infantry: Infinity, tank: Infinity, artillery: Infinity, fighter: 1, bomber: 1, destroyer: 1 }, defense: 0 },
  city: { movement: land, defense: 3 }, factory: { movement: land, defense: 3 }, capital: { movement: land, defense: 4 },
};

export const positionKey = ({ x, y }: Position): string => `${x},${y}`;
export const samePosition = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;
export const manhattanDistance = (a: Position, b: Position): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function terrainAt(board: Board, position: Position): Terrain | undefined {
  if (position.x < 0 || position.y < 0 || position.x >= board.width || position.y >= board.height) return undefined;
  return board.terrain[position.y]?.[position.x];
}

export function movementCost(board: Board, position: Position, unit: UnitKind): number {
  const terrain = terrainAt(board, position);
  return terrain ? terrainRules[terrain.kind].movement[unit] : Infinity;
}

export function defenseStars(terrain: Terrain): number { return terrainRules[terrain.kind].defense; }
