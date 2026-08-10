import { scenarioById } from './maps';
import { isGameState, type StorageLike } from './session';
import type { GameResult, GameState, PlayerId } from './types';

export const CAMPAIGN_SCHEMA_VERSION = 3 as const;
export const CAMPAIGN_STORAGE_KEY = 'ministr.campaign.progress';
export const MAX_CAMPAIGN_BYTES = 64_000;
export type CampaignGrade = 'S' | 'A' | 'B' | 'C';

export interface CampaignStage { scenarioId: string; recommendedTurns: number }
export const campaignStages: readonly CampaignStage[] = [
  { scenarioId: 'skirmish', recommendedTurns: 14 },
  { scenarioId: 'islands', recommendedTurns: 18 },
  { scenarioId: 'canyon', recommendedTurns: 20 },
  { scenarioId: 'siege', recommendedTurns: 24 },
  { scenarioId: 'river', recommendedTurns: 22 },
  { scenarioId: 'tundra', recommendedTurns: 18 },
  // Append new stages so every v2 unlocked-prefix and grade remains valid.
  // Landing follows the existing river operation, where players first learn ports.
  { scenarioId: 'outpost', recommendedTurns: 14 },
  { scenarioId: 'landing', recommendedTurns: 18 },
  { scenarioId: 'industrial', recommendedTurns: 24 },
  // Appending preserves valid v3 saves from the original nine-stage campaign.
  { scenarioId: 'marsh', recommendedTurns: 20 },
];

export interface CampaignProgress {
  schemaVersion: typeof CAMPAIGN_SCHEMA_VERSION;
  unlockedScenarioIds: string[];
  bestGrades: Partial<Record<string, CampaignGrade>>;
  updatedAt: string;
}

function migrateCampaignV1ToV2(value: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(value), schemaVersion: 2 };
}

function migrateCampaignV2ToV3(value: Record<string, unknown>): Record<string, unknown> {
  // The three added stages are appended, so a v2 prefix remains a valid v3 prefix.
  return { ...structuredClone(value), schemaVersion: CAMPAIGN_SCHEMA_VERSION };
}

function migrateCampaign(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (value.schemaVersion === CAMPAIGN_SCHEMA_VERSION) return value;
  if (value.schemaVersion === 1) return migrateCampaignV2ToV3(migrateCampaignV1ToV2(value));
  if (value.schemaVersion === 2) return migrateCampaignV2ToV3(value);
  return undefined;
}
export interface CampaignGradeResult {
  grade: CampaignGrade;
  score: number;
  survivingUnits: number;
  averageSurvivingHp: number;
  losses: number;
  elapsedTurns: number;
}
export interface CampaignBattleMetrics {
  initialState: GameState;
  finalState: GameState;
  losses: number;
  recommendedTurns: number;
  player?: PlayerId;
}

const fail = <T>(error: string): GameResult<T> => ({ ok: false, error });
const ok = <T>(value: T): GameResult<T> => ({ ok: true, value });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const grades = new Set<CampaignGrade>(['S', 'A', 'B', 'C']);
const stageIds = campaignStages.map(stage => stage.scenarioId);
const stageIdSet = new Set(stageIds);
const gradeRank: Record<CampaignGrade, number> = { C: 0, B: 1, A: 2, S: 3 };
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function createCampaignProgress(updatedAt = new Date().toISOString()): CampaignProgress {
  return { schemaVersion: CAMPAIGN_SCHEMA_VERSION, unlockedScenarioIds: [stageIds[0]!], bestGrades: {}, updatedAt };
}
export const isCampaignScenarioUnlocked = (progress: CampaignProgress, scenarioId: string): boolean =>
  progress.unlockedScenarioIds.includes(scenarioId);
export const isCampaignScenarioCompleted = (progress: CampaignProgress, scenarioId: string): boolean =>
  progress.bestGrades[scenarioId] !== undefined;

