import { describe, expect, it } from 'vitest';
import { createBoard, createGameState, type GameState } from '../game';
import { presentationEffectsForCommand } from './presentationEffects';

function stateWithUnits(): GameState {
  const state = createGameState(createBoard(3, 2));
  state.units = [
    { id: 'red-1', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    { id: 'blue-1', kind: 'tank', owner: 'blue', position: { x: 2, y: 0 }, hp: 70, hasMoved: false, hasActed: false },
  ];
  return state;
}

describe('presentationEffectsForCommand', () => {
  it('shows a moving unit between its resolved positions', () => {
    const before = stateWithUnits();
    const after = structuredClone(before);
    after.units[0]!.position = { x: 1, y: 0 };
    expect(presentationEffectsForCommand(before, { type: 'move', unitId: 'red-1', destination: { x: 1, y: 0 } }, after))
      .toEqual([{ type: 'move', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, kind: 'infantry', owner: 'red', sound: 'move' }]);
  });

  it('shows combat damage and a destroyed target', () => {
    const before = stateWithUnits();
    const after = structuredClone(before);
    after.units = [after.units[0]!];
    const effects = presentationEffectsForCommand(before, { type: 'attack', unitId: 'red-1', targetId: 'blue-1' }, after);
    expect(effects).toContainEqual({ type: 'damage', position: { x: 2, y: 0 }, amount: 70, sound: 'hit' });
    expect(effects).toContainEqual({ type: 'destroy', position: { x: 2, y: 0 }, kind: 'tank', owner: 'blue', sound: 'destroy' });
  });

  it('maps capture, production, and turns to feedback', () => {
    const state = stateWithUnits();
    expect(presentationEffectsForCommand(state, { type: 'capture', unitId: 'red-1' }, state)[0]).toMatchObject({ type: 'capture', sound: 'capture' });
    expect(presentationEffectsForCommand(state, { type: 'produce', factory: { x: 1, y: 1 }, kind: 'tank' }, state))
      .toEqual([{ type: 'produce', position: { x: 1, y: 1 }, sound: 'produce' }]);
    expect(presentationEffectsForCommand(state, { type: 'endTurn' }, state)).toEqual([{ type: 'turn', sound: 'turn' }]);
  });
});
