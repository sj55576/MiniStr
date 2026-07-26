export type PlayerId = 'red' | 'blue';
export type UnitKind = 'infantry' | 'tank' | 'artillery' | 'fighter' | 'bomber' | 'destroyer' | 'landingShip' | 'recon' | 'rocket';
export type TerrainKind = 'plain' | 'forest' | 'road' | 'mountain' | 'sea' | 'city' | 'factory' | 'port' | 'capital';

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
  /** Present only while this unit is deployed on the board. */
  position?: Position;
  /** ID of the landing ship carrying this unit. Embarked units have no position. */
  embarkedIn?: string;
  hp: number;
  fuel?: number;
  ammo?: number;
  hasMoved: boolean;
  hasActed: boolean;
}

export type DeployedUnit = Unit & { position: Position; embarkedIn?: undefined };

export function isDeployedUnit(unit: Unit): unit is DeployedUnit {
  return unit.position !== undefined && unit.embarkedIn === undefined;
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
  /** Completed full rounds, starting at 1 and advancing when blue hands play back to red. */
  turn: number;
  winner?: PlayerId;
  /** Optional for backwards-compatible save/replay loading. */
  scenarioId?: string;
  /** Scenario-defined score; absent values are treated as zero. */
  scores?: Partial<Record<PlayerId, number>>;
  /** Consecutive completed turns for each hold-condition key. */
  objectiveHoldTurns?: Partial<Record<PlayerId, Record<string, number>>>;
  /** State for the deterministic LCG consumed by commands that resolve random outcomes. */
  rngSeed: number;
  nextUnitId: number;
}

export type GameResult<T = GameState> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const otherPlayer = (player: PlayerId): PlayerId => player === 'red' ? 'blue' : 'red';

