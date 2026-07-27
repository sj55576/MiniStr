import { describe, expect, it } from 'vitest';
import { createBoard, createGameState, type DeployedUnit, type GameState } from '../game';
import { chooseCpuAction, cpuDifficultyConfig, evaluateCpuPosition } from './rules';

function unit(hp = 100): DeployedUnit {
  return { id: 'red-tank', kind: 'tank', owner: 'red', position: { x: 1, y: 0 }, hp, hasMoved: false, hasActed: false };
}

function stateWithVisibleThreat(hp = 100): GameState {
  const board = createBoard(6, 1);
  // A covered withdrawal route and an exposed square next to the visible tank.
  board.terrain[0]![0] = { kind: 'forest' };
  board.terrain[0]![3] = { kind: 'road' };
  const state = createGameState(board);
  return {
    ...state,
    units: [
      unit(hp),
      { id: 'blue-tank', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ],
  };
}

describe('CPU movement difficulty', () => {
  it('changes threat, terrain, and objective-distance scoring by difficulty', () => {
    const state = stateWithVisibleThreat();
    const tank = state.units[0] as DeployedUnit;
    const targets = [{ x: 5, y: 0 }];

    const easyThreatGap = evaluateCpuPosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.easy)
      - evaluateCpuPosition(state, 'red', tank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.easy);
    const hardThreatGap = evaluateCpuPosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluateCpuPosition(state, 'red', tank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.hard);
    expect(hardThreatGap).toBeGreaterThan(easyThreatGap);

    const easyTerrainBonus = evaluateCpuPosition(state, 'red', tank, { x: 0, y: 0 }, [{ x: 1, y: 0 }], cpuDifficultyConfig.easy)
      - evaluateCpuPosition(state, 'red', tank, { x: 3, y: 0 }, [{ x: 2, y: 0 }], cpuDifficultyConfig.easy);
    const hardTerrainBonus = evaluateCpuPosition(state, 'red', tank, { x: 0, y: 0 }, [{ x: 1, y: 0 }], cpuDifficultyConfig.hard)
      - evaluateCpuPosition(state, 'red', tank, { x: 3, y: 0 }, [{ x: 2, y: 0 }], cpuDifficultyConfig.hard);
    expect(hardTerrainBonus).toBeGreaterThan(easyTerrainBonus);

    const easyDistanceGain = evaluateCpuPosition(state, 'red', tank, { x: 2, y: 0 }, targets, cpuDifficultyConfig.easy)
      - evaluateCpuPosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.easy);
    const hardDistanceGain = evaluateCpuPosition(state, 'red', tank, { x: 2, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluateCpuPosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard);
    expect(easyDistanceGain).toBeGreaterThan(hardDistanceGain);
  });

  it('makes a damaged unit value a covered retreat more than a healthy unit', () => {
    const damagedState = stateWithVisibleThreat(20);
    const healthyState = stateWithVisibleThreat(100);
    const targets = [{ x: 5, y: 0 }];
    const damagedTank = damagedState.units[0] as DeployedUnit;
    const healthyTank = healthyState.units[0] as DeployedUnit;
    const damagedRetreatGain = evaluateCpuPosition(damagedState, 'red', damagedTank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluateCpuPosition(damagedState, 'red', damagedTank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.hard);
    const healthyRetreatGain = evaluateCpuPosition(healthyState, 'red', healthyTank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluateCpuPosition(healthyState, 'red', healthyTank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.hard);

    expect(damagedRetreatGain).toBeGreaterThan(healthyRetreatGain);
  });

  it('chooses a different deterministic move for easy and hard CPUs', () => {
    const board = createBoard(6, 1);
    // Easy advances toward the blue capital, while hard preserves the tank on
    // the defended red capital instead of approaching the visible counterattack.
    board.terrain[0]![0] = { kind: 'capital', owner: 'red', capturePoints: 20 };
    board.terrain[0]![3] = { kind: 'road' };
    board.terrain[0]![5] = { kind: 'capital', owner: 'blue', capturePoints: 20 };
    const base = createGameState(board);
    const state: GameState = {
      ...base,
      units: [
        unit(),
        { id: 'blue-tank', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      ],
    };

    expect(chooseCpuAction(state, 'easy')).toEqual({ type: 'move', unitId: 'red-tank', destination: { x: 2, y: 0 } });
    expect(chooseCpuAction(state, 'hard')).toEqual({ type: 'move', unitId: 'red-tank', destination: { x: 0, y: 0 } });
  });
});
