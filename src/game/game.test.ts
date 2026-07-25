import { describe, expect, it } from 'vitest';
import { applyGameCommand, attackUnit, captureProperty, collectIncome, createBoard, createGameState, createReplay, createScenarioCatalog, disembarkUnit, embarkUnit, endTurn, forecastCombat, isGameCommand, isGameState, loadScenarioDefinitions, maps, movementCosts, moveUnit, nextRandom, parseReplay, parseSavedGame, produceUnit, reachablePositions, replayCommands, saveGame, serializeReplay, terrainRules, unitAt, unitStats, type GameCommand, type GameState, type StorageLike } from './index';

const stateWith = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch });

const jsonScenario = () => ({
  id: 'json-test', name: 'JSONテスト', briefing: 'JSONから安全に読み込む。', startingGold: 0,
  board: { width: 2, height: 2, cells: [[0, 0, 'capital', 'red'], [1, 1, 'capital', 'blue']] },
  initialUnits: [{ kind: 'infantry', owner: 'red', x: 0, y: 1 }],
  victoryConditions: [{ type: 'hold', positions: [{ x: 1, y: 1 }], turns: 2 }],
  defeatConditions: [{ type: 'eliminate' }],
});

describe('JSON scenario definitions', () => {
  it('materializes JSON-compatible data without retaining or mutating its source', () => {
    const source = jsonScenario();
    const before = structuredClone(source);
    const result = loadScenarioDefinitions([source]);
    expect(result.ok).toBe(true);
    expect(source).toEqual(before);
    if (!result.ok) return;
    source.board.cells[0]![2] = 'sea';
    expect(result.value[0]!.board.terrain[0]![0]).toMatchObject({ kind: 'capital', owner: 'red', capturePoints: 20 });
    expect(result.value[0]!.victoryConditions).toEqual([{ type: 'hold', positions: [{ x: 1, y: 1 }], turns: 2 }]);
  });

  it.each([
    ['unknown terrain', (data: any) => { data.board.cells[0][2] = 'lava'; }],
    ['unknown unit', (data: any) => { data.initialUnits[0].kind = 'mech'; }],
    ['unknown owner', (data: any) => { data.board.cells[0][3] = 'green'; }],
    ['out-of-bounds unit', (data: any) => { data.initialUnits[0].x = 2; }],
    ['out-of-bounds hold target', (data: any) => { data.victoryConditions[0].positions[0].x = 2; }],
    ['nonpositive hold turns', (data: any) => { data.victoryConditions[0].turns = 0; }],
    ['negative starting gold', (data: any) => { data.startingGold = -1; }],
    ['duplicate id', (data: any) => { return [data, { ...structuredClone(data) }]; }],
    ['ragged board shape', (data: any) => { data.board = { width: 2, height: 2, terrain: [[{ kind: 'plain' }]] }; }],
    ['malformed victory condition', (data: any) => { data.victoryConditions = [{ type: 'score', target: 0 }]; }],
  ])('rejects %s without exposing it to the game', (_label, corrupt) => {
    const source = jsonScenario();
    const candidate = corrupt(source) ?? source;
    expect(loadScenarioDefinitions(Array.isArray(candidate) ? candidate : [candidate]).ok).toBe(false);
  });

  it('returns a clear error and unchanged fallback catalog for invalid source', () => {
    const invalid = jsonScenario();
    invalid.board.cells[0]![2] = 'unknown';
    const catalog = createScenarioCatalog([invalid], maps);
    expect(catalog.scenarios).toBe(maps);
    expect(catalog.error).toContain('地形セル');
  });
});

