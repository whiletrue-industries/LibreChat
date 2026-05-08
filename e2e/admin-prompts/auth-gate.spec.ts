/**
 * UPE DoD — Test 4 of 4: Auth gate (`restrictDraftAgent`).
 *
 * Verifies that:
 *   1. An admin can chat at /c/new?agent_id=<draftId>.
 *   2. A non-admin gets a 403 from the API and cannot complete the chat.
 *
 * This guards `api/server/middleware/restrictDraftAgent.js` from
 * regression — the only thing keeping draft agents private.
 *
 * Manual script: rebuilding-bots/.worktrees/unified-prompt-editor/docs/superpowers/manual-tests/2026-05-07-unified-prompt-editor.md
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_PROMPTS_AGENT,
  ADMIN_PROMPTS_PASSWORD,
  ADMIN_PROMPTS_PASSWORD2,
  ADMIN_PROMPTS_TIMEOUT_MS,
  ADMIN_PROMPTS_URL,
  ADMIN_PROMPTS_USER,
  ADMIN_PROMPTS_USER2,
  appendToLastSection,
  askChatQuestion,
  fetchDraftAgentId,
  gotoLoginAndSignIn,
  makeSentinel,
  waitForJoinedTextarea,
} from './_helpers';

test.describe('UPE DoD — restrictDraftAgent middleware', () => {
  test.skip(
    !ADMIN_PROMPTS_USER ||
      !ADMIN_PROMPTS_PASSWORD ||
      !ADMIN_PROMPTS_USER2 ||
      !ADMIN_PROMPTS_PASSWORD2,
    'ADMIN_PROMPTS_USER/PASSWORD and ADMIN_PROMPTS_USER2/PASSWORD2 must be set',
  );

  test('admin reaches the draft chat; non-admin gets 403', async ({ browser }) => {
    test.setTimeout(ADMIN_PROMPTS_TIMEOUT_MS + 60_000);

    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    try {
      await gotoLoginAndSignIn(adminPage, ADMIN_PROMPTS_USER, ADMIN_PROMPTS_PASSWORD);

      await adminPage.goto(
        `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitForJoinedTextarea(adminPage);
      const sentinel = makeSentinel('TEST_AUTH_GATE');
      await appendToLastSection(adminPage, sentinel);
      await adminPage
        .getByRole('button', { name: /Save draft|שמור טיוטה/i })
        .click();
      await expect(
        adminPage.getByRole('button', { name: /Try draft|נסה טיוטה/i }),
      ).toBeEnabled({ timeout: 20_000 });

      const draftAgentId = await fetchDraftAgentId(adminPage, ADMIN_PROMPTS_AGENT);
      expect(draftAgentId, 'admin must see a draftAgentId after saving a draft').toBeTruthy();

      if (!draftAgentId) {
        throw new Error('cannot proceed without draftAgentId');
      }

      const adminResult = await askChatQuestion(
        adminPage,
        draftAgentId,
        `Repeat ${sentinel} verbatim.`,
        ADMIN_PROMPTS_TIMEOUT_MS,
      );
      expect(
        adminResult.ok,
        `admin must get an assistant response on the draft chat. errors=${JSON.stringify(
          adminResult.errors,
        )}`,
      ).toBe(true);

      const nonAdminCtx = await browser.newContext();
      const nonAdminPage = await nonAdminCtx.newPage();
      try {
        await gotoLoginAndSignIn(
          nonAdminPage,
          ADMIN_PROMPTS_USER2,
          ADMIN_PROMPTS_PASSWORD2,
        );

        const nonAdminResult = await askChatQuestion(
          nonAdminPage,
          draftAgentId,
          `Test ${sentinel}.`,
          ADMIN_PROMPTS_TIMEOUT_MS / 4,
        );
        expect(
          nonAdminResult.forbidden,
          `non-admin must get a 403 on draft agent. observed errors=${JSON.stringify(
            nonAdminResult.errors,
          )}; ok=${nonAdminResult.ok}`,
        ).toBe(true);
      } finally {
        await nonAdminCtx.close();
      }
    } finally {
      await adminCtx.close();
    }
  });
});
