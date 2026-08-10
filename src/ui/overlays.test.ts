import { describe, expect, it } from 'vitest';
import { renderBriefingOverlay, renderCampaignOverlay, renderGameOverOverlay, renderProductionCard, renderUnitActionCluster } from './overlays';

describe('overlay renderers', () => {
  it('escapes dynamic game-over and campaign content at the shared UI boundary', () => {
    const result = renderGameOverOverlay({
      visible: true,
      winner: 'red',
      mapName: '<map>',
      difficultyName: 'normal',
      campaignResult: '',
      campaignActions: '',
      summary: { winner: 'red', turns: 4, kills: { red: 2, blue: 1 }, captures: { red: 1, blue: 0 } },
    });
    const campaign = renderCampaignOverlay(true, 10, '<notice>', '<article>safe markup</article>');

    expect(result).toContain('&lt;map&gt;');
    expect(campaign).toContain('&lt;notice&gt;');
    expect(campaign).toContain('<article>safe markup</article>');
  });

  it('keeps briefing controls and compact game panels stable', () => {
    const briefing = renderBriefingOverlay({
      visible: true,
      mapName: 'Test',
      briefing: 'Briefing',
      victoryConditions: ['Win'],
      defeatConditions: ['Lose'],
      startingGold: 5000,
      difficultyName: '普通',
      campaignRun: false,
    });

    expect(briefing).toContain('id="begin-operation"');
    expect(renderUnitActionCluster(['<button id="wait">wait</button>'])).toContain('unit-action-cluster');
    expect(renderProductionCard('<p>target</p>', '<p>summary</p>', '<button>unit</button>')).toContain('production-grid');
  });
});