describe('Phase 2 game rules', () => {
  it('defines terrain movement and defense effects', () => {
    expect(terrainRules.forest.movement.tank).toBe(2);
    expect(terrainRules.mountain.movement.tank).toBe(Infinity);
    expect(terrainRules.city.defense).toBeGreaterThan(terrainRules.plain.defense);
  });

  it('moves an active unit onto an enterable adjacent tile without mutation', () => {
    const state = createGameState(createBoard(2, 1));
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }];
    const result = moveUnit(state, 'i', { x: 1, y: 0 });
    expect(result.ok && result.value.units[0]?.position).toEqual({ x: 1, y: 0 });
    expect(state.units[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('collects income from every owned property including a capital', () => {
    const board = createBoard(3, 1);
    board.terrain[0]![0] = { kind: 'city', owner: 'red' };
    board.terrain[0]![1] = { kind: 'factory', owner: 'red' };
    board.terrain[0]![2] = { kind: 'capital', owner: 'red' };
    expect(collectIncome(createGameState(board)).players.red).toEqual({ gold: 3000, income: 3000 });
  });

  it('produces a unit at an owned unoccupied factory', () => {
    const board = createBoard(1, 1, { kind: 'factory', owner: 'red' });
    const state = stateWith(createGameState(board), { players: { red: { gold: 1000, income: 0 }, blue: { gold: 0, income: 0 } } });
    const result = produceUnit(state, { x: 0, y: 0 }, 'infantry');
    expect(result.ok && result.value.players.red.gold).toBe(0);
    expect(result.ok && result.value.units[0]?.id).toBe('u1');
  });

  it('captures a capital over two infantry actions and ends the game', () => {
    const board = createBoard(1, 1, { kind: 'capital', owner: 'blue', capturePoints: 20 });
    const base = createGameState(board);
    const first = captureProperty(stateWith(base, { units: [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }] }), 'i');
    expect(first.ok && first.value.winner).toBeUndefined();
    const secondState = first.ok ? stateWith(first.value, { units: [{ ...first.value.units[0]!, hasActed: false }] }) : base;
    const second = captureProperty(secondState, 'i');
    expect(second.ok && second.value.winner).toBe('red');
  });

  it('forecasts combat with terrain mitigation and no artillery counterattack at range one', () => {
    const board = createBoard(2, 1);
    board.terrain[0]![1] = { kind: 'forest' };
    const state = createGameState(board);
    const result = forecastCombat(state,
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'artillery', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false });
    expect(result.ok && result.value).toMatchObject({ defenderDamage: 74, counterDamage: 0, canCounter: false });
  });

  it('uses deterministic random state', () => {
    expect(nextRandom(42)).toEqual(nextRandom(42));
  });
});

describe('Resupply on end turn', () => {
  it('heals and resupplies a damaged unit on its own capital when it becomes active again', () => {
    const board = createBoard(1, 1, { kind: 'capital', owner: 'red' });
    const state = createGameState(board);
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 60, fuel: 10, ammo: 2, hasMoved: true, hasActed: true }];
    const afterBlueTurn = endTurn(state);
    const afterRedTurn = endTurn(afterBlueTurn);
    const unit = afterRedTurn.units[0]!;
    expect(unit.hp).toBe(80);
    expect(unit.fuel).toBe(unitStats.infantry.fuel);
    expect(unit.ammo).toBe(unitStats.infantry.ammo);
  });

  it('does not resupply or heal a unit on an enemy-owned property', () => {
    const board = createBoard(1, 1, { kind: 'city', owner: 'blue' });
    const state = createGameState(board);
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 60, fuel: 10, ammo: 2, hasMoved: true, hasActed: true }];
    const afterBlueTurn = endTurn(state);
    const afterRedTurn = endTurn(afterBlueTurn);
    const unit = afterRedTurn.units[0]!;
    expect(unit.hp).toBe(60);
    expect(unit.fuel).toBe(10);
    expect(unit.ammo).toBe(2);
  });

  it('does not resupply or heal a unit on a neutral property', () => {
    const board = createBoard(1, 1, { kind: 'city' });
    const state = createGameState(board);
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 60, fuel: 10, ammo: 2, hasMoved: true, hasActed: true }];
    const afterBlueTurn = endTurn(state);
    const afterRedTurn = endTurn(afterBlueTurn);
    const unit = afterRedTurn.units[0]!;
    expect(unit.hp).toBe(60);
    expect(unit.fuel).toBe(10);
    expect(unit.ammo).toBe(2);
  });

  it('caps healing at 100 hp rather than overshooting', () => {
    const board = createBoard(1, 1, { kind: 'factory', owner: 'red' });
    const state = createGameState(board);
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 90, hasMoved: true, hasActed: true }];
    const afterBlueTurn = endTurn(state);
    const afterRedTurn = endTurn(afterBlueTurn);
    expect(afterRedTurn.units[0]?.hp).toBe(100);
  });

  it('does not heal a unit that is not standing on any property', () => {
    const board = createBoard(1, 1, { kind: 'plain' });
    const state = createGameState(board);
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 60, fuel: 10, ammo: 2, hasMoved: true, hasActed: true }];
    const afterBlueTurn = endTurn(state);
    const afterRedTurn = endTurn(afterBlueTurn);
    const unit = afterRedTurn.units[0]!;
    expect(unit.hp).toBe(60);
    expect(unit.fuel).toBe(10);
    expect(unit.ammo).toBe(2);
  });
});

