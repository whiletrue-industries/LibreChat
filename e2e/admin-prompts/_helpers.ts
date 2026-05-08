/**
 * Shared helpers for the unified-prompt-editor DoD specs.
 *
 * These specs exercise the four manual-test scenarios documented in
 * rebuilding-bots/.worktrees/unified-prompt-editor/docs/superpowers/manual-tests/2026-05-07-unified-prompt-editor.md
 *
 * Targeting model
 * ---------------
 * The specs accept an arbitrary base URL via env var so the same code
 * runs against:
 *   - a local docker-compose stack (when one exists with the
 *     unified-prompt-editor image baked in),
 *   - the staging deployment (https://botnim.staging.build-up.team),
 *   - production (https://botnim.build-up.team) post-staging.
 *
 * They cannot run against the standard `playwright.config.local.ts`
 * webServer flow because that boots upstream LibreChat off the Mongo
 * memory store; it does NOT seed the unified bot's `agent_prompts`
 * sections, the agent_tool_overrides table, or a real botnim-api with
 * the joined / snapshot / tool-override controllers wired in.
 *
 * Env vars
 * --------
 *   ADMIN_PROMPTS_URL        e.g. https://botnim.staging.build-up.team
 *   ADMIN_PROMPTS_USER       admin email (required)
 *   ADMIN_PROMPTS_PASSWORD   admin password (required)
 *   ADMIN_PROMPTS_USER2      non-admin email (auth-gate test)
 *   ADMIN_PROMPTS_PASSWORD2  non-admin password (auth-gate test)
 *   ADMIN_PROMPTS_AGENT      agent slug, default 'unified'
 *   ADMIN_PROMPTS_TIMEOUT_MS default 120000
 */
import type { Page } from '@playwright/test';

export const ADMIN_PROMPTS_URL =
  process.env.ADMIN_PROMPTS_URL || 'https://botnim.staging.build-up.team';
export const ADMIN_PROMPTS_USER = process.env.ADMIN_PROMPTS_USER || '';
export const ADMIN_PROMPTS_PASSWORD = process.env.ADMIN_PROMPTS_PASSWORD || '';
export const ADMIN_PROMPTS_USER2 = process.env.ADMIN_PROMPTS_USER2 || '';
export const ADMIN_PROMPTS_PASSWORD2 = process.env.ADMIN_PROMPTS_PASSWORD2 || '';
export const ADMIN_PROMPTS_AGENT = process.env.ADMIN_PROMPTS_AGENT || 'unified';
export const ADMIN_PROMPTS_TIMEOUT_MS = Number(
  process.env.ADMIN_PROMPTS_TIMEOUT_MS || 120_000,
);

export function makeSentinel(prefix = 'TEST_SENTINEL'): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}_${suffix}`;
}

/**
 * Logs in via the LibreChat /login form. Caller must have already
 * navigated to the login page.
 */
export async function loginViaForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 30_000,
    }),
    page.locator('button[type="submit"]').click(),
  ]);
}

export async function gotoLoginAndSignIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${ADMIN_PROMPTS_URL}/login`, { waitUntil: 'domcontentloaded' });
  await loginViaForm(page, email, password);
}

/**
 * Waits for the unified prompt editor's per-section textareas to become
 * visible and returns the concatenation of their values — i.e., the
 * marker-free text the admin actually sees. The `<!-- SECTION_KEY -->`
 * markers that used to live in a single textarea are now an internal
 * serialization artifact reconstructed only at save time, so callers
 * that only need to detect "is the sentinel anywhere in the prompt"
 * still get the right answer from this concatenation.
 *
 * Throws if no section textareas appear within 30s or if every
 * textarea stays empty.
 */
