export interface UnitStats { cost: number; movement: number; attack: number; defense: number; capturePower: number; range: readonly [number, number]; fuel: number; /** Fuel consumed at the start of each turn while away from an owned property. */ fuelPerTurn: number; ammo: number; vision: number; /** Cannot attack on the turn it moves. */ indirect: boolean }

export type UnitCategory = 'soft' | 'armor' | 'air' | 'sea';
export type MovementProfile = 'foot' | 'vehicle' | 'air' | 'sea';
export type ProductionTerrain = 'factory' | 'port';

export interface UnitDefinition {
  category: UnitCategory;
  movementProfile: MovementProfile;
  productionTerrain: ProductionTerrain;
  /** This unit may be carried by a transport. */
  embarkable?: true;
  /** Number of embarkable units this unit can carry. */
  transportCapacity?: number;
  stats: UnitStats;
  effectiveness: Record<UnitCategory, number>;
}

/**
 * Canonical unit registry.  New units are declared here once; validation,
 * production, terrain movement, statistics, categories, and combat tables
 * are derived from it so they cannot silently fall out of sync.
 */
export const unitDefinitions = {
  infantry: {
    category: 'soft', movementProfile: 'foot', productionTerrain: 'factory', embarkable: true,
    stats: { cost: 1000, movement: 3, attack: 55, defense: 10, capturePower: 10, range: [1, 1], fuel: 99, fuelPerTurn: 0, ammo: 9, vision: 2, indirect: false },
    effectiveness: { soft: 1.0, armor: 0.5, air: 0.35, sea: 0.3 },
  },
  recon: {
    category: 'soft', movementProfile: 'vehicle', productionTerrain: 'factory',
    stats: { cost: 4000, movement: 7, attack: 35, defense: 15, capturePower: 0, range: [1, 1], fuel: 80, fuelPerTurn: 0, ammo: 6, vision: 5, indirect: false },
    effectiveness: { soft: 1.1, armor: 0.6, air: 0.4, sea: 0.3 },
  },
  tank: {
    category: 'armor', movementProfile: 'vehicle', productionTerrain: 'factory',
    stats: { cost: 7000, movement: 5, attack: 75, defense: 35, capturePower: 0, range: [1, 1], fuel: 70, fuelPerTurn: 0, ammo: 6, vision: 3, indirect: false },
    effectiveness: { soft: 1.0, armor: 1.0, air: 0.35, sea: 0.6 },
  },
  artillery: {
    category: 'armor', movementProfile: 'vehicle', productionTerrain: 'factory',
    stats: { cost: 6000, movement: 4, attack: 70, defense: 20, capturePower: 0, range: [2, 3], fuel: 50, fuelPerTurn: 0, ammo: 6, vision: 3, indirect: true },
    effectiveness: { soft: 1.15, armor: 1.0, air: 0.5, sea: 0.9 },
  },
  rocket: {
    category: 'armor', movementProfile: 'vehicle', productionTerrain: 'factory',
    stats: { cost: 12000, movement: 5, attack: 90, defense: 20, capturePower: 0, range: [3, 5], fuel: 50, fuelPerTurn: 0, ammo: 5, vision: 3, indirect: true },
    effectiveness: { soft: 1.2, armor: 1.05, air: 0.5, sea: 1.0 },
  },
  antiAir: {
    category: 'armor', movementProfile: 'vehicle', productionTerrain: 'factory',
    stats: { cost: 8000, movement: 3, attack: 65, defense: 25, capturePower: 0, range: [1, 2], fuel: 60, fuelPerTurn: 0, ammo: 6, vision: 3, indirect: false },
    effectiveness: { soft: 0.45, armor: 0.4, air: 1.8, sea: 0.3 },
  },
  fighter: {
    category: 'air', movementProfile: 'air', productionTerrain: 'factory',
    stats: { cost: 20000, movement: 8, attack: 85, defense: 15, capturePower: 0, range: [1, 1], fuel: 60, fuelPerTurn: 5, ammo: 6, vision: 5, indirect: false },
    effectiveness: { soft: 0.5, armor: 0.4, air: 1.4, sea: 0.5 },
  },
  bomber: {
    category: 'air', movementProfile: 'air', productionTerrain: 'factory',
    stats: { cost: 22000, movement: 7, attack: 95, defense: 10, capturePower: 0, range: [1, 1], fuel: 70, fuelPerTurn: 5, ammo: 6, vision: 4, indirect: false },
    effectiveness: { soft: 1.25, armor: 1.25, air: 0.4, sea: 1.25 },
  },
  destroyer: {
    category: 'sea', movementProfile: 'sea', productionTerrain: 'port',
    stats: { cost: 12000, movement: 6, attack: 70, defense: 30, capturePower: 0, range: [1, 1], fuel: 99, fuelPerTurn: 2, ammo: 9, vision: 4, indirect: false },
    effectiveness: { soft: 0.7, armor: 0.7, air: 1.1, sea: 1.0 },
  },
  landingShip: {
    category: 'sea', movementProfile: 'sea', productionTerrain: 'port', transportCapacity: 1,
    stats: { cost: 7000, movement: 5, attack: 0, defense: 20, capturePower: 0, range: [1, 1], fuel: 99, fuelPerTurn: 2, ammo: 0, vision: 3, indirect: false },
    effectiveness: { soft: 0, armor: 0, air: 0, sea: 0 },
  },
} as const satisfies Record<string, UnitDefinition>;

import type { UnitKind } from './types';

export const unitKinds = Object.keys(unitDefinitions) as UnitKind[];
export const unitKindSet: ReadonlySet<string> = new Set(unitKinds);

const valuesByKind = <Value>(select: (definition: UnitDefinition) => Value): Record<UnitKind, Value> =>
  Object.fromEntries(unitKinds.map(kind => [kind, select(unitDefinitions[kind])])) as Record<UnitKind, Value>;

export const unitCategory = valuesByKind(definition => definition.category);
export const unitStats = valuesByKind(definition => definition.stats);
export const damageMultiplier = valuesByKind(definition => definition.effectiveness);

export function isEmbarkableUnit(kind: UnitKind): boolean { return (unitDefinitions[kind] as UnitDefinition).embarkable === true; }
export function transportCapacity(kind: UnitKind): number { return (unitDefinitions[kind] as UnitDefinition).transportCapacity ?? 0; }
