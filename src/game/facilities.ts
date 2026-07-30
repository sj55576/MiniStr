import { isDeployedUnit, type GameState, type PlayerId, type Position, type TerrainKind, type UnitKind } from './types';
import { unitDefinitions, unitKinds, type ProductionTerrain } from './units';

export const propertyTerrainKinds = ['city', 'factory', 'capital', 'port'] as const;
export type PropertyTerrainKind = (typeof propertyTerrainKinds)[number];

const propertyTerrainKindSet = new Set<TerrainKind>(propertyTerrainKinds);

export function isPropertyTerrainKind(kind: TerrainKind): kind is PropertyTerrainKind {
  return propertyTerrainKindSet.has(kind);
}

/**
 * Production rules are deliberately data-driven so UI, commands, and future CPU
 * planning agree on which facilities may build each unit.
 *
 * Aircraft remain factory-built to preserve the existing production behavior;
 * naval units are port-only.
 */
export const productionKindsByTerrain: Partial<Record<TerrainKind, readonly UnitKind[]>> =
  (['factory', 'port'] as const).reduce((byTerrain, terrain) => {
    byTerrain[terrain] = unitKinds.filter(kind => unitDefinitions[kind].productionTerrain === terrain);
    return byTerrain;
  }, {} as Record<ProductionTerrain, readonly UnitKind[]>);

export const allProducibleUnitKinds: readonly UnitKind[] = unitKinds.filter(kind => unitDefinitions[kind].productionTerrain !== undefined);

export function canProduceUnit(terrain: TerrainKind, unit: UnitKind): boolean {
  return productionKindsByTerrain[terrain]?.includes(unit) ?? false;
}

export interface ProductionFacility { position: Position; kind: PropertyTerrainKind; kinds: readonly UnitKind[] }

/** Owned production facilities with no deployed unit on them, in stable row-major order. */
export function idleProductionFacilities(state: GameState, player: PlayerId): ProductionFacility[] {
  const facilities: ProductionFacility[] = [];
  for (let y = 0; y < state.board.height; y += 1) {
    for (let x = 0; x < state.board.width; x += 1) {
      const tile = state.board.terrain[y]![x]!;
      if (tile.owner !== player) continue;
      const kinds = productionKindsByTerrain[tile.kind];
      if (!kinds || kinds.length === 0) continue;
      const occupied = state.units.some(unit => isDeployedUnit(unit) && unit.position.x === x && unit.position.y === y);
      if (occupied) continue;
      facilities.push({ position: { x, y }, kind: tile.kind as PropertyTerrainKind, kinds });
    }
  }
  return facilities;
}

/** Total owned production facilities, regardless of occupancy. */
export function countProductionFacilities(state: GameState, player: PlayerId): number {
  let count = 0;
  for (let y = 0; y < state.board.height; y += 1) {
    for (let x = 0; x < state.board.width; x += 1) {
      const tile = state.board.terrain[y]![x]!;
      if (tile.owner !== player) continue;
      const kinds = productionKindsByTerrain[tile.kind];
      if (kinds && kinds.length > 0) count += 1;
    }
  }
  return count;
}
