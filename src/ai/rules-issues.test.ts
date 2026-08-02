import { describe, expect, it } from 'vitest';
import { chooseCpuAction } from './rules';
import { createBoard, createGameState } from '../game/state';
import { unitStats } from '../game/units';
import type { GameState, UnitKind } from '../game/types';

function deployed(id: string, kind: UnitKind, owner: 'red' | 'blue', x: number, y: number) {
  const stats = unitStats[kind];
  return { id, kind, owner, position: { x, y }, hp: 100, fuel: stats.fuel, ammo: stats.ammo, hasMoved: false, hasActed: false };
}

function occupiedHiddenFacilityState(): GameState {
  const state = createGameState(createBoard(9, 1));
  state.activePlayer = 'blue';
  state.players.blue.gold = 1000;
  state.board.terrain[0]![8] = { kind: 'factory', owner: 'blue', capturePoints: 20 };
  state.units = [
    deployed('blue-tank', 'tank', 'blue', 3, 0),
    deployed('red-infantry', 'infantry', 'red', 8, 0),
  ];
  return state;
}

describe('issue #84 CPU production safety', () => {
  it('does not choose a production command for a facility occupied by an unseen enemy', () => {
    const action = chooseCpuAction(occupiedHiddenFacilityState(), 'normal', 'blue');
    expect(action).not.toEqual({ type: 'produce', factory: { x: 8, y: 0 }, kind: 'infantry' });
    expect(action.type).not.toBe('produce');
  });
});

