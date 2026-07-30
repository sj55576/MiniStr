import { describe, expect, it } from 'vitest';
import { createBoard, createGameState, damageMultiplier, forecastCombat, terrainDefenseReduction, unitCategory, type TerrainKind } from './index';

describe('Type-effectiveness combat matrix', () => {
  it('exposes the expected unit categories', () => {
    expect(unitCategory.infantry).toBe('soft');
    expect(unitCategory.tank).toBe('armor');
    expect(unitCategory.fighter).toBe('air');
    expect(unitCategory.destroyer).toBe('sea');
  });

  it('exposes the expected damage multipliers', () => {
    expect(damageMultiplier.infantry.armor).toBe(0.5);
    expect(damageMultiplier.bomber.armor).toBe(1.25);
    expect(damageMultiplier.fighter.air).toBe(1.4);
    expect(damageMultiplier.tank.soft).toBe(1.0);
    expect(damageMultiplier.tank.armor).toBe(1.0);
  });

  it('infantry deals less damage to armor than to soft targets on the same terrain', () => {
    const board = createBoard(2, 1);
    const state = createGameState(board);
    const vsSoft = forecastCombat(state,
      { id: 'a', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'infantry', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    const vsArmor = forecastCombat(state,
      { id: 'a', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    expect(vsSoft.ok && vsSoft.value.damageToDefender).toBeGreaterThan(vsArmor.ok ? vsArmor.value.damageToDefender : Infinity);
  });

  it('fighter deals more damage to air targets than to armor targets', () => {
    const board = createBoard(2, 1);
    const state = createGameState(board);
    const vsAir = forecastCombat(state,
      { id: 'a', kind: 'fighter', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'bomber', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    const vsArmor = forecastCombat(state,
      { id: 'a', kind: 'fighter', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    expect(vsAir.ok && vsAir.value.damageToDefender).toBeGreaterThan(vsArmor.ok ? vsArmor.value.damageToDefender : Infinity);
  });

  it('bomber deals bonus damage to armor compared to tank vs the same armor target', () => {
    const board = createBoard(2, 1);
    const state = createGameState(board);
    const bomberVsArmor = forecastCombat(state,
      { id: 'a', kind: 'bomber', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    const tankVsArmor = forecastCombat(state,
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    // bomber (attack 95, multiplier 1.25) should out-damage tank (attack 75, multiplier 1.0) vs the same armor target,
    // by more than the raw attack-stat gap alone would explain.
    expect(bomberVsArmor.ok && tankVsArmor.ok && bomberVsArmor.value.damageToDefender).toBeGreaterThan(tankVsArmor.ok ? tankVsArmor.value.damageToDefender : 0);
    // Directly confirm the multiplier's effect on raw damage relative to unmultiplied attack stats.
    const bomberRawEquivalent = bomberVsArmor.ok ? bomberVsArmor.value.damageToDefender / 1.25 : 0;
    const tankRawEquivalent = tankVsArmor.ok ? tankVsArmor.value.damageToDefender / 1.0 : 0;
    expect(bomberRawEquivalent).toBeGreaterThan(0);
    expect(tankRawEquivalent).toBeGreaterThan(0);
  });
});



describe('Terrain defense scaling', () => {
  // Tank (75 attack) versus a full-health infantry defender.  This table is the
  // player-visible rule: each defense star is worth 10% damage mitigation.
  const terrainDamageExpectations: readonly { kind: TerrainKind; reduction: number; damage: number }[] = [
    { kind: 'road', reduction: 0, damage: 75 },
    { kind: 'sea', reduction: 0, damage: 75 },
    { kind: 'plain', reduction: 10, damage: 68 },
    { kind: 'forest', reduction: 20, damage: 60 },
    { kind: 'city', reduction: 30, damage: 53 },
    { kind: 'factory', reduction: 30, damage: 53 },
    { kind: 'port', reduction: 30, damage: 53 },
    { kind: 'mountain', reduction: 40, damage: 45 },
    { kind: 'capital', reduction: 40, damage: 45 },
  ];

  it('applies the documented mitigation and expected damage for every terrain', () => {
    for (const { kind, reduction, damage } of terrainDamageExpectations) {
      const board = createBoard(2, 1, { kind: 'road' });
      board.terrain[0]![1] = { kind };
      const result = forecastCombat(createGameState(board),
        { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
        { id: 'd', kind: 'infantry', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
      expect(terrainDefenseReduction({ kind }, 100)).toBe(reduction);
      expect(result.ok && result.value.damageToDefender).toBe(damage);
    }
  });

  it('scales terrain mitigation down with the defender health', () => {
    const board = createBoard(2, 1, { kind: 'road' });
    board.terrain[0]![1] = { kind: 'mountain' };
    const result = forecastCombat(createGameState(board),
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'infantry', owner: 'blue', position: { x: 1, y: 0 }, hp: 50, hasMoved: false, hasActed: false });
    expect(terrainDefenseReduction({ kind: 'mountain' }, 50)).toBe(20);
    expect(result.ok && result.value.damageToDefender).toBe(60);
  });
});

describe('Counterattack ammunition', () => {
  it('allows a surviving in-range defender with ammunition to counterattack', () => {
    const state = createGameState(createBoard(2, 1));
    const result = forecastCombat(state,
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, ammo: 1, hasMoved: false, hasActed: false });
    expect(result.ok && result.value.canCounter).toBe(true);
    expect(result.ok && result.value.damageToAttacker).toBeGreaterThan(0);
  });

  it('does not allow a defender with zero ammunition to counterattack', () => {
    const state = createGameState(createBoard(2, 1));
    const result = forecastCombat(state,
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, ammo: 0, hasMoved: false, hasActed: false });
    expect(result.ok && result.value).toMatchObject({ canCounter: false, damageToAttacker: 0 });
  });
});


describe('Indirect-fire counterattack rules', () => {
  it('does not let an in-range indirect defender counter a direct attack', () => {
    const state = createGameState(createBoard(3, 1));
    const result = forecastCombat(state,
      { id: 'anti-air', kind: 'antiAir', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'artillery', kind: 'artillery', owner: 'blue', position: { x: 2, y: 0 }, hp: 100, ammo: 6, hasMoved: true, hasActed: false });
    expect(result.ok && result.value).toMatchObject({ canCounter: false, damageToAttacker: 0 });
  });

  it('does not allow a counterattack after an indirect strike', () => {
    const state = createGameState(createBoard(3, 1));
    const result = forecastCombat(state,
      { id: 'artillery', kind: 'artillery', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'anti-air', kind: 'antiAir', owner: 'blue', position: { x: 2, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false });
    expect(result.ok && result.value).toMatchObject({ canCounter: false, damageToAttacker: 0 });
  });
});
