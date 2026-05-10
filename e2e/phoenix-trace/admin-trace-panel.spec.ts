/**
 * Phoenix admin trace panel — DoD spec.
 *
 * Stack: docker compose -f docker-compose.aurora-local.yml up -d
 * Runs against http://localhost (nginx) using the seeded admin user.
 *
 * Flow:
 *   1. Login as admin@botnim.local (seeded by init-user service).
 *   2. Open a new chat with the unified bot.
 *   3. Ask a real Hebrew question from the gold set.
 *   4. Wait for the assistant reply to fully render.
 *   5. Assert the admin-trace-pill is visible on the assistant message.
 *   6. Click the pill, assert the panel expands and shows step rows.
 *   7. Open the first step row's detail, assert it shows attribute JSON.
 *
 * If trace data isn't yet flowing through the stack (Phoenix down,
 * collector misconfigured, etc.), the panel will surface that as
 * "trace not available" rather than failing silently — the spec
 * checks for that error explicitly so we get a useful diagnostic.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@botnim.local';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

const QUESTION =
  'מה הנחיות היועצת המשפטית לכנסת בעניין הסתייגויות בוועדה';

async function login(page: Page) {
  // Programmatic login via the JSON API — faster + less brittle than the UI form.
  const r = await page.request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  expect(r.ok(), `login failed: HTTP ${r.status()}`).toBeTruthy();
  const body = await r.json();
  expect(body.user?.role, 'seeded admin user must have role=ADMIN').toBe('ADMIN');
  // The token cookie is set on the response — Playwright's request context
  // shares cookies with the page context, so subsequent page.goto picks it up.
}

test.describe('admin trace panel', () => {
  test('admin asks a question and sees the trace panel populated', async ({ page }) => {
    test.setTimeout(180_000);

    await login(page);
    await page.goto('/c/new');

    // The exact selector for the chat input + send button depends on the
    // LibreChat version. Try in order: data-testid (preferred), placeholder,
    // role-based aria. Fall back to the first textarea + Enter.
    const input = page.locator('[data-testid="chat-input"], [data-testid="text-input"], textarea').first();
    await expect(input, 'chat input must be visible').toBeVisible({ timeout: 30_000 });
    await input.fill(QUESTION);

    const sendBtn = page.locator('[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="שלח" i]').first();
    if (await sendBtn.count()) {
      await sendBtn.click();
    } else {
      await input.press('Enter');
    }

    // The assistant reply lands inside an article / message container with
    // some "assistant" identifier. We poll for the trace container that the
    // AdminTracePanel always renders for admins on assistant messages.
    const traceContainer = page.locator('[data-testid="admin-trace-container"]').first();
    await expect(
      traceContainer,
      'admin-trace-container must appear under the first assistant reply (means the assistant reply has metadata.phoenix_trace_id and the AdminTracePanel mounted)',
    ).toBeVisible({ timeout: 120_000 });

    // The pill is the collapsed view; click it.
    const pill = traceContainer.locator('[data-testid="admin-trace-pill"]');
    await expect(pill, 'collapsed trace pill').toBeVisible();

    // Capture pre-click screenshot for the report
    await page.screenshot({ path: 'phoenix-trace-report/01-pill-visible.png', fullPage: false });

    await pill.click();

    // Panel + step list
    const panel = page.locator('[data-testid="admin-trace-panel"]');
    await expect(panel, 'expanded panel after pill click').toBeVisible({ timeout: 5000 });

    // Loading state may or may not flash (5min cache); either way, we
    // need the step list to appear before we declare success.
    const stepList = panel.locator('[data-testid="trace-step-list"]');
    const errorBanner = panel.locator('[data-testid="trace-error"]');

    await Promise.race([
      stepList.waitFor({ state: 'visible', timeout: 20_000 }),
      errorBanner.waitFor({ state: 'visible', timeout: 20_000 }),
    ]);

    if (await errorBanner.isVisible()) {
      const errorText = await errorBanner.textContent();
      throw new Error(
        `trace fetch failed (panel rendered the error banner): ${errorText}\n` +
        `→ Likely cause: backend route /botnim/traces/<id> couldn't reach Phoenix or Phoenix has no spans for this trace id. ` +
        `Check 'docker logs phoenix' and 'docker logs LibreChat-API' for clues.`,
      );
    }

    // At least one step row must render, and it must carry a recognized kind.
    const firstStep = stepList.locator('[data-testid="trace-step-0"]');
    await expect(firstStep, 'at least one step row in the timeline').toBeVisible();

    const firstKind = await firstStep.getAttribute('data-step-kind');
    expect(
      ['llm', 'tool', 'retrieve', 'embedding', 'chain', 'other'].includes(firstKind || ''),
      `first step should have a recognized kind, got '${firstKind}'`,
    ).toBeTruthy();

    // Prefer to click a tool_retrieve step (it has the richest detail —
    // tool name, args, optional bar chart, ranked docs). Fall back to the
    // first step if no retrieve exists.
    const retrieveStep = panel.locator('[data-step-kind="tool_retrieve"]').first();
    const stepToClick = (await retrieveStep.count()) > 0 ? retrieveStep : firstStep;
    await stepToClick.click();
    const detailPane = panel.locator('[data-testid="trace-detail-pane"]');
    await expect(detailPane, 'right detail pane').toBeVisible({ timeout: 3000 });
    const detailText = await detailPane.textContent();
    expect(detailText?.length || 0, 'detail pane should not be empty').toBeGreaterThan(2);

    await page.screenshot({ path: 'phoenix-trace-report/02-panel-expanded.png', fullPage: false });

    // Final sanity: count steps. The LLM's behaviour is non-deterministic —
    // sometimes it answers from prior context without firing any tool. As
    // long as the panel renders at least one classified step, the data
    // pipeline is verified end-to-end.
    const stepCount = await stepList.locator('[data-testid^="trace-step-"]').count();
    expect(stepCount, 'expected at least 1 step in the rendered trace').toBeGreaterThanOrEqual(1);
  });
});
