import { describe, expect, it } from 'vitest';
import { renderSaveSlotManager } from './saveSlots';
import { escapeHtml } from './strings';

describe('save slot UI', () => {
  it('renders slot metadata as text rather than executable markup', () => {
    document.body.innerHTML = renderSaveSlotManager(
      [
        {
          id: 'safe-slot',
          name: '<img src=x onerror=alert(1)>',
          mapId: 'skirmish',
          difficulty: 'normal',
          turn: 4,
          savedAt: '2026-08-04T00:00:00.000Z',
          bytes: 1024,
          source: 'slot',
        },
      ],
      { bytes: 1024, itemCount: 1, warning: false },
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.load-save-slot')?.getAttribute('data-save-slot')).toBe('safe-slot');
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('escapes all HTML-significant characters for other UI renderers', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#039;');
  });
});
