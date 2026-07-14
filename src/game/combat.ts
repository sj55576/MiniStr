import { defenseStars, manhattanDistance, terrainAt } from './terrain';
import { unitStats } from './units';
import type { GameResult, GameState, Unit } from './types';

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
  if (attacker.owner === defender.owner) return { ok: false, error: 'Cannot attack a friendly unit' };
  const distance = manhattanDistance(attacker.position, defender.position);
  const attackRange = unitStats[attacker.kind].range;
  if (distance < attackRange[0] || distance > attackRange[1]) return { ok: false, error: 'Target is out of range' };
  const defenderTerrain = terrainAt(state.board, defender.position);
  const attackerTerrain = terrainAt(state.board, attacker.position);
  if (!defenderTerrain || !attackerTerrain) return { ok: false, error: 'Unit is outside the board' };
  const raw = unitStats[attacker.kind].attack * attacker.hp / 100;
  const reduction = defenseStars(defenderTerrain) * defender.hp / 100;
  const defenderDamage = Math.max(0, Math.round(raw * (1 - reduction / 100)));
  const defenderRemaining = Math.max(0, defender.hp - defenderDamage);
  const counterRange = unitStats[defender.kind].range;
  const canCounter = defenderRemaining > 0 && distance >= counterRange[0] && distance <= counterRange[1];
  const counterRaw = canCounter ? unitStats[defender.kind].attack * defenderRemaining / 100 : 0;
  const counterReduction = defenseStars(attackerTerrain) * attacker.hp / 100;
  const counterDamage = Math.max(0, Math.round(counterRaw * (1 - counterReduction / 100)));
  return { ok: true, value: { attackerDamage: defenderDamage, defenderDamage, counterDamage, damageToDefender: defenderDamage, damageToAttacker: counterDamage, canCounter } };
}
