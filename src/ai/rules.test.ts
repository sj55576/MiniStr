import { describe, expect, it } from 'vitest';
import { applyGameCommand, createBoard, createGameState, endTurn, maps, reachablePositions, type DeployedUnit, type GameState } from '../game';
import { chooseCpuAction, cpuDifficultyConfig, createCpuPlanningContext, evaluateCpuPosition as scoreCpuPosition } from './rules';

const stateWith = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch });

function evaluatePosition(
  state: GameState,
  player: 'red' | 'blue',
  unit: DeployedUnit,
  destination: { x: number; y: number },
  targets: readonly { x: number; y: number }[],
  config = cpuDifficultyConfig.normal,
): number {
  const { visibleEnemies } = createCpuPlanningContext(state, player, config);
  return scoreCpuPosition(state, player, unit, destination, targets, config, visibleEnemies);
}

describe('Phase 3 rule-based CPU', () => {
  it('captures an enemy property before taking other actions', () => {
    const board = createBoard(2, 1);
    board.terrain[0]![0] = { kind: 'city', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'infantry', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'tank', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'capture', unitId: 'infantry' });
  });

  it('attacks a favorable target that is in range', () => {
    const state = stateWith(createGameState(createBoard(2, 1)), { units: [
      { id: 'tank', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'infantry', kind: 'infantry', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'attack', unitId: 'tank', targetId: 'infantry' });
  });

  it('never chooses a zero-damage attack, even on hard difficulty', () => {
    const state = stateWith(createGameState(createBoard(2, 1, { kind: 'sea' })), { units: [
      { id: 'transport', kind: 'landingShip', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 1, hasMoved: false, hasActed: false },
      { id: 'target', kind: 'destroyer', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state, 'hard')).not.toMatchObject({ type: 'attack' });
  });

  it('produces toward the 2 infantry : 2 tanks : 1 artillery mix', () => {
    const board = createBoard(1, 1, { kind: 'factory', owner: 'red' });
    const state = stateWith(createGameState(board), { players: { red: { gold: 7000, income: 0 }, blue: { gold: 0, income: 0 } }, units: [
      { id: 'i1', kind: 'infantry', owner: 'red', position: { x: 3, y: 3 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'i2', kind: 'infantry', owner: 'red', position: { x: 4, y: 3 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'tank' });
  });

  it('advances its full movement range toward an enemy capital in one order', () => {
    const board = createBoard(6, 1);
    board.terrain[0]![5] = { kind: 'capital', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state, 'normal')).toEqual({ type: 'move', unitId: 'i', destination: { x: 3, y: 0 } });
  });

  it('steps onto an adjacent enemy capital so it can capture next', () => {
    const board = createBoard(3, 1);
    board.terrain[0]![2] = { kind: 'capital', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'i', kind: 'infantry', owner: 'red', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state, 'normal')).toEqual({ type: 'move', unitId: 'i', destination: { x: 2, y: 0 } });
  });
});

describe('CPU fog-of-war attacks', () => {
  it('does not choose an attack against an in-range enemy outside allied vision', () => {
    const state = stateWith(createGameState(createBoard(5, 1)), { units: [
      { id: 'rocket', kind: 'rocket', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 5, hasMoved: false, hasActed: false },
      { id: 'target', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).not.toMatchObject({ type: 'attack' });
  });

  it('chooses the attack once an allied scout makes the target visible', () => {
    const state = stateWith(createGameState(createBoard(5, 2)), { units: [
      { id: 'rocket', kind: 'rocket', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 5, hasMoved: false, hasActed: false },
      { id: 'spotter', kind: 'recon', owner: 'red', position: { x: 0, y: 1 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'target', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(state)).toEqual({ type: 'attack', unitId: 'rocket', targetId: 'target' });
  });
});

describe('CPU positional evaluation and production', () => {
  it('values defensive terrain and an owned facility for a low-supply unit', () => {
    const board = createBoard(4, 1);
    board.terrain[0]![1] = { kind: 'forest' };
    board.terrain[0]![3] = { kind: 'factory', owner: 'red', capturePoints: 20 };
    const state = stateWith(createGameState(board), { units: [
      { id: 'tank', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, fuel: 2, ammo: 1, hasMoved: false, hasActed: false },
    ] });
    const tank = state.units[0]! as DeployedUnit;
    expect(evaluatePosition(state, 'red', tank, { x: 1, y: 0 }, [{ x: 3, y: 0 }])).toBeGreaterThan(0);
    expect(evaluatePosition(state, 'red', tank, { x: 3, y: 0 }, [{ x: 3, y: 0 }])).toBeGreaterThan(evaluatePosition(state, 'red', tank, { x: 1, y: 0 }, [{ x: 3, y: 0 }]));
  });


  it('weights cover with the same HP-scaled terrain mitigation used by combat', () => {
    const board = createBoard(2, 1, { kind: 'road' });
    board.terrain[0]![1] = { kind: 'mountain' };
    const state = createGameState(board);
    const fullHealth: DeployedUnit = { id: 'full', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false };
    const damaged: DeployedUnit = { ...fullHealth, id: 'damaged', hp: 50 };

    const coverGain = (unit: DeployedUnit) => evaluatePosition(state, 'red', unit, { x: 1, y: 0 }, [])
      - evaluatePosition(state, 'red', unit, { x: 0, y: 0 }, []);
    // Mountain gives 40% mitigation at 100 HP and 20% at 50 HP. CPU scores
    // those values as 36 and 18 respectively (the documented 0.9 score scale).
    expect(coverGain(fullHealth)).toBe(36);
    expect(coverGain(damaged)).toBe(18);
  });

  it('produces an anti-air counter for a confirmed air threat and a destroyer on a naval map', () => {
    const airBoard = createBoard(4, 2);
    airBoard.terrain[0]![0] = { kind: 'factory', owner: 'red', capturePoints: 20 };
    const airState = stateWith(createGameState(airBoard), { players: { red: { gold: 25_000, income: 0 }, blue: { gold: 0, income: 0 } }, units: [
      { id: 'scout', kind: 'recon', owner: 'red', position: { x: 0, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'bomber', kind: 'bomber', owner: 'blue', position: { x: 3, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    expect(chooseCpuAction(airState)).toEqual({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'antiAir' });

    const navalBoard = createBoard(2, 2, { kind: 'sea' });
    navalBoard.terrain[0]![0] = { kind: 'port', owner: 'red', capturePoints: 20 };
    navalBoard.terrain[1]![1] = { kind: 'city', owner: 'blue', capturePoints: 20 };
    const navalState = stateWith(createGameState(navalBoard), { players: { red: { gold: 20_000, income: 0 }, blue: { gold: 0, income: 0 } } });
    expect(chooseCpuAction(navalState)).toEqual({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'destroyer' });
  });

  it('does not let an unseen enemy alter its move choice', () => {
    const board = createBoard(6, 1);
    board.terrain[0]![5] = { kind: 'capital', owner: 'blue', capturePoints: 20 };
    const base = stateWith(createGameState(board), { units: [
      { id: 'infantry', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    const withHiddenEnemy = stateWith(base, { units: [...base.units, { id: 'hidden', kind: 'rocket', owner: 'blue', position: { x: 5, y: 0 }, hp: 100, hasMoved: false, hasActed: false }] });
    expect(chooseCpuAction(withHiddenEnemy)).toEqual(chooseCpuAction(base));
  });

  it('shares one fog-safe observation set across positional evaluations', () => {
    const state = stateWithVisibleThreat();
    const tank = state.units[0] as DeployedUnit;
    const context = createCpuPlanningContext(state, 'red', cpuDifficultyConfig.normal);

    expect(context.visibleEnemies.map(unit => unit.id)).toEqual(['blue-tank']);
    const viaContext = scoreCpuPosition(
      state, 'red', tank, { x: 0, y: 0 }, context.targets, cpuDifficultyConfig.normal, context.visibleEnemies,
    );
    expect(viaContext).toBe(evaluatePosition(
      state, 'red', tank, { x: 0, y: 0 }, context.targets, cpuDifficultyConfig.normal,
    ));
  });
});

function islandTransportState(withShip = true): GameState {
  const board = createBoard(8, 3, { kind: 'sea' });
  for (let y = 0; y < 3; y += 1) {
    board.terrain[y]![0] = { kind: 'plain' };
    board.terrain[y]![1] = { kind: 'plain' };
  }
  board.terrain[1]![7] = { kind: 'capital', owner: 'red', capturePoints: 20 };
  board.terrain[0]![0] = { kind: 'port', owner: 'blue', capturePoints: 20 };
  const state = createGameState(board);
  state.activePlayer = 'blue';
  state.players.blue.gold = 10_000;
  state.units = [
    { id: 'infantry', kind: 'infantry', owner: 'blue', position: { x: 1, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
    ...(withShip ? [{ id: 'ship', kind: 'landingShip' as const, owner: 'blue' as const, position: { x: 2, y: 1 }, hp: 100, hasMoved: false, hasActed: false }] : []),
  ];
  return state;
}

describe('CPU amphibious transport', () => {
  it('boards, sails, and lands infantry toward a remote capital with only legal commands', () => {
    let state = islandTransportState();
    const first = chooseCpuAction(state);
    expect(first).toEqual({ type: 'embark', unitId: 'infantry', transportId: 'ship' });
    let result = applyGameCommand(state, first);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = endTurn(endTurn(result.value));

    const sail = chooseCpuAction(state);
    expect(sail).toMatchObject({ type: 'move', unitId: 'ship' });
    result = applyGameCommand(state, sail);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = endTurn(endTurn(result.value));

    const land = chooseCpuAction(state);
    expect(land).toEqual({ type: 'disembark', transportId: 'ship', destination: { x: 7, y: 1 } });
    expect(applyGameCommand(state, land).ok).toBe(true);
  });

  it('builds a landing ship at an empty port before factory units when an infantry objective is remote', () => {
    const action = chooseCpuAction(islandTransportState(false));
    expect(action).toEqual({ type: 'produce', factory: { x: 0, y: 0 }, kind: 'landingShip' });
  });

  it('includes a dedicated scenario whose capital objective cannot be reached by walking', () => {
    const scenario = maps.find(map => map.id === 'landing');
    expect(scenario?.victoryConditions).toEqual([{ type: 'captureCapital' }]);
    const state = createGameState(scenario!.board);
    const redInfantry = scenario!.initialUnits.find(unit => unit.owner === 'red' && unit.kind === 'infantry')!;
    const enemyCapital = { x: 9, y: 4 };
    state.units = [{ id: 'red-infantry', kind: 'infantry', owner: 'red', position: { x: redInfantry.x, y: redInfantry.y }, hp: 100, hasMoved: false, hasActed: false }];
    expect(reachablePositions(state, 'red-infantry')).not.toContainEqual(enemyCapital);
    expect(scenario!.initialUnits.some(unit => unit.owner === 'red' && unit.kind === 'landingShip')).toBe(true);
  });
});

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

    const easyThreatGap = evaluatePosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.easy)
      - evaluatePosition(state, 'red', tank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.easy);
    const hardThreatGap = evaluatePosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluatePosition(state, 'red', tank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.hard);
    expect(hardThreatGap).toBeGreaterThan(easyThreatGap);

    const easyTerrainBonus = evaluatePosition(state, 'red', tank, { x: 0, y: 0 }, [{ x: 1, y: 0 }], cpuDifficultyConfig.easy)
      - evaluatePosition(state, 'red', tank, { x: 3, y: 0 }, [{ x: 2, y: 0 }], cpuDifficultyConfig.easy);
    const hardTerrainBonus = evaluatePosition(state, 'red', tank, { x: 0, y: 0 }, [{ x: 1, y: 0 }], cpuDifficultyConfig.hard)
      - evaluatePosition(state, 'red', tank, { x: 3, y: 0 }, [{ x: 2, y: 0 }], cpuDifficultyConfig.hard);
    expect(hardTerrainBonus).toBeGreaterThan(easyTerrainBonus);

    const easyDistanceGain = evaluatePosition(state, 'red', tank, { x: 2, y: 0 }, targets, cpuDifficultyConfig.easy)
      - evaluatePosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.easy);
    const hardDistanceGain = evaluatePosition(state, 'red', tank, { x: 2, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluatePosition(state, 'red', tank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard);
    expect(easyDistanceGain).toBeGreaterThan(hardDistanceGain);
  });

  it('makes a damaged unit value a covered retreat more than a healthy unit', () => {
    const damagedState = stateWithVisibleThreat(20);
    const healthyState = stateWithVisibleThreat(100);
    const targets = [{ x: 5, y: 0 }];
    const damagedTank = damagedState.units[0] as DeployedUnit;
    const healthyTank = healthyState.units[0] as DeployedUnit;
    const damagedRetreatGain = evaluatePosition(damagedState, 'red', damagedTank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluatePosition(damagedState, 'red', damagedTank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.hard);
    const healthyRetreatGain = evaluatePosition(healthyState, 'red', healthyTank, { x: 0, y: 0 }, targets, cpuDifficultyConfig.hard)
      - evaluatePosition(healthyState, 'red', healthyTank, { x: 3, y: 0 }, targets, cpuDifficultyConfig.hard);

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


describe('CPU indirect fire rule', () => {
  it('does not issue an attack for a moved indirect unit', () => {
    const state = createGameState(createBoard(4, 1));
    state.units = [
      { id: 'artillery', kind: 'artillery', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: true, hasActed: false },
      { id: 'target', kind: 'tank', owner: 'blue', position: { x: 2, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    expect(chooseCpuAction(state)).not.toMatchObject({ type: 'attack' });
  });
});

describe('CPU command legality and hidden movement', () => {
  it('can wait in place when the current position has the best score', () => {
    const board = createBoard(6, 1);
    board.terrain[0]![0] = { kind: 'capital', owner: 'red', capturePoints: 20 };
    board.terrain[0]![5] = { kind: 'capital', owner: 'blue', capturePoints: 20 };
    const state = stateWith(createGameState(board), { units: [
      { id: 'tank', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 20, hasMoved: false, hasActed: false },
      { id: 'threat', kind: 'tank', owner: 'blue', position: { x: 3, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });

    const action = chooseCpuAction(state, 'hard');
    expect(action).toEqual({ type: 'move', unitId: 'tank', destination: { x: 0, y: 0 } });
    const applied = applyGameCommand(state, action);
    expect(applied.ok && applied.value.units.find(unit => unit.id === 'tank')).toMatchObject({ position: { x: 0, y: 0 }, hasMoved: true });
  });

  it('skips an acted unit and emits a legal move for a remaining unit', () => {
    const board = createBoard(5, 1);
    board.terrain[0]![4] = { kind: 'capital', owner: 'blue' };
    const state = stateWith(createGameState(board), { units: [
      { id: 'spent', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: true },
      { id: 'ready', kind: 'infantry', owner: 'red', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ] });
    const action = chooseCpuAction(state);

    expect(action).toMatchObject({ type: 'move', unitId: 'ready' });
    expect(applyGameCommand(state, action).ok).toBe(true);
  });

  it('plans through hidden enemy blockers and safely stops on first contact', () => {
    const board = createBoard(7, 1);
    board.terrain[0]![6] = { kind: 'capital', owner: 'blue' };
    const base = stateWith(createGameState(board), { units: [
      { id: 'tank', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ] });
    const concealed = stateWith(base, { units: [...base.units, { id: 'hidden', kind: 'infantry', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, hasMoved: false, hasActed: false }] });
    const action = chooseCpuAction(concealed);
    expect(action).toEqual(chooseCpuAction(base));
    const result = applyGameCommand(concealed, action);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.units.find(unit => unit.id === 'tank')).toMatchObject({ position: { x: 3, y: 0 } });
  });
});
