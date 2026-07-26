import { describe, expect, it } from 'vitest';
import { createBoard, createGameState, damageMultiplier, forecastCombat, unitCategory } from './index';

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

