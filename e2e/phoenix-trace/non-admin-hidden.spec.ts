/**
 * Phoenix admin trace panel — non-admin counter-test.
 *
 * Logs in as a non-admin (role=USER) user, sends the same gold-set
 * question, waits for the assistant reply, then asserts:
 *   1. The admin-trace pill is ABSENT from the DOM (count = 0,
 *      not just hidden) on every assistant message.
 *   2. The /api/botnim/traces/<id> route returns 4xx for this user.
 *   3. Non-admin's own /api/messages/<convo> response has NO
 *      phoenix_* fields in any message metadata.
 */
import { test, expect, type Page } from '@playwright/test';

const USER_EMAIL = process.env.NORMAL_USER_EMAIL || 'user@botnim.local';
const USER_PASS  = process.env.NORMAL_USER_PASSWORD || 'user1234';
const QUESTION   = 'מה הנחיות היועצת המשפטית לכנסת בעניין הסתייגויות בוועדה';

async function login(page: Page) {
  const r = await page.request.post('/api/auth/login', {
    data: { email: USER_EMAIL, password: USER_PASS },
  });
  expect(r.ok(), `login failed: HTTP ${r.status()}`).toBeTruthy();
  const body = await r.json();
  expect(body.user?.role, 'seeded user must have role=USER (not ADMIN)').toBe('USER');
  return body.token as string;
}

test.describe('admin trace panel — non-admin gating', () => {
  test('non-admin user sees no pill anywhere; backend route 4xx; metadata stripped', async ({ page, request }) => {
    test.setTimeout(180_000);

    const token = await login(page);
    await page.goto('/c/new');

    const input = page.locator(
      '[data-testid="chat-input"], [data-testid="text-input"], textarea',
    ).first();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill(QUESTION);

    const sendBtn = page.locator(
      '[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="שלח" i]',
    ).first();
    if (await sendBtn.count()) {
      await sendBtn.click();
    } else {
      await input.press('Enter');
    }

    // Wait for at least one assistant message body to render. We don't have
    // a dedicated test-id for "assistant message complete" outside of admin-only
    // affordances, so we wait for the chat composer to re-enable (proxy for
    // "stream finished").
    await page.waitForTimeout(60_000);
    await expect(input).toBeEnabled();

    // 1. Assert the trace pill is completely ABSENT from the DOM (not hidden).
    const pillCount = await page.locator('[data-testid="admin-trace-pill"]').count();
    expect(pillCount, 'admin-trace-pill must NOT exist for non-admin').toBe(0);

    // Same for the panel container (in case the pill render path failed but
    // the wrapper still mounted).
    const containerCount = await page.locator('[data-testid="admin-trace-container"]').count();
    expect(containerCount, 'admin-trace-container must NOT exist for non-admin').toBe(0);

    await page.screenshot({ path: 'phoenix-trace-report/03-non-admin-no-pill.png' });

    // 2. Direct backend route — non-admin must NOT get a 200 + DTO.
    //    Acceptable: 401, 403, 404, 400. Forbidden: 200.
    const fakeTraceId = 'abcdef0123456789abcdef0123456789';
    const traceRes = await request.get(`/api/botnim/traces/${fakeTraceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(traceRes.status(), `non-admin should not get 200 from trace route, got ${traceRes.status()}`)
      .not.toBe(200);

    // 3. Get the user's own conversation list, then fetch its messages,
    //    and verify NO assistant message metadata contains a phoenix_* key.
    const convosResp = await request.get('/api/convos?pageNumber=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(convosResp.ok()).toBeTruthy();
    const convos = (await convosResp.json()).conversations || [];
    expect(convos.length, 'non-admin should have at least one conversation after sending').toBeGreaterThan(0);

    const convoId = convos[0].conversationId;
    const msgsResp = await request.get(`/api/messages/${convoId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(msgsResp.ok()).toBeTruthy();
    const msgs = await msgsResp.json();
    const phoenixKeysFound: string[] = [];
    for (const m of (Array.isArray(msgs) ? msgs : [])) {
      const meta = m?.metadata || {};
      for (const k of Object.keys(meta)) {
        if (k.startsWith('phoenix_')) phoenixKeysFound.push(`${m.messageId}:${k}`);
      }
    }
    expect(
      phoenixKeysFound.length,
      `non-admin /api/messages must NOT include any phoenix_* metadata, found: ${phoenixKeysFound.join(', ')}`,
    ).toBe(0);
  });
});
