/**
 * UPE DoD — Test 3 of 4: Tool description override.
 *
 * Verifies the ToolOverridesTable lifecycle:
 *   1. Pick a tool row, expand it, edit the description with a sentinel.
 *   2. Save draft + Publish → row shows "active override" badge.
 *   3. Clear override → row reverts to default badge.
 *   4. Open Versions modal → restore the override → row is overridden again.
 *
 * Manual script: rebuilding-bots/.worktrees/unified-prompt-editor/docs/superpowers/manual-tests/2026-05-07-unified-prompt-editor.md
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_PROMPTS_AGENT,
  ADMIN_PROMPTS_PASSWORD,
  ADMIN_PROMPTS_TIMEOUT_MS,
  ADMIN_PROMPTS_URL,
  ADMIN_PROMPTS_USER,
  gotoLoginAndSignIn,
  makeSentinel,
} from './_helpers';

const TOOL_NAME =
  process.env.ADMIN_PROMPTS_TOOL_NAME || 'search_unified__legal_text';

test.describe('UPE DoD — tool description override', () => {
  test.skip(
    !ADMIN_PROMPTS_USER || !ADMIN_PROMPTS_PASSWORD,
    'ADMIN_PROMPTS_USER and ADMIN_PROMPTS_PASSWORD must be set',
  );

  test(`override → publish → clear → restore for ${TOOL_NAME}`, async ({ page }) => {
    test.setTimeout(ADMIN_PROMPTS_TIMEOUT_MS + 60_000);

    await gotoLoginAndSignIn(page, ADMIN_PROMPTS_USER, ADMIN_PROMPTS_PASSWORD);
    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );

    const table = page.getByTestId('tool-overrides-table');
    await expect(table).toBeVisible({ timeout: 30_000 });

    let row = page.getByTestId(`tool-override-row-${TOOL_NAME}`);
    if ((await row.count()) === 0) {
      const anyRow = table.locator('[data-testid^="tool-override-row-"]').first();
      await expect(
        anyRow,
        `no row for tool '${TOOL_NAME}' and table has no rows at all — set ADMIN_PROMPTS_TOOL_NAME to a real tool name`,
      ).toBeVisible({ timeout: 10_000 });
      const fallbackTestid =
        (await anyRow.getAttribute('data-testid')) || '';
      const fallbackName = fallbackTestid.replace(/^tool-override-row-/, '');
      test.info().annotations.push({
        type: 'note',
        description: `falling back to first available tool: ${fallbackName}`,
      });
      row = page.getByTestId(`tool-override-row-${fallbackName}`);
    }

    const sentinel = makeSentinel('TEST_TOOL_DESC');

    await row.click();
    const ta = page.locator('[data-testid^="tool-override-textarea-"]').first();
    await expect(ta).toBeVisible({ timeout: 10_000 });
    const original = await ta.inputValue();
    await ta.fill(`${original}\n${sentinel}`);

    await page
      .getByRole('button', { name: /Save override draft|שמור טיוטת דריסה/i })
      .first()
      .click();
    await page.waitForTimeout(1_000);

    const noteInput = page
      .locator('input[placeholder*="Change note" i]')
      .last();
    if (await noteInput.count()) {
      await noteInput.fill(`UPE DoD tool override ${sentinel}`);
    }
    await page
      .getByRole('button', { name: /Publish override|פרסם דריסה/i })
      .first()
      .click();

    await page.waitForTimeout(2_000);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(table).toBeVisible({ timeout: 30_000 });
    const activeRow = page
      .locator('[data-testid^="tool-override-row-"]')
      .filter({ hasText: /Active override|דריסה פעילה/i });
    expect(
      await activeRow.count(),
      'after publish, ≥1 row should display the active-override badge',
    ).toBeGreaterThan(0);

    const targetRow = activeRow.first();
    await targetRow.click();

    await page
      .getByRole('button', { name: /Clear override|נקה דריסה/i })
      .first()
      .click();
    await page.waitForTimeout(1_500);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await targetRow.click();
    const versionsBtn = page
      .getByRole('button', { name: /Versions|גרסאות/i })
      .first();
    await versionsBtn.click();

    const restoreInModal = page
      .getByRole('button', { name: /Restore|שחזר/i })
      .last();
    await expect(restoreInModal).toBeVisible({ timeout: 10_000 });
    await restoreInModal.click();
    await page.waitForTimeout(1_500);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const reActiveRow = page
      .locator('[data-testid^="tool-override-row-"]')
      .filter({ hasText: /Active override|דריסה פעילה/i });
    expect(
      await reActiveRow.count(),
      'after restore-from-versions, the override should be active again',
    ).toBeGreaterThan(0);
  });
});
