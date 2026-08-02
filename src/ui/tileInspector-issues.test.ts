import { describe, expect, it } from 'vitest';
import { createBoard, createGameState } from '../game/state';
import { inspectTile } from './tileInspector';

function stateWithFacilities() {
  const state = createGameState(createBoard(2, 1));
  state.board.terrain[0]![0] = { kind: 'factory', owner: 'red', capturePoints: 20 };
  state.board.terrain[0]![1] = { kind: 'airport', owner: 'red', capturePoints: 20 };
  return state;
}

function productionRow(state: ReturnType<typeof stateWithFacilities>, x: number, rule: 'facility-v2' | 'legacy-factory-air'): string {
  return inspectTile(state, { x, y: 0 }, 'red', new Set(['0,0', '1,0']), undefined, rule)!.rows.find(row => row.label === '生産')!.value;
}

describe('issue #88 tile production inspection', () => {
  it('uses the selected scenario production rule', () => {
    expect(productionRow(stateWithFacilities(), 0, 'facility-v2')).not.toContain('戦闘機');
    expect(productionRow(stateWithFacilities(), 0, 'legacy-factory-air')).toContain('戦闘機');
    expect(productionRow(stateWithFacilities(), 1, 'facility-v2')).toContain('戦闘機');
  });
});

