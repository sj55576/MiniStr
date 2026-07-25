import { manhattanDistance } from './terrain';
import { unitStats } from './units';
import { isDeployedUnit, type GameState, type PlayerId, type Position, type Unit } from './types';

/** Coordinates currently visible to a player.  This is kept separate from UI so AI and rendering agree. */
export function visiblePositions(state: GameState, player: PlayerId): Position[] {
  const visible = new Map<string, Position>();
  for (const unit of state.units.filter((candidate): candidate is typeof candidate & { position: Position } => candidate.owner === player && isDeployedUnit(candidate))) {
    const range = unitStats[unit.kind].vision;
    for (let y = 0; y < state.board.height; y += 1) for (let x = 0; x < state.board.width; x += 1) {
      const position = { x, y };
      if (manhattanDistance(unit.position, position) <= range) visible.set(`${x},${y}`, position);
    }
  }
  return [...visible.values()];
}

export function visibleEnemies(state: GameState, player: PlayerId): Unit[] {
  const positions = new Set(visiblePositions(state, player).map(position => `${position.x},${position.y}`));
  return state.units.filter((unit): unit is typeof unit & { position: Position } => unit.owner !== player && isDeployedUnit(unit) && positions.has(`${unit.position.x},${unit.position.y}`));
}
