import type { Board, Position, Terrain, TerrainKind, UnitKind } from './types';
import { unitDefinitions, unitKinds, type MovementProfile } from './units';

const movementByProfile: Record<TerrainKind, Record<MovementProfile, number>> = {
  plain: { foot: 1, vehicle: 1, air: 1, sea: Infinity },
  forest: { foot: 1, vehicle: 2, air: 1, sea: Infinity },
  road: { foot: 1, vehicle: 1, air: 1, sea: Infinity },
  mountain: { foot: 2, vehicle: Infinity, air: 1, sea: Infinity },
  swamp: { foot: 1, vehicle: 3, air: 1, sea: Infinity },
  sea: { foot: Infinity, vehicle: Infinity, air: 1, sea: 1 },
  city: { foot: 1, vehicle: 1, air: 1, sea: Infinity },
  factory: { foot: 1, vehicle: 1, air: 1, sea: Infinity },
  airport: { foot: 1, vehicle: 1, air: 1, sea: Infinity },
  port: { foot: 1, vehicle: 1, air: 1, sea: 1 },
  capital: { foot: 1, vehicle: 1, air: 1, sea: Infinity },
};

const unitMovement = (terrain: TerrainKind): Record<UnitKind, number> =>
  Object.fromEntries(unitKinds.map(kind => [kind, movementByProfile[terrain][unitDefinitions[kind].movementProfile]])) as Record<UnitKind, number>;

export const terrainRules: Record<TerrainKind, { movement: Record<UnitKind, number>; defense: number }> = {
  plain: { movement: unitMovement('plain'), defense: 1 },
  forest: { movement: unitMovement('forest'), defense: 2 },
  road: { movement: unitMovement('road'), defense: 0 },
  mountain: { movement: unitMovement('mountain'), defense: 4 },
  swamp: { movement: unitMovement('swamp'), defense: 1 },
  sea: { movement: unitMovement('sea'), defense: 0 },
  city: { movement: unitMovement('city'), defense: 3 },
  factory: { movement: unitMovement('factory'), defense: 3 },
  airport: { movement: unitMovement('airport'), defense: 3 },
  // A port is a coastal facility: infantry can capture it and ships can dock there.
  port: { movement: unitMovement('port'), defense: 3 },
  capital: { movement: unitMovement('capital'), defense: 4 },
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
