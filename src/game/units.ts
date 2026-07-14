import type { UnitKind } from './types';

export interface UnitStats { cost: number; movement: number; attack: number; defense: number; capturePower: number; range: readonly [number, number]; fuel: number; ammo: number; vision: number }

export const unitStats: Record<UnitKind, UnitStats> = {
  infantry: { cost: 1000, movement: 3, attack: 55, defense: 10, capturePower: 10, range: [1, 1], fuel: 99, ammo: 9, vision: 2 },
  tank: { cost: 7000, movement: 5, attack: 75, defense: 35, capturePower: 0, range: [1, 1], fuel: 70, ammo: 6, vision: 3 },
  artillery: { cost: 6000, movement: 4, attack: 70, defense: 20, capturePower: 0, range: [2, 3], fuel: 50, ammo: 6, vision: 3 },
  fighter: { cost: 20000, movement: 8, attack: 85, defense: 15, capturePower: 0, range: [1, 1], fuel: 60, ammo: 6, vision: 5 },
  bomber: { cost: 22000, movement: 7, attack: 95, defense: 10, capturePower: 0, range: [1, 1], fuel: 70, ammo: 6, vision: 4 },
  destroyer: { cost: 12000, movement: 6, attack: 70, defense: 30, capturePower: 0, range: [1, 1], fuel: 99, ammo: 9, vision: 4 },
};
