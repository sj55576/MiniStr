import { defenseStars, manhattanDistance, terrainAt } from './terrain';
import { damageMultiplier, unitCategory, unitStats } from './units';
import { isDeployedUnit, type GameResult, type GameState, type Unit } from './types';

export { damageMultiplier };

export interface CombatForecast {
  /** Expected damage before the ±10% combat variance is applied. */
  damageToDefender: number;
  /** Expected counterattack damage before the ±10% combat variance is applied. */
  damageToAttacker: number;
  /** Whether the defender can counterattack at the expected damage outcome. */
  canCounter: boolean;
}

export interface DamageRange {
  min: number;
  max: number;
}

/** The inclusive damage bounds shown before combat resolves. */
export function damageRange(expectedDamage: number): DamageRange {
  return { min: applyDamageVariance(expectedDamage, 0), max: applyDamageVariance(expectedDamage, 1) };
}

/** Applies the combat's seeded ±10% modifier to an expected damage value. */
export function applyDamageVariance(expectedDamage: number, randomValue: number): number {
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  return Math.max(0, Math.round(expectedDamage * (0.9 + boundedRandom * 0.2)));
}

export function forecastCombat(state: GameState, attacker: Unit, defender: Unit): GameResult<CombatForecast> {
  if (!isDeployedUnit(attacker) || !isDeployedUnit(defender)) return { ok: false, error: 'Embarked units cannot fight' };
  if (attacker.owner === defender.owner) return { ok: false, error: 'Cannot attack a friendly unit' };
  const attackerAmmo = attacker.ammo ?? unitStats[attacker.kind].ammo;
  if (attackerAmmo <= 0) return { ok: false, error: 'Unit is out of ammunition' };
  if (unitStats[attacker.kind].attack <= 0) return { ok: false, error: 'Unit has no attack capability' };
  const distance = manhattanDistance(attacker.position, defender.position);
  const attackRange = unitStats[attacker.kind].range;
  if (distance < attackRange[0] || distance > attackRange[1]) return { ok: false, error: 'Target is out of range' };
  const defenderTerrain = terrainAt(state.board, defender.position);
  const attackerTerrain = terrainAt(state.board, attacker.position);
  if (!defenderTerrain || !attackerTerrain) return { ok: false, error: 'Unit is outside the board' };
  const raw = unitStats[attacker.kind].attack * attacker.hp / 100 * damageMultiplier[attacker.kind][unitCategory[defender.kind]];
  const reduction = defenseStars(defenderTerrain) * defender.hp / 100;
  const damageToDefender = Math.max(0, Math.round(raw * (1 - reduction / 100)));
  const defenderRemaining = Math.max(0, defender.hp - damageToDefender);
  const counterRange = unitStats[defender.kind].range;
  const defenderAmmo = defender.ammo ?? unitStats[defender.kind].ammo;
  const canCounter = defenderRemaining > 0 && defenderAmmo > 0 && distance >= counterRange[0] && distance <= counterRange[1];
  const counterRaw = canCounter ? unitStats[defender.kind].attack * defenderRemaining / 100 * damageMultiplier[defender.kind][unitCategory[attacker.kind]] : 0;
  const counterReduction = defenseStars(attackerTerrain) * attacker.hp / 100;
  const damageToAttacker = Math.max(0, Math.round(counterRaw * (1 - counterReduction / 100)));
  return { ok: true, value: { damageToDefender, damageToAttacker, canCounter } };
}