export async function waitForJoinedTextarea(page: Page): Promise<string> {
  const sectionLocator = page.locator('[data-testid^="section-textarea-"]');
  await sectionLocator.first().waitFor({ state: 'visible', timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const handles = await sectionLocator.elementHandles();
    if (handles.length > 0) {
      const values: string[] = [];
      for (const h of handles) {
        values.push(await h.inputValue());
      }
      const joined = values.join('\n\n');
      if (joined.trim().length > 0) {
        return joined;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('section textareas never populated within 30s');
}

/**
 * Appends `extraText` (typically a sentinel) to the LAST section's
 * textarea — the cleanest way to introduce a unique token without
 * disturbing earlier sections' content. Returns the new joined value
 * for the caller's bookkeeping.
 */
export async function appendToLastSection(
  page: Page,
  extraText: string,
): Promise<string> {
  const sections = page.locator('[data-testid^="section-textarea-"]');
  const count = await sections.count();
  if (count === 0) {
    throw new Error('no section textareas available to append to');
  }
  const last = sections.nth(count - 1);
  const current = await last.inputValue();
  const next = `${current}\n${extraText}`;
  await last.fill(next);
  return next;
}

/**
 * Reusable chat-question loop used by the round-trip + auth-gate specs.
 * Sends a question via the standard textarea[name="text"] input on a
 * fresh /c/new chat and waits for either a recognizable assistant
 * response or a recognizable error pattern.
 */
export async function askChatQuestion(
  page: Page,
  agentId: string,
  question: string,
  timeoutMs: number,
): Promise<{
  ok: boolean;
  text: string;
  errors: Array<{ url: string; status: number; body: string }>;
  badRequest: boolean;
  forbidden: boolean;
}> {
  const errors: Array<{ url: string; status: number; body: string }> = [];
  const onResp = async (response: import('@playwright/test').Response) => {
    const url = response.url();
    if (!url.includes('/api/ask/') && !url.includes('/api/agents/')) return;
    if (response.status() < 400) return;
    let body = '';
    try {
      body = await response.text();
    } catch (_err) {
      body = '<unavailable>';
    }
    errors.push({ url, status: response.status(), body });
  };
  page.on('response', onResp);

  try {
    await page.goto(`${ADMIN_PROMPTS_URL}/c/new?agent_id=${encodeURIComponent(agentId)}`, {
      waitUntil: 'domcontentloaded',
    });
    const input = page.locator('textarea[name="text"]').first();
    await input.waitFor({ state: 'visible', timeout: 30_000 });
    await input.fill(question);
    await input.press('Enter');

    const deadline = Date.now() + timeoutMs;
    let assistantText = '';
    while (Date.now() < deadline) {
      const forbidden = errors.some((e) => e.status === 403);
      const badRequest = errors.some((e) => e.status === 400);
      if (forbidden) {
        return { ok: false, text: '', errors, badRequest: false, forbidden: true };
      }
      if (badRequest) {
        return { ok: false, text: '', errors, badRequest: true, forbidden: false };
      }
      const bubble = page.locator('.agent-turn');
      if ((await bubble.count()) > 0) {
        const text = (await bubble.last().innerText().catch(() => '')) || '';
        if (text.trim().length > 20) {
          assistantText = text;
          return { ok: true, text, errors, badRequest: false, forbidden: false };
        }
      }
      await page.waitForTimeout(1_000);
    }
    return {
      ok: false,
      text: assistantText,
      errors,
      badRequest: false,
      forbidden: false,
    };
  } finally {
    page.off('response', onResp);
  }
}

/**
 * Reads the draft agent ID from the editor's "Try draft" button by
 * inspecting the URL the button would open via window.open. We cannot
 * intercept window.open synchronously without instrumenting the page,
 * so instead we hit the API the same way the page does and pull the
 * draftAgentId out.
 */
export async function fetchDraftAgentId(
  page: Page,
  agentSlug: string,
): Promise<string | null> {
  const resp = await page.request.get(
    `${ADMIN_PROMPTS_URL}/api/admin/prompts/${encodeURIComponent(agentSlug)}/joined`,
  );
  if (!resp.ok()) return null;
  const json = (await resp.json()) as { draftAgentId?: string | null };
  return json.draftAgentId ?? null;
}
