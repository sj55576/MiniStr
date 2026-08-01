import { describe, expect, it } from 'vitest';
import { mergeUnits } from './commands';
import { applyGameCommand, isGameCommand, replayCommands, type GameCommand } from './session';
import { createBoard, createGameState } from './state';
import { isDeployedUnit, type GameState, type Unit, type UnitKind } from './types';
import { isMergeableUnit, unitStats } from './units';

const mergeableKinds: UnitKind[] = [
  'infantry', 'recon', 'tank', 'artillery', 'rocket', 'antiAir', 'fighter', 'bomber', 'destroyer',
];

function stateWithUnits(units: Unit[]): GameState {
  return { ...createGameState(createBoard(6, 4)), units };
}

function deployed(id: string, kind: UnitKind, position: { x: number; y: number }, overrides: Partial<Unit> = {}): Unit {
  const stats = unitStats[kind];
  return {
    id, kind, owner: 'red', position, hp: 100, fuel: stats.fuel, ammo: stats.ammo,
    hasMoved: false, hasActed: false, ...overrides,
  };
}

describe('mergeUnits', () => {
  it('uses the data registry for the initial merge-compatible unit set', () => {
    expect(mergeableKinds.every(isMergeableUnit)).toBe(true);
    expect(isMergeableUnit('landingShip')).toBe(false);
  });

  it('preserves the stronger unit and caps combined resources at its stats', () => {
    const state = stateWithUnits([
      deployed('strong', 'infantry', { x: 2, y: 1 }, { hp: 70, fuel: 70, ammo: 5 }),
      deployed('weak', 'infantry', { x: 3, y: 1 }, { hp: 50, fuel: 80, ammo: 8 }),
    ]);

    const result = mergeUnits(state, 'strong', 'weak');

    expect(result).toEqual({
      ok: true,
      value: {
        ...state,
        units: [expect.objectContaining({
          id: 'strong', position: { x: 2, y: 1 }, hp: 100, fuel: 99, ammo: 9,
          hasMoved: true, hasActed: true,
        })],
      },
    });
  });

  it('preserves the target ID when the target has more HP', () => {
    const state = stateWithUnits([
      deployed('weak', 'tank', { x: 2, y: 1 }, { hp: 35 }),
      deployed('strong', 'tank', { x: 3, y: 1 }, { hp: 65 }),
    ]);

    const result = mergeUnits(state, 'weak', 'strong');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.units).toHaveLength(1);
    expect(result.value.units[0]).toMatchObject({
      id: 'strong', position: { x: 3, y: 1 }, hp: 100, hasMoved: true, hasActed: true,
    });
  });

  it('rejects unsafe or ineligible merges with stable messages', () => {
    const cases: Array<[string, GameState, string, string]> = [
      ['missing unit', stateWithUnits([deployed('unit', 'infantry', { x: 1, y: 1 })]), 'missing', 'Unit not found'],
      ['embarked unit', stateWithUnits([
        { ...deployed('unit', 'infantry', { x: 1, y: 1 }), position: undefined, embarkedIn: 'ship' },
        deployed('target', 'infantry', { x: 2, y: 1 }),
      ]), 'unit', 'Embarked units cannot merge'],
      ['other player', stateWithUnits([
        { ...deployed('unit', 'infantry', { x: 1, y: 1 }), owner: 'blue' },
        deployed('target', 'infantry', { x: 2, y: 1 }),
      ]), 'unit', 'Unit belongs to the other player'],
      ['different owner', stateWithUnits([
        deployed('unit', 'infantry', { x: 1, y: 1 }),
        { ...deployed('target', 'infantry', { x: 2, y: 1 }), owner: 'blue' },
      ]), 'unit', 'Units must belong to the same player'],
      ['acted unit', stateWithUnits([
        deployed('unit', 'infantry', { x: 1, y: 1 }, { hasActed: true }),
        deployed('target', 'infantry', { x: 2, y: 1 }),
      ]), 'unit', 'Unit has already acted'],
      ['not adjacent', stateWithUnits([
        deployed('unit', 'infantry', { x: 1, y: 1 }),
        deployed('target', 'infantry', { x: 3, y: 1 }),
      ]), 'unit', 'Units must be adjacent'],
      ['different kind', stateWithUnits([
        deployed('unit', 'infantry', { x: 1, y: 1 }),
        deployed('target', 'recon', { x: 2, y: 1 }),
      ]), 'unit', 'Units must be the same kind'],
      ['incompatible kind', stateWithUnits([
        deployed('unit', 'landingShip', { x: 1, y: 1 }),
        deployed('target', 'landingShip', { x: 2, y: 1 }),
      ]), 'unit', 'This unit type cannot merge'],
    ];

    for (const [, state, unitId, expected] of cases) {
      const targetId = unitId === 'missing' ? 'target' : state.units.find(unit => unit.id !== unitId)!.id;
      const result = mergeUnits(state, unitId, targetId);
      expect(result).toEqual({ ok: false, error: expected });
    }
  });

  it('rejects merging a unit with itself', () => {
    const state = stateWithUnits([deployed('unit', 'infantry', { x: 1, y: 1 })]);
    expect(mergeUnits(state, 'unit', 'unit')).toEqual({ ok: false, error: 'A unit cannot merge with itself' });
  });
});

describe('merge GameCommand', () => {
  it('validates, applies, and replays a merge command', () => {
    const state = stateWithUnits([
      deployed('unit', 'recon', { x: 1, y: 1 }, { hp: 60 }),
      deployed('target', 'recon', { x: 2, y: 1 }, { hp: 40 }),
    ]);
    const command: GameCommand = { type: 'merge', unitId: 'unit', targetId: 'target' };

    expect(isGameCommand(command)).toBe(true);
    expect(isGameCommand({ type: 'merge', unitId: 'unit' })).toBe(false);
    const applied = applyGameCommand(state, command);
    expect(applied.ok).toBe(true);
    const replayed = replayCommands(state, [command]);
    expect(replayed).toEqual(applied);
    if (replayed.ok) expect(replayed.value.units.every(unit => !isDeployedUnit(unit) || unit.id === 'unit')).toBe(true);
  });
});
