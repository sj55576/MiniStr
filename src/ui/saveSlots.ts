import type { SaveSlot, StorageUsage } from '../game';
import { escapeHtml, formatBytes, uiText } from './strings';

export function renderSaveSlotManager(slots: readonly SaveSlot[], usage: StorageUsage): string {
  const rows = slots.length
    ? slots
        .map(
          (slot) =>
            `<li><div><strong>${escapeHtml(slot.name)}</strong><span>${escapeHtml(slot.mapId)} / ${slot.turn}ターン / ${formatBytes(slot.bytes)}</span><time datetime="${escapeHtml(slot.savedAt)}">${escapeHtml(slot.savedAt)}</time></div><div><button class="save-action load-save-slot" data-save-slot="${escapeHtml(slot.id)}">再開</button>${slot.source === 'slot' ? `<button class="save-action delete-save-slot" data-save-slot="${escapeHtml(slot.id)}">削除</button>` : ''}</div></li>`,
        )
        .join('')
    : '<li class="save-slot-empty">保存済みの対局はありません。</li>';
  return `<section class="save-slot-manager" aria-labelledby="save-slot-title"><div><p class="card-kicker">SAVES</p><h2 id="save-slot-title">${uiText.saveManager}</h2><p>${uiText.storageUsage}: ${formatBytes(usage.bytes)} (${usage.itemCount}件)</p></div><button id="save-new-slot" class="save-action">${uiText.saveSlot}</button><ol>${rows}</ol>${usage.warning ? `<p class="storage-warning" role="status">${uiText.storageWarning}</p>` : ''}</section>`;
}