describe('Weighted movement, fuel, and capture recovery', () => {
  it('charges the terrain-weighted path cost, treating forest as two movement points', () => {
    const board = createBoard(3, 1);
    board.terrain[0]![1] = { kind: 'forest' };
    const state = createGameState(board);
    state.units = [{ id: 't', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, fuel: 70, ammo: 6, hasMoved: false, hasActed: false }];
    const costs = movementCosts(state, 't');
    expect(costs.get('1,0')).toBe(2); // forest
    expect(costs.get('2,0')).toBe(3); // plain beyond the forest
  });

  it('deducts the full path cost from fuel rather than a flat one per move', () => {
    const board = createBoard(3, 1);
    board.terrain[0]![1] = { kind: 'forest' };
    const state = createGameState(board);
    state.units = [{ id: 't', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, fuel: 70, ammo: 6, hasMoved: false, hasActed: false }];
    const result = moveUnit(state, 't', { x: 2, y: 0 });
    expect(result.ok && result.value.units[0]?.fuel).toBe(67); // 70 - (forest 2 + plain 1)
  });

  it('caps reachable range at remaining fuel, not just the movement stat', () => {
    const board = createBoard(6, 1);
    const state = createGameState(board);
    state.units = [{ id: 't', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, fuel: 2, ammo: 6, hasMoved: false, hasActed: false }];
    const reachable = reachablePositions(state, 't').map(p => `${p.x},${p.y}`);
    expect(reachable).toContain('2,0');
    expect(reachable).not.toContain('3,0'); // movement 5 would allow it, but only 2 fuel remains
  });

  it('restores a partially captured property to full when the unit walks away', () => {
    const board = createBoard(2, 1);
    board.terrain[0]![0] = { kind: 'city', owner: 'blue', capturePoints: 20 };
    const state = createGameState(board);
    state.units = [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, fuel: 99, ammo: 9, hasMoved: false, hasActed: false }];
    const captured = captureProperty(state, 'i');
    expect(captured.ok && captured.value.board.terrain[0]![0]!.capturePoints).toBe(10);
    const readied = captured.ok ? stateWith(captured.value, { units: [{ ...captured.value.units[0]!, hasMoved: false }] }) : state;
    const moved = moveUnit(readied, 'i', { x: 1, y: 0 });
    expect(moved.ok && moved.value.board.terrain[0]![0]!.capturePoints).toBe(20);
    expect(moved.ok && moved.value.board.terrain[0]![0]!.owner).toBe('blue');
  });
});


describe('Fog of war and combat ammunition', () => {
  it('rejects an attack against an enemy outside the attacker owner\'s vision', () => {
    const state = createGameState(createBoard(5, 1));
    state.units = [
      { id: 'a', kind: 'rocket', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 5, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 4, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ];
    const result = attackUnit(state, 'a', 'd');
    expect(result).toEqual({ ok: false, error: 'Target is not visible' });
  });

  it('allows an attack against an enemy inside the attacker owner\'s vision', () => {
    const state = createGameState(createBoard(4, 1));
    state.units = [
      { id: 'a', kind: 'rocket', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 5, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 3, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
    ];
    const result = attackUnit(state, 'a', 'd');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.units.find(unit => unit.id === 'a')?.ammo).toBe(4);
  });

  it('consumes one defender ammunition when a counterattack occurs', () => {
    const state = createGameState(createBoard(2, 1));
    state.units = [
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, ammo: 1, hasMoved: false, hasActed: false },
    ];
    const result = attackUnit(state, 'a', 'd');
    expect(result.ok && result.value.units.find(unit => unit.id === 'd')?.ammo).toBe(0);
    expect(result.ok && result.value.units.find(unit => unit.id === 'a')?.hp).toBeLessThan(100);
  });

  it('leaves attacker health and zero defender ammunition unchanged when no counterattack is possible', () => {
    const state = createGameState(createBoard(2, 1));
    state.units = [
      { id: 'a', kind: 'tank', owner: 'red', position: { x: 0, y: 0 }, hp: 100, ammo: 6, hasMoved: false, hasActed: false },
      { id: 'd', kind: 'tank', owner: 'blue', position: { x: 1, y: 0 }, hp: 100, ammo: 0, hasMoved: false, hasActed: false },
    ];
    const result = attackUnit(state, 'a', 'd');
    expect(result.ok && result.value.units.find(unit => unit.id === 'a')?.hp).toBe(100);
    expect(result.ok && result.value.units.find(unit => unit.id === 'd')?.ammo).toBe(0);
  });
});


