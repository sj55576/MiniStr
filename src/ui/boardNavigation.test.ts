import { describe, expect, it } from 'vitest';
import { nextBoardPosition } from './boardNavigation';

describe('nextBoardPosition', () => {
  it('moves through a board without passing its edges', () => {
    expect(nextBoardPosition({ x: 1, y: 1 }, 4, 3, 'ArrowUp')).toEqual({ x: 1, y: 0 });
    expect(nextBoardPosition({ x: 1, y: 1 }, 4, 3, 'ArrowDown')).toEqual({ x: 1, y: 2 });
    expect(nextBoardPosition({ x: 0, y: 0 }, 4, 3, 'ArrowLeft')).toEqual({ x: 0, y: 0 });
    expect(nextBoardPosition({ x: 3, y: 2 }, 4, 3, 'ArrowRight')).toEqual({ x: 3, y: 2 });
  });

  it('moves to the start and end of the current row', () => {
    expect(nextBoardPosition({ x: 2, y: 1 }, 4, 3, 'Home')).toEqual({ x: 0, y: 1 });
    expect(nextBoardPosition({ x: 2, y: 1 }, 4, 3, 'End')).toEqual({ x: 3, y: 1 });
  });

  it('ignores unsupported keys', () => {
    expect(nextBoardPosition({ x: 1, y: 1 }, 4, 3, 'Enter')).toBeUndefined();
  });
});
