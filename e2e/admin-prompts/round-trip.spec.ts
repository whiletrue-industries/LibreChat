/**
 * UPE DoD — full round trip with end-to-end LLM verification.
 *
 * Verifies the user's stated DoD:
 *   "draft a prompt change, ask a question and prove it was used
 *    (and the published prompt)"
 *
 * Specifically:
 *   1. /d/agent-prompts/<agent> renders a single textarea with the joined
 *      prompt — NO `<!-- SECTION_KEY: ... -->` markers visible anywhere.
 *   2. Editing + Save draft enables "Try draft" and exposes a draftAgentId.
 *   3. Asking a question of the DRAFT agent (`/c/new?agent_id=<draftId>`)
 *      produces an assistant response that quotes the sentinel — proving
 *      the draft prompt edit reached the LLM.
 *   4. Asking the SAME question of the canonical agent BEFORE publish
 *      must NOT contain the sentinel — proving the draft is isolated.
 *   5. Publish flips active. Reloading the editor shows the sentinel as
 *      the active joined text. Asking the canonical agent in a fresh
 *      chat now DOES quote the sentinel — proving the published prompt
 *      reached the LLM.
 */
import { test, expect } from '@playwright/test';
import {
  ADMIN_PROMPTS_AGENT,
  ADMIN_PROMPTS_PASSWORD,
  ADMIN_PROMPTS_TIMEOUT_MS,
  ADMIN_PROMPTS_URL,
  ADMIN_PROMPTS_USER,
  appendToUnifiedTextarea,
  askChatQuestion,
  fetchDraftAgentId,
  gotoLoginAndSignIn,
  makeSentinel,
  waitForJoinedTextarea,
} from './_helpers';

async function fetchCanonicalAgentId(page: import('@playwright/test').Page): Promise<string> {
  const resp = await page.request.get(`${ADMIN_PROMPTS_URL}/api/config`);
  if (!resp.ok()) {
    throw new Error(`GET /api/config returned ${resp.status()}`);
  }
  const json = (await resp.json()) as {
    modelSpecs?: { list?: Array<{ name?: string; preset?: { agent_id?: string } }> };
  };
  // Pick the first non-DRAFT modelSpec.
  const list = json.modelSpecs?.list ?? [];
  const canonical = list.find((m) => m.name && !/draft/i.test(m.name));
  const id = canonical?.preset?.agent_id;
  if (!id) {
    throw new Error(
      `could not resolve canonical agent_id from /api/config; list=${JSON.stringify(list)}`,
    );
  }
  return id;
}

