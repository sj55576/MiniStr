import { expect, test } from '@playwright/test';

test('starts an operation, moves a unit, and completes a CPU turn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /単体作戦を開始/ }).click();
  await expect(page.locator('.board')).toBeVisible();

  await page.locator('.tile[data-x="0"][data-y="1"]').click();
  await page.locator('.tile[data-x="0"][data-y="2"]').click();
  await expect(page.locator('.status-message')).toContainText('移動しました');

  await page.locator('#end').click();
  await expect(page.locator('.turn-indicator strong')).toContainText('プレイヤー', { timeout: 15_000 });
});
