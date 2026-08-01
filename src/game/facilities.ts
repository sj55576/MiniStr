import { isDeployedUnit, type GameState, type PlayerId, type Position, type TerrainKind, type UnitKind } from './types';
import { unitDefinitions, unitKinds, type ProductionTerrain } from './units';

export const propertyTerrainKinds = ['city', 'factory', 'airport', 'capital', 'port'] as const;
export type PropertyTerrainKind = (typeof propertyTerrainKinds)[number];

const propertyTerrainKindSet = new Set<TerrainKind>(propertyTerrainKinds);

export function isPropertyTerrainKind(kind: TerrainKind): kind is PropertyTerrainKind {
  return propertyTerrainKindSet.has(kind);
}

export const productionRules = ['facility-v2', 'legacy-factory-air'] as const;
export type ProductionRule = (typeof productionRules)[number];
export const productionRuleSet: ReadonlySet<string> = new Set(productionRules);
export const defaultProductionRule: ProductionRule = 'facility-v2';

type ProductionKindsByTerrain = Partial<Record<TerrainKind, readonly UnitKind[]>>;

/**
 * Production is derived from the unit registry so adding a unit updates every
 * production consumer together. `legacy-factory-air` is deliberately additive:
 * JSON written before airports existed keeps aircraft available at factories,
 * while a newly authored airport still works as an air facility.
 */
function buildProductionKindsByTerrain(rule: ProductionRule): ProductionKindsByTerrain {
  const byTerrain: Record<ProductionTerrain, UnitKind[]> = { factory: [], airport: [], port: [] };
  for (const kind of unitKinds) byTerrain[unitDefinitions[kind].productionTerrain].push(kind);
  if (rule === 'legacy-factory-air') {
    for (const kind of byTerrain.airport) byTerrain.factory.push(kind);
  }
  return byTerrain;
}

export const productionKindsByTerrain: ProductionKindsByTerrain = buildProductionKindsByTerrain(defaultProductionRule);
const legacyProductionKindsByTerrain: ProductionKindsByTerrain = buildProductionKindsByTerrain('legacy-factory-air');

export function productionKindsForRule(rule: ProductionRule = defaultProductionRule): ProductionKindsByTerrain {
  return rule === 'legacy-factory-air' ? legacyProductionKindsByTerrain : productionKindsByTerrain;
}

export const allProducibleUnitKinds: readonly UnitKind[] = unitKinds.filter(kind => unitDefinitions[kind].productionTerrain !== undefined);

export function canProduceUnit(terrain: TerrainKind, unit: UnitKind, rule: ProductionRule = defaultProductionRule): boolean {
  return productionKindsForRule(rule)[terrain]?.includes(unit) ?? false;
}

export interface ProductionFacility { position: Position; kind: PropertyTerrainKind; kinds: readonly UnitKind[] }

/** Owned production facilities with no deployed unit on them, in stable row-major order. */
export function idleProductionFacilities(state: GameState, player: PlayerId, rule: ProductionRule = defaultProductionRule): ProductionFacility[] {
  const production = productionKindsForRule(rule);
  const facilities: ProductionFacility[] = [];
  for (let y = 0; y < state.board.height; y += 1) {
    for (let x = 0; x < state.board.width; x += 1) {
      const tile = state.board.terrain[y]![x]!;
      if (tile.owner !== player) continue;
      const kinds = production[tile.kind];
      if (!kinds || kinds.length === 0) continue;
      const occupied = state.units.some(unit => isDeployedUnit(unit) && unit.position.x === x && unit.position.y === y);
      if (occupied) continue;
      facilities.push({ position: { x, y }, kind: tile.kind as PropertyTerrainKind, kinds });
    }
  }
  return facilities;
}

/** Total owned production facilities, regardless of occupancy. */
export function countProductionFacilities(state: GameState, player: PlayerId, rule: ProductionRule = defaultProductionRule): number {
  const production = productionKindsForRule(rule);
  let count = 0;
  for (let y = 0; y < state.board.height; y += 1) {
    for (let x = 0; x < state.board.width; x += 1) {
      const tile = state.board.terrain[y]![x]!;
      if (tile.owner !== player) continue;
      const kinds = production[tile.kind];
      if (kinds && kinds.length > 0) count += 1;
    }
  }
  return count;
}
