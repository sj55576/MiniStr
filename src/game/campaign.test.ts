import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_SCHEMA_VERSION, CAMPAIGN_STORAGE_KEY, campaignStages, createBoard,
  createCampaignProgress, createGameState, gradeCampaignBattle, isCampaignProgress,
  isCampaignScenarioUnlocked, loadCampaignProgress, maps, parseCampaignProgress,
  recordCampaignVictory, saveCampaignProgress, type CampaignProgress, type GameState,
  type StorageLike,
} from './index';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const NOW = '2026-07-23T00:00:00.000Z';

function battle(turn: number, hp: number[], winner: 'red' | 'blue' = 'red') {
  const initialState = createGameState(createBoard(2, 2));
  initialState.units = [
    { id: 'r1', kind: 'infantry', owner: 'red', position: { x: 0, y: 0 }, hp: 100, hasMoved: false, hasActed: false },
    { id: 'r2', kind: 'tank', owner: 'red', position: { x: 0, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
  ];
  const finalState: GameState = {
    ...structuredClone(initialState), turn, winner,
    units: hp.map((unitHp, index) => ({
      id: `r${index + 1}`, kind: 'infantry' as const, owner: 'red' as const,
      position: { x: index, y: 0 }, hp: unitHp, hasMoved: false, hasActed: false,
    })),
  };
  return { initialState, finalState };
}

describe('campaign grading', () => {
  it('awards S for healthy survivors, no losses, and a fast victory', () => {
    expect(gradeCampaignBattle({ ...battle(10, [100, 80]), losses: 0, recommendedTurns: 14 }))
      .toEqual({ ok: true, value: {
        grade: 'S', score: 96, survivingUnits: 2, averageSurvivingHp: 90,
        losses: 0, elapsedTurns: 10,
      } });
  });

  it('awards C for heavy losses, low health, and a slow victory', () => {
    const result = gradeCampaignBattle({ ...battle(30, [20]), losses: 3, recommendedTurns: 10 });
    expect(result.ok && result.value.grade).toBe('C');
    expect(result.ok && result.value.score).toBe(24);
  });

  it('never improves when health falls, losses rise, or turns increase', () => {
    const score = (turn: number, hp: number[], losses: number) => {
      const result = gradeCampaignBattle({ ...battle(turn, hp), losses, recommendedTurns: 14 });
      if (!result.ok) throw new Error(result.error);
      return result.value.score;
    };
    expect(score(10, [60, 60], 0)).toBeLessThan(score(10, [100, 100], 0));
    expect(score(10, [100], 2)).toBeLessThan(score(10, [100], 0));
    expect(score(30, [100, 100], 0)).toBeLessThan(score(10, [100, 100], 0));
  });

  it('rejects defeats and invalid metrics', () => {
    expect(gradeCampaignBattle({ ...battle(2, [100], 'blue'), losses: 0, recommendedTurns: 10 }).ok).toBe(false);
    expect(gradeCampaignBattle({ ...battle(2, [100]), losses: -1, recommendedTurns: 10 }).ok).toBe(false);
    expect(gradeCampaignBattle({ ...battle(2, [100]), losses: 0, recommendedTurns: 0 }).ok).toBe(false);
    expect(gradeCampaignBattle({ ...battle(0, [100]), losses: 0, recommendedTurns: 10 }).ok).toBe(false);
  });
});

describe('campaign progression', () => {
  it('starts with only the first scenario unlocked while every map remains a skirmish option', () => {
    const progress = createCampaignProgress(NOW);
    expect(progress).toEqual({
      schemaVersion: CAMPAIGN_SCHEMA_VERSION,
      unlockedScenarioIds: ['skirmish'], bestGrades: {}, updatedAt: NOW,
    });
    expect(campaignStages.every(stage => maps.some(map => map.id === stage.scenarioId))).toBe(true);
    expect(isCampaignScenarioUnlocked(progress, 'canyon')).toBe(false);
  });

  it('records the best grade and unlocks only the next scenario', () => {
    const first = recordCampaignVictory(createCampaignProgress(NOW), 'skirmish', 'B', NOW);
    expect(first.ok && first.value).toMatchObject({
      unlockedScenarioIds: ['skirmish', 'islands'], bestGrades: { skirmish: 'B' },
    });
    if (!first.ok) return;
    const worse = recordCampaignVictory(first.value, 'skirmish', 'C', NOW);
    expect(worse.ok && worse.value.bestGrades.skirmish).toBe('B');
    const better = recordCampaignVictory(first.value, 'skirmish', 'S', NOW);
    expect(better.ok && better.value.bestGrades.skirmish).toBe('S');
  });

  it('unlocks all four scenarios strictly in order', () => {
    let progress = createCampaignProgress(NOW);
    for (const stage of campaignStages) {
      expect(isCampaignScenarioUnlocked(progress, stage.scenarioId)).toBe(true);
      const result = recordCampaignVictory(progress, stage.scenarioId, 'A', NOW);
      if (!result.ok) throw new Error(result.error);
      progress = result.value;
    }
    expect(progress.unlockedScenarioIds).toEqual(campaignStages.map(stage => stage.scenarioId));
  });

  it('rejects completion of locked, unknown, and invalid-grade scenarios without mutation', () => {
    const progress = createCampaignProgress(NOW);
    const before = structuredClone(progress);
    expect(recordCampaignVictory(progress, 'islands', 'A', NOW).ok).toBe(false);
    expect(recordCampaignVictory(progress, 'missing', 'A', NOW).ok).toBe(false);
    expect(recordCampaignVictory(progress, 'skirmish', 'X' as never, NOW).ok).toBe(false);
    expect(progress).toEqual(before);
  });
});

describe('campaign persistence validation', () => {
  it('round-trips valid progress and creates defaults when absent', () => {
    const storage = new MemoryStorage();
    expect(loadCampaignProgress(storage).ok).toBe(true);
    const progress = recordCampaignVictory(createCampaignProgress(NOW), 'skirmish', 'A', NOW);
    if (!progress.ok) throw new Error(progress.error);
    expect(saveCampaignProgress(storage, progress.value)).toEqual({ ok: true, value: undefined });
    expect(loadCampaignProgress(storage)).toEqual({ ok: true, value: progress.value });
    expect(storage.data.has(CAMPAIGN_STORAGE_KEY)).toBe(true);
  });

  it('migrates valid v1 campaign progress', () => {
    const legacy = { ...createCampaignProgress(NOW), schemaVersion: 1 };
    expect(parseCampaignProgress(JSON.stringify(legacy))).toEqual({ ok: true, value: createCampaignProgress(NOW) });
  });

  it('rejects malformed, unsupported, non-contiguous, reordered, and inconsistent progress', () => {
    expect(parseCampaignProgress('{broken').ok).toBe(false);
    expect(parseCampaignProgress(JSON.stringify({ schemaVersion: 999 })).ok).toBe(false);
    const gap: CampaignProgress = {
      schemaVersion: CAMPAIGN_SCHEMA_VERSION,
      unlockedScenarioIds: ['skirmish', 'canyon'], bestGrades: {}, updatedAt: NOW,
    };
    expect(isCampaignProgress(gap)).toBe(false);
    expect(isCampaignProgress({ ...gap, unlockedScenarioIds: ['islands', 'skirmish'] })).toBe(false);
    expect(isCampaignProgress({
      ...createCampaignProgress(NOW), unlockedScenarioIds: ['skirmish', 'islands'],
    })).toBe(false);
    expect(isCampaignProgress({
      ...createCampaignProgress(NOW), bestGrades: { islands: 'S' },
    })).toBe(false);
    expect(isCampaignProgress({ ...createCampaignProgress(NOW), unexpected: true })).toBe(false);
  });

  it('handles unavailable storage without throwing', () => {
    const unavailable: StorageLike = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadCampaignProgress(unavailable).ok).toBe(false);
    expect(saveCampaignProgress(unavailable, createCampaignProgress(NOW)).ok).toBe(false);
  });
});
