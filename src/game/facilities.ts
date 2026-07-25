import type { TerrainKind, UnitKind } from './types';

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
 * the only naval unit currently implemented, destroyer, is port-only.
 */
export const productionKindsByTerrain: Partial<Record<TerrainKind, readonly UnitKind[]>> = {
  factory: ['infantry', 'recon', 'tank', 'artillery', 'rocket', 'fighter', 'bomber'],
  port: ['destroyer'],
};

export const allProducibleUnitKinds: readonly UnitKind[] = [
  'infantry', 'recon', 'tank', 'artillery', 'rocket', 'fighter', 'bomber', 'destroyer',
];

export function canProduceUnit(terrain: TerrainKind, unit: UnitKind): boolean {
  return productionKindsByTerrain[terrain]?.includes(unit) ?? false;
}
