import { describe, expect, it } from "vitest";
import {
  attackUnit,
  createGameState,
  endTurn,
  GameRuleError,
  getReachablePositions,
  moveUnit,
  Player,
  Unit,
  UnitType,
} from "./game";

const makeUnit = (id: string, player: Player, type: UnitType, x: number, y: number, hp = 10): Unit =>
  ({ id, player, type, position: { x, y }, hp, hasMoved: false, hasAttacked: false });

describe("movement", () => {
  it("uses Manhattan distance, excludes occupied squares, and leaves its input unchanged", () => {
    const state = createGameState({ boardSize: 5, units: [
      makeUnit("blue", Player.Blue, UnitType.Infantry, 2, 2),
      makeUnit("ally", Player.Blue, UnitType.Tank, 3, 2),
      makeUnit("enemy", Player.Red, UnitType.Tank, 2, 4),
    ] });
    expect(getReachablePositions(state, "blue")).toEqual(expect.arrayContaining([
      { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 4, y: 2 },
    ]));
    expect(getReachablePositions(state, "blue")).not.toEqual(expect.arrayContaining([{ x: 3, y: 2 }, { x: 2, y: 4 }]));

    const moved = moveUnit(state, "blue", { x: 2, y: 3 });
    expect(state.units[0].position).toEqual({ x: 2, y: 2 });
    expect(moved.units.find((u) => u.id === "blue")).toMatchObject({ position: { x: 2, y: 3 }, hasMoved: true });
    expect(() => moveUnit(moved, "blue", { x: 1, y: 1 })).toThrow(GameRuleError);

    const attacked = attackUnit(moved, "blue", "enemy");
    expect(attacked.units.find((u) => u.id === "blue")?.hasAttacked).toBe(true);
  });
});

describe("combat", () => {
  it("applies deterministic damage and reciprocal close-range damage", () => {
    const state = createGameState({ units: [
      makeUnit("blue", Player.Blue, UnitType.Tank, 2, 2),
      makeUnit("red", Player.Red, UnitType.Infantry, 3, 2),
    ] });
    const next = attackUnit(state, "blue", "red");
    expect(next.units.find((u) => u.id === "red")?.hp).toBe(6);
    expect(next.units.find((u) => u.id === "blue")?.hp).toBe(7);
    expect(state.units.find((u) => u.id === "red")?.hp).toBe(10);
  });

  it("does not counterattack a distant artillery strike and declares elimination victory", () => {
    const state = createGameState({ units: [
      makeUnit("blue", Player.Blue, UnitType.Artillery, 2, 2),
      makeUnit("red", Player.Red, UnitType.Infantry, 5, 2, 5),
    ] });
    const next = attackUnit(state, "blue", "red");
    expect(next.units.find((u) => u.id === "blue")?.hp).toBe(10);
    expect(next.units.find((u) => u.id === "red")).toBeUndefined();
    expect(next.winner).toBe(Player.Blue);
  });
});

describe("turns", () => {
  it("switches active player and refreshes only that player's units", () => {
    const state = createGameState({ units: [
      { ...makeUnit("blue", Player.Blue, UnitType.Infantry, 1, 1), hasMoved: true, hasAttacked: true },
      { ...makeUnit("red", Player.Red, UnitType.Infantry, 6, 6), hasMoved: true, hasAttacked: true },
    ] });
    const next = endTurn(state);
    expect(next).toMatchObject({ activePlayer: Player.Red, turn: 2 });
    expect(next.units.find((u) => u.id === "red")).toMatchObject({ hasMoved: false, hasAttacked: false });
    expect(next.units.find((u) => u.id === "blue")).toMatchObject({ hasMoved: true, hasAttacked: true });
  });
});
