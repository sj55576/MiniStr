export type PlayerId = 'red' | 'blue';
export type UnitKind = 'infantry' | 'tank' | 'artillery' | 'fighter' | 'bomber' | 'destroyer' | 'recon' | 'rocket';
export type TerrainKind = 'plain' | 'forest' | 'road' | 'mountain' | 'sea' | 'city' | 'factory' | 'capital';

export interface Position { x: number; y: number }

export interface Terrain {
  kind: TerrainKind;
  owner?: PlayerId;
  capturePoints?: number;
}

export interface Unit {
  id: string;
  kind: UnitKind;
  owner: PlayerId;
  position: Position;
  hp: number;
  fuel?: number;
  ammo?: number;
  hasMoved: boolean;
  hasActed: boolean;
}

export interface Board {
  width: number;
  height: number;
  terrain: Terrain[][];
}

export interface PlayerState { gold: number; income: number }

export interface GameState {
  board: Board;
  units: Unit[];
  players: Record<PlayerId, PlayerState>;
  activePlayer: PlayerId;
  turn: number;
  winner?: PlayerId;
  /** State for the deterministic LCG; commands must return its next value. */
  rngSeed: number;
  nextUnitId: number;
}

export type GameResult<T = GameState> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const otherPlayer = (player: PlayerId): PlayerId => player === 'red' ? 'blue' : 'red';