describe('Phase 6.1 ports and naval production', () => {
  it('allows infantry and destroyers to enter a port', () => {
    expect(terrainRules.port.movement.infantry).toBe(1);
    expect(terrainRules.port.movement.destroyer).toBe(1);
    expect(terrainRules.port.defense).toBe(3);
  });

  it('lets infantry capture a port, which then contributes income', () => {
    const board = createBoard(1, 1, { kind: 'port', owner: 'blue', capturePoints: 20 });
    const base = createGameState(board);
    const first = captureProperty(stateWith(base, { units: [{ id: 'i', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }] }), 'i');
    expect(first.ok && first.value.board.terrain[0]?.[0]?.capturePoints).toBe(10);
    const secondState = first.ok ? stateWith(first.value, { units: [{ ...first.value.units[0]!, hasActed: false }] }) : base;
    const second = captureProperty(secondState, 'i');
    expect(second.ok && second.value.board.terrain[0]?.[0]?.owner).toBe('red');
    expect(second.ok && collectIncome(second.value).players.red.income).toBe(1000);
  });

  it('resupplies a unit on an owned port', () => {
    const state = createGameState(createBoard(1, 1, { kind: 'port', owner: 'red' }));
    state.units = [{ id: 'd', kind: 'destroyer', owner: 'red', position: { x: 0, y: 0 }, hp: 60, fuel: 10, ammo: 2, hasMoved: true, hasActed: true }];
    const afterRedTurn = endTurn(endTurn(state));
    expect(afterRedTurn.units[0]).toMatchObject({ hp: 80, fuel: unitStats.destroyer.fuel, ammo: unitStats.destroyer.ammo });
  });

  it('restricts destroyer production to owned ports without regressing factory production', () => {
    const factoryState = stateWith(createGameState(createBoard(1, 1, { kind: 'factory', owner: 'red' })), { players: { red: { gold: 20_000, income: 0 }, blue: { gold: 0, income: 0 } } });
    expect(produceUnit(factoryState, { x: 0, y: 0 }, 'destroyer')).toEqual({ ok: false, error: 'An owned compatible production facility is required' });
    expect(produceUnit(factoryState, { x: 0, y: 0 }, 'infantry').ok).toBe(true);

    const portState = stateWith(createGameState(createBoard(1, 1, { kind: 'port', owner: 'red' })), { players: { red: { gold: 20_000, income: 0 }, blue: { gold: 0, income: 0 } } });
    expect(produceUnit(portState, { x: 0, y: 0 }, 'destroyer').ok).toBe(true);
    expect(produceUnit(portState, { x: 0, y: 0 }, 'infantry')).toEqual({ ok: false, error: 'An owned compatible production facility is required' });
  });

  it('accepts port terrain in serialized game state validation', () => {
    expect(isGameState(createGameState(createBoard(1, 1, { kind: 'port', owner: 'red' })))).toBe(true);
  });
});

