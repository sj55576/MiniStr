export type Player = "blue" | "red";

export interface Coordinate {
  x: number;
  y: number;
}

export interface UnitView {
  id: string;
  owner: Player;
  type: string;
  position: Coordinate;
  hp: number;
  maxHp?: number;
  moved?: boolean;
  attacked?: boolean;
}

export interface GameView {
  width: number;
  height: number;
  currentPlayer: Player;
  winner?: Player | null;
  units: UnitView[];
}

export const samePosition = (a: Coordinate, b: Coordinate): boolean => a.x === b.x && a.y === b.y;

export const positionKey = ({ x, y }: Coordinate): string => `${x},${y}`;
