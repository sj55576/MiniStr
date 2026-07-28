import { describe, expect, it } from 'vitest';
import { applyDamageVariance, damageRange, forecastCombat } from './combat';
import { attackUnit } from './commands';
import { nextRandom } from './rng';
import { createBoard, createGameState } from './state';

function combatState(seed: number) {
  const state = createGameState(createBoard(2, 1), seed);
  state.units = [
    { id: 'attacker', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    { id: 'defender', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
  ];
  return state;
}

describe('seeded combat variance', () => {
  it('uses inclusive ±10% bounds for the forecast display', () => {
    expect(damageRange(75)).toEqual({ min: 68, max: 83 });
    expect(applyDamageVariance(75, 0)).toBe(68);
    expect(applyDamageVariance(75, 1)).toBe(83);
  });

  it('advances the deterministic RNG once for each resolved damage roll', () => {
    const state = combatState(7);
    const forecast = forecastCombat(state, state.units[0]!, state.units[1]!);
    expect(forecast.ok && forecast.value).toEqual({ damageToDefender: 68, damageToAttacker: 22, canCounter: true });
    const first = nextRandom(7);
    const second = nextRandom(first.seed);
    const result = attackUnit(state, 'attacker', 'defender');
    expect(result.ok && result.value.rngSeed).toBe(second.seed);
    const defenderHp = 100 - applyDamageVariance(68, first.value);
    expect(result.ok && result.value.units.find(unit => unit.id === 'defender')?.hp).toBe(defenderHp);
    const counter = forecastCombat(state, { ...state.units[1]!, hp: defenderHp }, state.units[0]!);
    expect(counter.ok && result.ok && result.value.units.find(unit => unit.id === 'attacker')?.hp)
      .toBe(100 - applyDamageVariance(counter.ok ? counter.value.damageToDefender : 0, second.value));
  });

  it('replays the same seed and command to the identical next state', () => {
    expect(attackUnit(combatState(12345), 'attacker', 'defender')).toEqual(attackUnit(combatState(12345), 'attacker', 'defender'));
  });

  it('does not consume a counter roll when the defender cannot counterattack', () => {
    const state = combatState(9);
    state.units[1] = { ...state.units[1]!, ammo: 0 };
    const result = attackUnit(state, 'attacker', 'defender');
    expect(result.ok && result.value.rngSeed).toBe(nextRandom(9).seed);
  });

  it('allows a defender that survives a low damage roll to counterattack', () => {
    const state = combatState(1972);
    state.units[1] = { ...state.units[1]!, hp: 70 };
    const result = attackUnit(state, 'attacker', 'defender');
    expect(result.ok && result.value.units.find(unit => unit.id === 'defender')?.hp).toBeGreaterThan(0);
    expect(result.ok && result.value.units.find(unit => unit.id === 'defender')?.ammo).toBe(5);
    expect(result.ok && result.value.units.find(unit => unit.id === 'attacker')?.hp).toBeLessThan(100);
  });
});