describe('Phase 6.2 landing ships and embarked infantry', () => {
  const transportState = (): GameState => {
    const board = createBoard(4, 1, { kind: 'sea' });
    board.terrain[0]![0] = { kind: 'plain' };
    board.terrain[0]![3] = { kind: 'plain' };
    const state = createGameState(board);
    state.units = [
      { id: 'infantry', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'ship', kind: 'landingShip', owner: 'red', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    return state;
  };

  it('embarks moved infantry without allowing a same-turn crossing, then lands it on a later turn', () => {
    const state = transportState();
    state.units[0]!.hasMoved = true; // Infantry may move onto a coast before embarking.
    const boarded = embarkUnit(state, 'infantry', 'ship');
    expect(boarded.ok).toBe(true);
    if (!boarded.ok) return;
    const cargo = boarded.value.units.find(unit => unit.id === 'infantry')!;
    expect(cargo).toMatchObject({ embarkedIn: 'ship', hasMoved: true, hasActed: true });
    expect(cargo.position).toBeUndefined();
    expect(unitAt(boarded.value, { x: 0, y: 0 })).toBeUndefined();
    expect(reachablePositions(boarded.value, 'infantry')).toEqual([]);

    const readyToSail = endTurn(endTurn(boarded.value));
    const sailed = moveUnit(readyToSail, 'ship', { x: 2, y: 0 });
    expect(sailed.ok).toBe(true);
    if (!sailed.ok) return;
    expect(disembarkUnit(sailed.value, 'ship', { x: 3, y: 0 })).toEqual({ ok: false, error: 'Transport has already acted' });

    const readyToLand = endTurn(endTurn(sailed.value));
    const landed = disembarkUnit(readyToLand, 'ship', { x: 3, y: 0 });
    expect(landed.ok && landed.value.units.find(unit => unit.id === 'infantry')).toMatchObject({ position: { x: 3, y: 0 }, hasMoved: true, hasActed: true });
    expect(landed.ok && landed.value.units.find(unit => unit.id === 'ship')).toMatchObject({ hasMoved: true, hasActed: true });
  });

  it('records serializable embark and disembark commands deterministically', () => {
    const initial = transportState();
    const commands = [
      { type: 'embark' as const, unitId: 'infantry', transportId: 'ship' },
      { type: 'endTurn' as const }, { type: 'endTurn' as const },
      { type: 'move' as const, unitId: 'ship', destination: { x: 2, y: 0 } },
      { type: 'endTurn' as const }, { type: 'endTurn' as const },
      { type: 'disembark' as const, transportId: 'ship', destination: { x: 3, y: 0 } },
    ];
    expect(commands.every(isGameCommand)).toBe(true);
    const replayed = replayCommands(initial, commands);
    const direct = commands.reduce((state, command) => state.ok ? applyGameCommand(state.value, command) : state, { ok: true, value: initial } as ReturnType<typeof applyGameCommand>);
    expect(replayed).toEqual(direct);
    expect(replayed.ok && replayed.value.units.find(unit => unit.id === 'infantry')?.position).toEqual({ x: 3, y: 0 });
  });

  it('rejects malformed cargo state, including duplicate, enemy, or missing transports', () => {
    const valid = transportState();
    valid.units[0] = { ...valid.units[0]!, position: undefined, embarkedIn: 'ship' };
    expect(isGameState(valid)).toBe(true);

    const missing = structuredClone(valid);
    missing.units[0]!.embarkedIn = 'missing';
    expect(isGameState(missing)).toBe(false);

    const duplicate = structuredClone(valid);
    duplicate.units.push({ id: 'infantry-2', kind: 'infantry', owner: 'red', embarkedIn: 'ship', hp: 100, hasMoved: false, hasActed: false });
    expect(isGameState(duplicate)).toBe(false);

    const enemy = structuredClone(valid);
    enemy.units[0]!.owner = 'blue';
    expect(isGameState(enemy)).toBe(false);
  });

  it('rejects non-adjacent boarding and landing onto sea', () => {
    const distant = transportState();
    distant.units[1] = { ...distant.units[1]!, position: { x: 2, y: 0 } };
    expect(embarkUnit(distant, 'infantry', 'ship')).toEqual({ ok: false, error: 'Infantry must embark from an adjacent coast' });

    const cargoAtSea = transportState();
    cargoAtSea.units[0] = { ...cargoAtSea.units[0]!, position: undefined, embarkedIn: 'ship' };
    expect(disembarkUnit(cargoAtSea, 'ship', { x: 2, y: 0 })).toEqual({ ok: false, error: 'Destination must be an adjacent vacant land tile' });
  });

  it('removes embarked cargo when its landing ship is destroyed', () => {
    const state = createGameState(createBoard(2, 1, { kind: 'sea' }));
    state.units = [
      { id: 'bomber', kind: 'bomber', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'ship', kind: 'landingShip', owner: 'blue', position: { x: 1, y: 0 }, hp: 1, hasMoved: false, hasActed: false },
      { id: 'cargo', kind: 'infantry', owner: 'blue', embarkedIn: 'ship', hp: 100, hasMoved: false, hasActed: false },
    ];
    const result = attackUnit(state, 'bomber', 'ship');
    expect(result.ok && result.value.units.map(unit => unit.id)).toEqual(['bomber']);
  });

  it('produces landing ships only at ports', () => {
    const port = stateWith(createGameState(createBoard(1, 1, { kind: 'port', owner: 'red' })), { players: { red: { gold: 10_000, income: 0 }, blue: { gold: 0, income: 0 } } });
    expect(produceUnit(port, { x: 0, y: 0 }, 'landingShip').ok).toBe(true);
    const factory = stateWith(createGameState(createBoard(1, 1, { kind: 'factory', owner: 'red' })), { players: { red: { gold: 10_000, income: 0 }, blue: { gold: 0, income: 0 } } });
    expect(produceUnit(factory, { x: 0, y: 0 }, 'landingShip')).toEqual({ ok: false, error: 'An owned compatible production facility is required' });
  });
});

describe('Phase 6.4 transport save and replay compatibility', () => {
  const transportVictory = (): { initialState: GameState; commands: GameCommand[] } => {
    const board = createBoard(4, 1, { kind: 'sea' });
    board.terrain[0]![0] = { kind: 'plain' };
    board.terrain[0]![3] = { kind: 'capital', owner: 'blue', capturePoints: 10 };
    const initialState = createGameState(board);
    initialState.units = [
      { id: 'infantry', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
      { id: 'ship', kind: 'landingShip', owner: 'red', position: { x: 1, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    ];
    return {
      initialState,
      commands: [
        { type: 'embark', unitId: 'infantry', transportId: 'ship' },
        { type: 'endTurn' }, { type: 'endTurn' },
        { type: 'move', unitId: 'ship', destination: { x: 2, y: 0 } },
        { type: 'endTurn' }, { type: 'endTurn' },
        { type: 'disembark', transportId: 'ship', destination: { x: 3, y: 0 } },
        { type: 'endTurn' }, { type: 'endTurn' },
        { type: 'capture', unitId: 'infantry' },
      ],
    };
  };

  const storage = (): StorageLike & { value?: string } => {
    const memory: StorageLike & { value?: string } = {
      getItem: () => memory.value ?? null,
      setItem(_key, value) { memory.value = value; },
      removeItem: () => { memory.value = undefined; },
    };
    return memory;
  };

  it('round-trips deterministic embark and disembark history through saves and replays', () => {
    const { initialState, commands } = transportVictory();
    const replayed = replayCommands(initialState, commands);
    expect(replayed.ok && replayed.value.winner).toBe('red');
    if (!replayed.ok) return;

    const memory = storage();
    const saved = saveGame(memory, 'transport', {
      mapId: 'skirmish', difficulty: 'normal', initialState, commands, gameState: replayed.value,
    });
    expect(saved.ok).toBe(true);
    const loaded = parseSavedGame(memory.value!);
    expect(loaded).toEqual(saved);

    const created = createReplay({ mapId: 'skirmish', difficulty: 'normal', initialState, commands });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const serialized = serializeReplay(created.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const imported = parseReplay(serialized.value);
    expect(imported).toEqual(created);
    expect(imported.ok && serializeReplay(imported.value)).toEqual(serialized);
  });

  it('keeps pre-transport v1 saves valid but safely rejects broken cargo links', () => {
    const legacy = createGameState(createBoard(1, 1));
    legacy.units = [{ id: 'legacy-infantry', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false }];
    const legacySaved = {
      schemaVersion: 1, mapId: 'skirmish', difficulty: 'easy', initialState: legacy,
      commands: [], gameState: legacy, savedAt: '2026-07-25T00:00:00.000Z',
    };
    expect(parseSavedGame(JSON.stringify(legacySaved)).ok).toBe(true);

    const { initialState, commands } = transportVictory();
    const replayed = replayCommands(initialState, commands);
    if (!replayed.ok) return;
    const malformedSave = {
      ...legacySaved, initialState, commands,
      gameState: { ...replayed.value, units: replayed.value.units.map(unit => unit.id === 'infantry'
        ? { ...unit, position: undefined, embarkedIn: 'missing-ship' }
        : unit) },
    };
    expect(() => parseSavedGame(JSON.stringify(malformedSave))).not.toThrow();
    expect(parseSavedGame(JSON.stringify(malformedSave))).toEqual({ ok: false, error: 'セーブデータの内容が不正です。' });
    const memory = storage();
    expect(saveGame(memory, 'malformed', {
      mapId: 'skirmish', difficulty: 'normal', initialState, commands, gameState: malformedSave.gameState,
    })).toEqual({ ok: false, error: 'セーブデータの内容が不正です。' });
    expect(memory.value).toBeUndefined();
  });
});
