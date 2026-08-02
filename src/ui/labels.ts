import type { PlayerId, TerrainKind, UnitKind } from '../game';

/**
 * Display names shared by the board, the panels, and the tile inspector. They
 * live here so a label is written once and every surface agrees on it.
 */
export const terrainNames: Record<TerrainKind, string> = {
  plain: '平原', forest: '森林', mountain: '山岳', road: '道路', sea: '海',
  city: '都市', factory: '工場', airport: '空港', port: '港湾', capital: '司令部',
};

export const unitNames: Record<UnitKind, string> = {
  infantry: '歩兵', tank: '戦車', artillery: '砲兵', fighter: '戦闘機', bomber: '爆撃機',
  destroyer: '駆逐艦', landingShip: '輸送艦', recon: '偵察車', rocket: '自走砲', antiAir: '対空車両',
};

export const unitTokens: Record<UnitKind, string> = {
  infantry: '歩', tank: '戦', artillery: '砲', fighter: '空', bomber: '爆',
  destroyer: '艦', landingShip: '輸', recon: '偵', rocket: '自', antiAir: '防',
};

/** Relative side label: the viewer's own force versus the opposing force. */
export const sideLabel = (owner: PlayerId, viewer: PlayerId): string => owner === viewer ? '自軍' : '敵軍';

/** Ownership label for a capturable property, which may still be unclaimed. */
export const ownerLabel = (owner: PlayerId | undefined, viewer: PlayerId): string =>
  owner === undefined ? '中立' : sideLabel(owner, viewer);