export function gradeCampaignBattle(metrics: CampaignBattleMetrics): GameResult<CampaignGradeResult> {
  const player = metrics.player ?? 'red';
  if (!isGameState(metrics.initialState) || !isGameState(metrics.finalState)
    || metrics.finalState.turn < metrics.initialState.turn
    || metrics.initialState.scenarioId !== metrics.finalState.scenarioId)
    return fail('評価対象のゲーム状態が不正です。');
  if (metrics.finalState.winner !== player) return fail('勝利した対局だけ評価できます。');
  if (!Number.isSafeInteger(metrics.losses) || metrics.losses < 0
    || !Number.isSafeInteger(metrics.recommendedTurns) || metrics.recommendedTurns < 1)
    return fail('評価指標が不正です。');
  const survivors = metrics.finalState.units.filter(unit => unit.owner === player);
  const survivingUnits = survivors.length;
  const averageSurvivingHp = survivingUnits
    ? survivors.reduce((sum, unit) => sum + unit.hp, 0) / survivingUnits : 0;
  const deployed = survivingUnits + metrics.losses;
  const strengthRatio = clamp01(averageSurvivingHp / 100);
  const lossRatio = deployed ? clamp01(metrics.losses / deployed) : 1;
  const elapsedTurns = Math.max(1, metrics.finalState.turn - metrics.initialState.turn + 1);
  const speedRatio = clamp01(metrics.recommendedTurns / elapsedTurns);
  const score = Math.round(45 * strengthRatio + 35 * (1 - lossRatio) + 20 * speedRatio);
  const grade: CampaignGrade = score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : 'C';
  return ok({ grade, score, survivingUnits, averageSurvivingHp, losses: metrics.losses, elapsedTurns });
}

export function recordCampaignVictory(
  progress: CampaignProgress,
  scenarioId: string,
  grade: CampaignGrade,
  updatedAt = new Date().toISOString(),
): GameResult<CampaignProgress> {
  if (!isCampaignProgress(progress)) return fail('キャンペーンデータの内容が不正です。');
  const index = stageIds.indexOf(scenarioId);
  if (index < 0) return fail('キャンペーンに存在しないシナリオです。');
  if (!grades.has(grade)) return fail('評価が不正です。');
  if (!isCampaignScenarioUnlocked(progress, scenarioId)) return fail('未解放のシナリオです。');
  const previous = progress.bestGrades[scenarioId];
  const bestGrades = { ...progress.bestGrades };
  if (!previous || gradeRank[grade] > gradeRank[previous]) bestGrades[scenarioId] = grade;
  const unlocked = new Set(progress.unlockedScenarioIds);
  const next = stageIds[index + 1];
  if (next) unlocked.add(next);
  return ok({
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    unlockedScenarioIds: stageIds.filter(id => unlocked.has(id)),
    bestGrades,
    updatedAt,
  });
}

export function isCampaignProgress(value: unknown): value is CampaignProgress {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'unlockedScenarioIds', 'bestGrades', 'updatedAt'])
    || value.schemaVersion !== CAMPAIGN_SCHEMA_VERSION
    || !Array.isArray(value.unlockedScenarioIds) || !isRecord(value.bestGrades)
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || new Date(value.updatedAt).toISOString() !== value.updatedAt) return false;
  const unlocked = value.unlockedScenarioIds;
  if (unlocked.length < 1 || unlocked.length > stageIds.length
    || unlocked.some((id, index) => typeof id !== 'string' || id !== stageIds[index])) return false;
  const unlockedSet = new Set(unlocked as string[]);
  for (let index = 1; index < unlocked.length; index += 1) {
    if (!grades.has(value.bestGrades[stageIds[index - 1]!] as CampaignGrade)) return false;
  }
  for (const [id, grade] of Object.entries(value.bestGrades)) {
    if (!stageIdSet.has(id) || !grades.has(grade as CampaignGrade) || !unlockedSet.has(id)) return false;
  }
  return campaignStages.every(stage => scenarioById(stage.scenarioId) !== undefined);
}

export function parseCampaignProgress(serialized: string): GameResult<CampaignProgress> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_CAMPAIGN_BYTES) return fail('キャンペーンデータが大きすぎます。');
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return fail('キャンペーンデータが壊れています。'); }
  if (!isRecord(value)) return fail('キャンペーンデータの形式が不正です。');
  const migrated = migrateCampaign(value);
  if (!migrated) return fail('未対応のキャンペーンデータです。');
  return isCampaignProgress(migrated) ? ok(structuredClone(migrated)) : fail('キャンペーンデータの内容が不正です。');
}

export function loadCampaignProgress(storage: StorageLike): GameResult<CampaignProgress> {
  let raw: string | null;
  try { raw = storage.getItem(CAMPAIGN_STORAGE_KEY); } catch { return fail('キャンペーンデータを読み込めませんでした。'); }
  return raw === null ? ok(createCampaignProgress()) : parseCampaignProgress(raw);
}
export function saveCampaignProgress(storage: StorageLike, progress: CampaignProgress): GameResult<void> {
  if (!isCampaignProgress(progress)) return fail('キャンペーンデータの内容が不正です。');
  const serialized = JSON.stringify(progress);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CAMPAIGN_BYTES) return fail('キャンペーンデータが大きすぎます。');
  try { storage.setItem(CAMPAIGN_STORAGE_KEY, serialized); return ok(undefined); }
  catch { return fail('キャンペーンデータを書き込めませんでした。'); }
}
