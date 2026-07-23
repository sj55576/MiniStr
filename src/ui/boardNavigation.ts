import type { Position } from '../game';

type BoardNavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/** Returns the next in-bounds board position for the supported grid navigation keys. */
export function nextBoardPosition(
  current: Position,
  width: number,
  height: number,
  key: string,
): Position | undefined {
  if (width <= 0 || height <= 0) return undefined;

  switch (key as BoardNavigationKey) {
    case 'ArrowUp': return { x: current.x, y: Math.max(0, current.y - 1) };
    case 'ArrowDown': return { x: current.x, y: Math.min(height - 1, current.y + 1) };
    case 'ArrowLeft': return { x: Math.max(0, current.x - 1), y: current.y };
    case 'ArrowRight': return { x: Math.min(width - 1, current.x + 1), y: current.y };
    case 'Home': return { x: 0, y: current.y };
    case 'End': return { x: width - 1, y: current.y };
    default: return undefined;
  }
}
