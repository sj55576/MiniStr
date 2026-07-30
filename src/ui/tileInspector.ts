import { defenseStars, isDeployedUnit, isPropertyTerrainKind, movementCost, productionKindsByTerrain, terrainAt, unitStats, type GameState, type PlayerId, type Position, type UnitKind } from '../game';
import { ownerLabel, sideLabel, terrainNames, unitNames } from './labels';

export interface InspectorRow { label: string; value: string }
export interface TileInspection {
  position: Position;
  title: string;
  rows: InspectorRow[];
  /** Omitted when the tile holds no unit, or holds one the viewer cannot see. */
  unit?: { title: string; rows: InspectorRow[] };
  /** The viewer has no vision here, so unit details are withheld. */
  hidden: boolean;
}

const stars = (count: number): string => count === 0 ? 'なし' : '★'.repeat(count);
const range = (kind: UnitKind): string => {
  const [minimum, maximum] = unitStats[kind].range;
  return minimum === maximum ? `${minimum}` : `${minimum}〜${maximum}`;
};

/**
 * Everything a tile can tell the player, as data. Touch devices have no hover,
 * so this replaces the tooltip as the primary way to read the board — which is
 * also why it is the single source for both the panel and its accessible text.
 *
 * Terrain is public knowledge (the board already labels it under fog), but a
 * hidden tile's unit is withheld, and an enemy's fuel and ammunition are never
 * reported even when the unit itself is visible.
 */
export function inspectTile(
  state: GameState,
  position: Position,
  viewer: PlayerId,
  visible: ReadonlySet<string>,
  selectedUnitKind?: UnitKind,
): TileInspection | undefined {
  const terrain = terrainAt(state.board, position);
  if (!terrain) return undefined;
  const property = isPropertyTerrainKind(terrain.kind);
  const title = `${terrainNames[terrain.kind]}${property ? `（${ownerLabel(terrain.owner, viewer)}）` : ''}`;
  const rows: InspectorRow[] = [{ label: '防御', value: stars(defenseStars(terrain)) }];
  if (property && terrain.capturePoints !== undefined) rows.push({ label: '占領値', value: `${terrain.capturePoints}` });
  const producible = productionKindsByTerrain[terrain.kind];
  if (producible?.length) rows.push({ label: '生産', value: producible.map(kind => unitNames[kind]).join('・') });
  if (selectedUnitKind) {
    const cost = movementCost(state.board, position, selectedUnitKind);
    rows.push({ label: '移動コスト', value: Number.isFinite(cost) ? `${cost}` : '進入不可' });
  }
  const inspection: TileInspection = { position, title, rows, hidden: !visible.has(`${position.x},${position.y}`) };
  const unit = state.units.find(candidate => isDeployedUnit(candidate)
    && candidate.position.x === position.x && candidate.position.y === position.y);
  if (!unit || inspection.hidden) return inspection;
  const stats = unitStats[unit.kind];
  const unitRows: InspectorRow[] = [
    { label: '耐久', value: `${unit.hp} / 100` },
    { label: '攻撃', value: `${stats.attack}` },
    { label: '射程', value: range(unit.kind) },
    { label: '移動', value: `${stats.movement}` },
    { label: '視界', value: `${stats.vision}` },
  ];
  const cargo = state.units.find(candidate => candidate.embarkedIn === unit.id);
  if (cargo) unitRows.push({ label: '搭載', value: unitNames[cargo.kind] });
  if (unit.owner === viewer) {
    unitRows.push({ label: '燃料', value: stats.fuelPerTurn === 0 ? '消費なし' : `${unit.fuel ?? stats.fuel}（毎手番 -${stats.fuelPerTurn}）` });
    unitRows.push({ label: '弾薬', value: stats.ammo === 0 ? 'なし' : `${unit.ammo ?? stats.ammo}` });
    unitRows.push({ label: '状態', value: unit.hasActed ? '行動済み' : unit.hasMoved ? '移動済み' : '未行動' });
  }
  return { ...inspection, unit: { title: `${sideLabel(unit.owner, viewer)}の${unitNames[unit.kind]}`, rows: unitRows } };
}

/** Flat text of an inspection, used for the panel's accessible live region. */
export function describeTileInspection(inspection: TileInspection): string {
  const parts = [
    `(${inspection.position.x + 1}, ${inspection.position.y + 1}) ${inspection.title}`,
    ...inspection.rows.map(row => `${row.label} ${row.value}`),
  ];
  if (inspection.unit) parts.push(inspection.unit.title, ...inspection.unit.rows.map(row => `${row.label} ${row.value}`));
  else if (inspection.hidden) parts.push('未索敵');
  return parts.join('、');
}
