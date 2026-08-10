import { escapeHtml, uiText } from './strings';

export interface ResultSummaryView {
  winner: 'red' | 'blue';
  turns: number;
  kills: Record<'red' | 'blue', number>;
  captures: Record<'red' | 'blue', number>;
}

/** Pure markup renderers keep modal structure out of the game-state coordinator. */
export function renderGameOverOverlay(options: {
  visible: boolean;
  winner?: 'red' | 'blue';
  summary?: ResultSummaryView;
  summaryError?: string;
  mapName: string;
  difficultyName: string;
  campaignResult: string;
  campaignActions: string;
}): string {
  if (!options.visible || !options.winner) return '';
  const summary = options.summary
    ? `<dl class="result-summary"><div><dt>${uiText.resultMap}</dt><dd>${escapeHtml(options.mapName)}</dd></div><div><dt>${uiText.resultDifficulty}</dt><dd>${escapeHtml(options.difficultyName)}</dd></div><div><dt>${uiText.resultWinner}</dt><dd>${options.summary.winner === 'red' ? uiText.player : uiText.cpu}</dd></div><div><dt>${uiText.resultTurns}</dt><dd>${options.summary.turns}</dd></div><div><dt>${uiText.player}</dt><dd>${uiText.resultScore(options.summary.kills.red, options.summary.captures.red)}</dd></div><div><dt>${uiText.cpu}</dt><dd>${uiText.resultScore(options.summary.kills.blue, options.summary.captures.blue)}</dd></div></dl>`
    : `<p class="result-error">${escapeHtml(options.summaryError ?? uiText.resultUnavailable)}</p>`;
  return `<div class="game-over" role="dialog" aria-modal="true" aria-labelledby="result-title"><div class="game-over-card"><p class="card-kicker">RESULT</p><h2 id="result-title" tabindex="-1">${options.winner === 'red' ? uiText.playerVictory : uiText.cpuVictory}</h2>${summary}${options.campaignResult}<div class="result-actions"><button id="view-replay" class="save-action">${uiText.viewReplay}</button><button id="export-replay" class="save-action">${uiText.exportReplay}</button>${options.campaignActions}</div></div></div>`;
}

export function renderCampaignOverlay(open: boolean, stageCount: number, notice: string, cards: string): string {
  if (!open) return '';
  return `<div class="campaign-overlay" role="dialog" aria-modal="true" aria-labelledby="campaign-title"><section class="campaign-screen"><div class="campaign-heading"><div><p class="card-kicker">MINI CAMPAIGN</p><h2 id="campaign-title">${uiText.campaignTitle}</h2><p>${uiText.campaignDescription(stageCount)}</p></div><div class="campaign-heading-actions"><button id="campaign-skirmish" class="save-action">${uiText.campaignSkirmish}</button><button id="campaign-close" class="save-action">${uiText.close}</button></div></div>${notice ? `<p class="campaign-notice" aria-live="polite">${escapeHtml(notice)}</p>` : ''}<div class="campaign-grid">${cards}</div></section></div>`;
}

export function renderBriefingOverlay(options: {
  visible: boolean;
  mapName: string;
  briefing: string;
  victoryConditions: readonly string[];
  defeatConditions: readonly string[];
  startingGold: number;
  turnLimit?: number;
  difficultyName: string;
  campaignRun: boolean;
}): string {
  if (!options.visible) return '';
  const list = (conditions: readonly string[]) => conditions.map((condition) => `<li>${escapeHtml(condition)}</li>`).join('');
  return `<div class="briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title" aria-describedby="briefing-copy"><section class="briefing-card"><p class="card-kicker">OPERATION BRIEFING</p><h2 id="briefing-title">${escapeHtml(options.mapName)}</h2><p id="briefing-copy" class="briefing-copy">${escapeHtml(options.briefing)}</p><div class="briefing-objectives"><section><h3>${uiText.victoryConditions}</h3><ul>${list(options.victoryConditions)}</ul></section><section><h3>${uiText.defeatConditions}</h3><ul>${list(options.defeatConditions)}</ul></section></div><div class="briefing-meta"><span>${uiText.startingGold} <strong>${options.startingGold}G</strong></span><span>${uiText.turnLimit} <strong>${options.turnLimit ?? uiText.none}</strong></span><span>${uiText.difficulty} <strong>${escapeHtml(options.difficultyName)}</strong></span></div><div class="briefing-actions"><button id="open-campaign-briefing" class="save-action">${uiText.campaign}</button><button id="begin-operation" class="end-turn">${options.campaignRun ? uiText.beginCampaignOperation : uiText.beginSkirmish} <span aria-hidden="true">→</span></button></div></section></div>`;
}

export function renderUnitActionCluster(actions: readonly string[]): string {
  const content = actions.filter(Boolean).join('');
  return content ? `<section class="unit-action-cluster" aria-label="${uiText.selectedUnitActions}">${content}</section>` : '';
}

export function renderProductionCard(target: string, summary: string, units: string): string {
  return `<section class="production-card"><div><p class="card-kicker">PRODUCTION</p><h2>${uiText.unitProduction}</h2></div>${target}${summary}<div class="production-grid">${units}</div></section>`;
}
