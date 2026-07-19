import { describe, expect, it } from 'vitest';
import { captureProperty, collectIncome, createBoard, createGameState, endTurn, forecastCombat, movementCosts, moveUnit, nextRandom, produceUnit, reachablePositions, terrainRules, unitStats, type GameState } from './index';

const stateWith = (state: GameState, patch: Partial<GameState>): GameState => ({ ...state, ...patch });

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
