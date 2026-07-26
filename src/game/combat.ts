import { defenseStars, manhattanDistance, terrainAt } from './terrain';
import { unitCategory, unitStats } from './units';
import type { UnitCategory } from './units';
import { isDeployedUnit, type GameResult, type GameState, type Unit, type UnitKind } from './types';

export const damageMultiplier: Record<UnitKind, Record<UnitCategory, number>> = {
  infantry: { soft: 1.0, armor: 0.5, air: 0.35, sea: 0.3 },
  recon: { soft: 1.1, armor: 0.6, air: 0.4, sea: 0.3 },
  tank: { soft: 1.0, armor: 1.0, air: 0.35, sea: 0.6 },
  artillery: { soft: 1.15, armor: 1.0, air: 0.5, sea: 0.9 },
  rocket: { soft: 1.2, armor: 1.05, air: 0.5, sea: 1.0 },
  fighter: { soft: 0.5, armor: 0.4, air: 1.4, sea: 0.5 },
  bomber: { soft: 1.25, armor: 1.25, air: 0.4, sea: 1.25 },
  destroyer: { soft: 0.7, armor: 0.7, air: 1.1, sea: 1.0 },
  landingShip: { soft: 0, armor: 0, air: 0, sea: 0 },
};

export interface CombatForecast {
  /** Damage inflicted by the attacker. Kept alongside named target fields for UI clarity. */
  attackerDamage: number;
  /** Damage received by the defender. */
  defenderDamage: number;
  /** Damage received by the attacker from a counterattack. */
  counterDamage: number;
  damageToDefender: number;
  damageToAttacker: number;
  canCounter: boolean;
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
  const defenderDamage = Math.max(0, Math.round(raw * (1 - reduction / 100)));
  const defenderRemaining = Math.max(0, defender.hp - defenderDamage);
  const counterRange = unitStats[defender.kind].range;
  const defenderAmmo = defender.ammo ?? unitStats[defender.kind].ammo;
  const canCounter = defenderRemaining > 0 && defenderAmmo > 0 && distance >= counterRange[0] && distance <= counterRange[1];
  const counterRaw = canCounter ? unitStats[defender.kind].attack * defenderRemaining / 100 * damageMultiplier[defender.kind][unitCategory[attacker.kind]] : 0;
  const counterReduction = defenseStars(attackerTerrain) * attacker.hp / 100;
  const counterDamage = Math.max(0, Math.round(counterRaw * (1 - counterReduction / 100)));
  return { ok: true, value: { attackerDamage: defenderDamage, defenderDamage, counterDamage, damageToDefender: defenderDamage, damageToAttacker: counterDamage, canCounter } };
}