test.describe('UPE DoD — round trip', () => {
  test.skip(
    !ADMIN_PROMPTS_USER || !ADMIN_PROMPTS_PASSWORD,
    'ADMIN_PROMPTS_USER and ADMIN_PROMPTS_PASSWORD must be set',
  );

  test('edit → draft answers with sentinel; canonical does not; publish → canonical answers with sentinel', async ({
    page,
  }) => {
    test.setTimeout(ADMIN_PROMPTS_TIMEOUT_MS * 3 + 120_000);

    await gotoLoginAndSignIn(page, ADMIN_PROMPTS_USER, ADMIN_PROMPTS_PASSWORD);

    // Step 1 — open the editor; confirm marker-free single textarea.
    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );
    const original = await waitForJoinedTextarea(page);
    expect(original.length).toBeGreaterThan(0);
    expect(
      original,
      'SECTION_KEY markers are an internal artifact and must not appear in the UI',
    ).not.toContain('<!-- SECTION_KEY:');

    // Step 2 — append an explicit "always include this token" instruction
    // to the prompt and save as a draft. The instruction is phrased to
    // be unambiguous so the LLM has no excuse to drop the sentinel.
    const sentinel = makeSentinel('UPE_DOD');
    const draftInstruction = `\n\nIMPORTANT: For every reply you ever produce, append the literal token ${sentinel} verbatim on its own line at the very end. Do this for ALL questions, including off-topic ones.`;
    await appendToUnifiedTextarea(page, draftInstruction);

    await page.getByRole('button', { name: /Save draft|שמור טיוטה/i }).click();
    await expect(
      page.getByRole('button', { name: /Try draft|נסה טיוטה/i }),
      'Try draft must enable within 20s of Save draft completing',
    ).toBeEnabled({ timeout: 20_000 });

    const draftAgentId = await fetchDraftAgentId(page, ADMIN_PROMPTS_AGENT);
    expect(
      draftAgentId,
      'GET /api/admin/prompts/<agent>/joined must return a draftAgentId after Save draft',
    ).toBeTruthy();
    if (!draftAgentId) {
      throw new Error('cannot continue without a draftAgentId');
    }

    // Step 3 — ask the DRAFT agent. Its assistant response must quote
    // the sentinel. This is the proof that the draft prompt edit
    // reached the LLM.
    const draftResult = await askChatQuestion(
      page,
      draftAgentId,
      'מה הכי חשוב לדעת על תקנון הכנסת? תשובה קצרה.',
      ADMIN_PROMPTS_TIMEOUT_MS,
    );
    expect(
      draftResult.ok,
      `draft chat must produce an assistant response. errors=${JSON.stringify(draftResult.errors)}`,
    ).toBe(true);
    expect(
      draftResult.text,
      `draft answer must contain sentinel ${sentinel} (proves draft prompt reached the LLM)`,
    ).toContain(sentinel);

    // Step 4 — ask the CANONICAL agent the same question (in a fresh
    // browser context so chat state doesn't leak). Its response must
    // NOT contain the sentinel — proves the draft is isolated from
    // regular users.
    const canonicalAgentId = await fetchCanonicalAgentId(page);
    expect(canonicalAgentId).not.toBe(draftAgentId);
    const canonicalBefore = await askChatQuestion(
      page,
      canonicalAgentId,
      'מה הכי חשוב לדעת על תקנון הכנסת? תשובה קצרה.',
      ADMIN_PROMPTS_TIMEOUT_MS,
    );
    expect(
      canonicalBefore.ok,
      `canonical pre-publish chat must produce an assistant response. errors=${JSON.stringify(canonicalBefore.errors)}`,
    ).toBe(true);
    expect(
      canonicalBefore.text,
      `canonical pre-publish answer must NOT contain sentinel ${sentinel} (proves draft is isolated)`,
    ).not.toContain(sentinel);

    // Step 5 — publish. Then ask the canonical agent again in a fresh
    // chat. Its response must NOW contain the sentinel — proves the
    // published prompt reached the LLM.
    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await waitForJoinedTextarea(page);
    const changeNoteInput = page.locator('input[placeholder*="Change note" i], input[placeholder*="הערת"]').first();
    await changeNoteInput.fill(`UPE DoD round-trip ${sentinel}`);
    await page.getByRole('button', { name: /^Publish$|^פרסם$/i }).click();

    // Reload the editor; verify the active joined text contains the sentinel.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterPublish = await waitForJoinedTextarea(page);
    expect(
      afterPublish,
      'after publish + reload, the active joined text should contain the sentinel',
    ).toContain(sentinel);

    // Now ask the canonical agent the same question — answer must contain sentinel.
    const canonicalAfter = await askChatQuestion(
      page,
      canonicalAgentId,
      'מה הכי חשוב לדעת על תקנון הכנסת? תשובה קצרה.',
      ADMIN_PROMPTS_TIMEOUT_MS,
    );
    expect(
      canonicalAfter.ok,
      `canonical post-publish chat must produce an assistant response. errors=${JSON.stringify(canonicalAfter.errors)}`,
    ).toBe(true);
    expect(
      canonicalAfter.text,
      `canonical post-publish answer must contain sentinel ${sentinel} (proves published prompt reached the LLM)`,
    ).toContain(sentinel);

    // Step 6 — CLEANUP. The publish above shipped the sentinel-bearing
    // prompt to ALL real users of the canonical agent. We must restore
    // the pre-test prompt and publish it before the test exits. Without
    // this, every reply real users receive after this test runs will
    // include the sentinel until an admin manually republishes.
    await page.goto(
      `${ADMIN_PROMPTS_URL}/d/agent-prompts/${encodeURIComponent(ADMIN_PROMPTS_AGENT)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await waitForJoinedTextarea(page);
    const cleanupTextarea = page.getByTestId('unified-prompt-textarea');
    await cleanupTextarea.fill(original);
    await page
      .getByRole('button', { name: /Save draft|שמור טיוטה/i })
      .click();
    await expect(
      page.getByRole('button', { name: /Try draft|נסה טיוטה/i }),
      'Try draft must enable after cleanup save',
    ).toBeEnabled({ timeout: 20_000 });
    const cleanupNote = page
      .locator('input[placeholder*="Change note" i], input[placeholder*="הערת"]')
      .first();
    await cleanupNote.fill(`UPE DoD cleanup — restoring pre-test prompt (sentinel was ${sentinel})`);
    await page.getByRole('button', { name: /^Publish$|^פרסם$/i }).click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterCleanup = await waitForJoinedTextarea(page);
    expect(
      afterCleanup,
      'after cleanup publish + reload, the active joined text must equal the pre-test prompt',
    ).toBe(original);
    expect(
      afterCleanup,
      'cleanup publish must remove the sentinel from the active prompt',
    ).not.toContain(sentinel);
  });
});
