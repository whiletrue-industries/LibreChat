/**
 * UPE DoD — Test 1 of 4: Unified editor round-trip.
 *
 * Manual script: rebuilding-bots/.worktrees/unified-prompt-editor/docs/superpowers/manual-tests/2026-05-07-unified-prompt-editor.md
 *
 * Verifies that:
 *   1. /d/agent-prompts/<agent> loads with a populated textarea.
 *   2. Editing + Save draft surfaces a draft indicator and the draft
 *      agent ID is exposed to the UI.
 *   3. /c/new?agent_id=<draftId> renders a chat that produces an
 *      assistant response containing the sentinel.
 *   4. Publish flips the active version; reload shows the sentinel as
 *      the active joined text.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_PROMPTS_AGENT,
  ADMIN_PROMPTS_PASSWORD,
  ADMIN_PROMPTS_TIMEOUT_MS,
  ADMIN_PROMPTS_URL,
  ADMIN_PROMPTS_USER,
  appendToLastSection,
  askChatQuestion,
  fetchDraftAgentId,
  gotoLoginAndSignIn,
  makeSentinel,
  waitForJoinedTextarea,
} from './_helpers';

test.describe('UPE DoD — round trip', () => {
  test.skip(
    !ADMIN_PROMPTS_USER || !ADMIN_PROMPTS_PASSWORD,
    'ADMIN_PROMPTS_USER and ADMIN_PROMPTS_PASSWORD must be set',
  );

  test('edit → save draft → try draft → publish → reload sees sentinel', async ({ page }) => {
    test.setTimeout(ADMIN_PROMPTS_TIMEOUT_MS + 60_000);

    await gotoLoginAndSignIn(page, ADMIN_PROMPTS_USER, ADMIN_PROMPTS_PASSWORD);

    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );
    const original = await waitForJoinedTextarea(page);
    expect(original.length).toBeGreaterThan(0);
    // SECTION_KEY markers are internal-only; the per-section view must
    // never expose them. This assertion is the regression guard for the
    // 2026-05-08 marker-leakage fix — flip it from `not.toContain` back
    // to `toContain` and the test fails immediately.
    expect(original).not.toContain('<!-- SECTION_KEY:');

    const sentinel = makeSentinel('TEST_SENTINEL');
    await appendToLastSection(page, sentinel);

    await page
      .getByRole('button', { name: /Save draft|שמור טיוטה/i })
      .click();

    const tryDraftBtn = page.getByRole('button', { name: /Try draft|נסה טיוטה/i });
    await expect(tryDraftBtn).toBeEnabled({ timeout: 20_000 });

    const draftAgentId = await fetchDraftAgentId(page, ADMIN_PROMPTS_AGENT);
    expect(
      draftAgentId,
      'GET /api/admin/prompts/<agent>/joined must return a draftAgentId after Save draft',
    ).toBeTruthy();

    if (draftAgentId) {
      const result = await askChatQuestion(
        page,
        draftAgentId,
        `Please repeat the literal token ${sentinel} verbatim in your reply.`,
        ADMIN_PROMPTS_TIMEOUT_MS,
      );
      expect(
        result.ok,
        `draft chat must produce an assistant response. errors=${JSON.stringify(
          result.errors,
        )}`,
      ).toBe(true);
      expect(
        result.text,
        `draft chat response should reference the sentinel '${sentinel}'`,
      ).toContain(sentinel);
    }

    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await waitForJoinedTextarea(page);

    const changeNoteInput = page.locator('input[placeholder*="Change note" i]').first();
    if (await changeNoteInput.count()) {
      await changeNoteInput.fill(`UPE DoD round-trip ${sentinel}`);
    }

    await page
      .getByRole('button', { name: /^Publish$|^פרסם$/i })
      .click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterPublish = await waitForJoinedTextarea(page);
    expect(
      afterPublish,
      'after publish + reload, the active joined text should contain the sentinel',
    ).toContain(sentinel);
  });
});
