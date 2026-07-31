import { reachablePositionsForPlayer } from './commands';
import { visibleEnemies } from './fog';
import { isDeployedUnit, type GameState, type PlayerId } from './types';
import { unitStats } from './units';

export interface ThreatPreview { movement: Set<string>; attack: Set<string> }
const key = (x: number, y: number) => `${x},${y}`;

/**
 * Projects one visible opponent's next turn. Its current action flags belong
 * to the previous enemy turn and deliberately do not suppress this preview.
 */
export function enemyThreatPreview(state: GameState, unitId: string, viewer: PlayerId): ThreatPreview {
  const unit = state.units.find(candidate => candidate.id === unitId);
  if (!unit || !isDeployedUnit(unit) || unit.owner === viewer || unitStats[unit.kind].attack <= 0)
    return { movement: new Set(), attack: new Set() };

  const movement = new Set<string>();
  const origins = [unit.position];
  if (!unitStats[unit.kind].indirect) for (const position of reachablePositionsForPlayer(state, unit.id, viewer)) {
    movement.add(key(position.x, position.y));
    origins.push(position);
  }
  const attack = new Set<string>();
  const [minimumRange, maximumRange] = unitStats[unit.kind].range;
  for (const origin of origins) for (let y = Math.max(0, origin.y - maximumRange); y <= Math.min(state.board.height - 1, origin.y + maximumRange); y += 1) {
    for (let x = Math.max(0, origin.x - maximumRange); x <= Math.min(state.board.width - 1, origin.x + maximumRange); x += 1) {
      const distance = Math.abs(x - origin.x) + Math.abs(y - origin.y);
      if (distance >= minimumRange && distance <= maximumRange) attack.add(key(x, y));
    }
  }
  return { movement, attack };
}

export function visibleEnemyThreats(state: GameState, viewer: PlayerId): Set<string> {
  const danger = new Set<string>();
  for (const enemy of visibleEnemies(state, viewer)) for (const position of enemyThreatPreview(state, enemy.id, viewer).attack) danger.add(position);
  return danger;
}
