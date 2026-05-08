/**
 * UPE DoD — Test 2 of 4: Snapshots + restore.
 *
 * Verifies the snapshots sidebar lists ≥3 publishes with distinct
 * sentinels and that restoring the oldest reverts the joined text.
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
  waitForJoinedTextarea,
} from './_helpers';
import type { Page } from '@playwright/test';

async function publishWithSentinel(
  page: Page,
  sentinel: string,
): Promise<void> {
  await page.goto(
    `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
    { waitUntil: 'domcontentloaded' },
  );
  const current = await waitForJoinedTextarea(page);
  const textarea = page.getByTestId('unified-prompt-textarea');
  await textarea.fill(`${current}\n${sentinel}`);

  await page.getByRole('button', { name: /Save draft|שמור טיוטה/i }).click();
  await expect(
    page.getByRole('button', { name: /Try draft|נסה טיוטה/i }),
  ).toBeEnabled({ timeout: 20_000 });

  const note = page.locator('input[placeholder*="Change note" i]').first();
  if (await note.count()) {
    await note.fill(`UPE DoD snapshot ${sentinel}`);
  }
  await page.getByRole('button', { name: /^Publish$|^פרסם$/i }).click();
  await page.waitForTimeout(1_500);
}

test.describe('UPE DoD — snapshots + restore', () => {
  test.skip(
    !ADMIN_PROMPTS_USER || !ADMIN_PROMPTS_PASSWORD,
    'ADMIN_PROMPTS_USER and ADMIN_PROMPTS_PASSWORD must be set',
  );

  test('three publishes appear; restoring the oldest reverts the textarea', async ({
    page,
  }) => {
    test.setTimeout(ADMIN_PROMPTS_TIMEOUT_MS + 60_000);

    await gotoLoginAndSignIn(page, ADMIN_PROMPTS_USER, ADMIN_PROMPTS_PASSWORD);

    const sentinelA = makeSentinel('SENT_A');
    const sentinelB = makeSentinel('SENT_B');
    const sentinelC = makeSentinel('SENT_C');

    await publishWithSentinel(page, sentinelA);
    await page.waitForTimeout(61_000);
    await publishWithSentinel(page, sentinelB);
    await page.waitForTimeout(61_000);
    await publishWithSentinel(page, sentinelC);

    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await waitForJoinedTextarea(page);

    await page.getByRole('button', { name: /Snapshots|תמונות מצב/i }).click();
    const snapshotsAside = page.locator('aside', { hasText: /Snapshots|תמונות מצב/i });
    await expect(snapshotsAside).toBeVisible({ timeout: 10_000 });

    const restoreButtons = snapshotsAside.getByRole('button', {
      name: /Restore|שחזר/i,
    });
    const count = await restoreButtons.count();
    expect(
      count,
      `expected ≥3 restore buttons in the snapshots sidebar, got ${count}`,
    ).toBeGreaterThanOrEqual(3);

    await restoreButtons.last().click();

    const confirmBtn = page.getByRole('button', {
      name: /Restore|שחזר|Continue|המשך/i,
    });
    await confirmBtn.last().click();

    await page.waitForTimeout(2_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reverted = await waitForJoinedTextarea(page);
    expect(
      reverted,
      `after restoring oldest snapshot, joined text should contain '${sentinelA}'`,
    ).toContain(sentinelA);
    expect(reverted).not.toContain(sentinelC);
  });
});
