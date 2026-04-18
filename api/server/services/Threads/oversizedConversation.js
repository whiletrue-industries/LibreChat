/**
 * Handle the "conversation is too long for the model" failure mode.
 *
 * After we dropped the per-turn history caps, any single `responses.create`
 * call can trip OpenAI's TPM ceiling (200 000 tokens/min on gpt-5.4-mini)
 * or the model's context-length limit. Rather than enforce a silent
 * truncation — which users don't notice — we let the call fail, then
 * tell the user what happened and offer a recap they can seed a new
 * chat with.
 *
 * We intentionally do NOT make a second OpenAI call to summarize: the
 * conversation is already oversized, so a "summarize this" request
 * would very likely fail with the same error. Instead we build a
 * topic-outline from local MongoDB data — first line of each user
 * message, one-sentence extract from each assistant reply — which is
 * cheap, never fails, and is enough for the user to reconstruct the
 * thread in a fresh conversation.
 */

const CONVERSATION_TOO_LONG_HEBREW = [
  'השיחה הזו הפכה ארוכה מדי בשביל המודל לעבד אותה בבת אחת.',
  'כדי להמשיך, עדיף לפתוח שיחה חדשה. הנה סיכום של מה שעלה עד עכשיו שתוכלו להדביק בהתחלה של השיחה הבאה:',
].join('\n\n');

const CONVERSATION_TOO_LONG_ENGLISH = [
  'This conversation has grown too long for the model to process in one shot.',
  'To continue, you\'ll get better results in a fresh conversation. Here\'s a recap of what we covered so far that you can paste at the start of the new one:',
].join('\n\n');

const MAX_PREVIEW_CHARS = 240;

/**
 * Rate-limit error (HTTP 429 / TPM). Transient — the same request will
 * succeed after a backoff. Retry policy matches OpenAI's own Tenacity
 * example in the rate-limits guide: exponential backoff with random
 * jitter, min 1 s, max 60 s, up to 6 attempts (initial + 5 retries).
 *   https://developers.openai.com/api/docs/guides/rate-limits
 */
function isRateLimitError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? err.code;
  const msg = (err.message || '').toLowerCase();
  if (status === 429) return true;
  if (typeof status === 'string' && status.toLowerCase().includes('ratelimit')) return true;
  if (msg.includes('rate limit')) return true;
  if (msg.includes('tokens per min')) return true;
  return false;
}

/**
 * Hard context-length exceeded (HTTP 400 with code
 * ``context_length_exceeded``). Not recoverable by retry — the prompt
 * is genuinely too big for the model. Fall through to the recap path.
 */
function isContextLengthError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toString().toLowerCase();
  if (status === 400 && code.includes('context_length')) return true;
  if (msg.includes('context length')) return true;
  if (msg.includes('maximum context length')) return true;
  return false;
}

/**
 * Convenience: either kind of "conversation too long" error that
 * should surface a recap to the user (after any retries are exhausted
 * for the rate-limit case).
 */
function isConversationTooLongError(err) {
  return isRateLimitError(err) || isContextLengthError(err);
}

/**
 * Compute the Nth backoff delay (ms) for the retry loop. Matches
 * Tenacity's ``wait_random_exponential(min=1, max=60)`` semantics as
 * used in OpenAI's example: ``U(0, min(max_wait, base * 2**attempt))``.
 *
 * @param {number} attempt - 0-indexed retry attempt (0 = first retry).
 * @param {{minMs?: number, maxMs?: number}} [opts]
 */
function computeBackoffDelayMs(attempt, { minMs = 1000, maxMs = 60000 } = {}) {
  const upper = Math.min(maxMs, minMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * upper);
}

/**
 * Retry an async function on rate-limit errors with OpenAI's
 * recommended exponential-backoff-with-jitter strategy.
 *
 * @param {() => Promise<T>} fn - async function to invoke
 * @param {{
 *   maxAttempts?: number,
 *   minBackoffMs?: number,
 *   maxBackoffMs?: number,
 *   onRetry?: (err: Error, attempt: number, delayMs: number) => void
 * }} [opts]
 * @returns {Promise<T>}
 */
async function retryOnRateLimit(fn, opts = {}) {
  const {
    maxAttempts = 6,
    minBackoffMs = 1000,
    maxBackoffMs = 60000,
    onRetry,
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      // Only rate-limit errors are retryable. Context-length and every
      // other error propagate so the caller can route them (recap for
      // context-length, generic error path for the rest).
      if (!isRateLimitError(err) || attempt === maxAttempts - 1) {
        throw err;
      }
      const delay = computeBackoffDelayMs(attempt, { minMs: minBackoffMs, maxMs: maxBackoffMs });
      if (typeof onRetry === 'function') {
        try {
          onRetry(err, attempt, delay);
        } catch (_) { /* ignore hook errors */ }
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // unreachable — the final attempt re-raises — but keeps return type happy
  throw lastErr;
}

/** Trim a string to a printable preview (no mid-word cuts when possible). */
function preview(text, limit = MAX_PREVIEW_CHARS) {
  if (!text) return '';
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= limit) return single;
  const cut = single.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Build a user-facing recap from the already-hydrated history.
 *
 * @param {Array<{role:'user'|'assistant', content:string}>} priorMessages
 * @param {string} currentUserText - the turn we couldn't answer
 * @returns {string} Hebrew-leaning recap, UI-renderable as markdown.
 */
function buildRecap(priorMessages, currentUserText) {
  const bullets = [];
  for (const m of priorMessages) {
    const role = m.role === 'user' ? '👤' : '🤖';
    bullets.push(`- ${role} ${preview(m.content)}`);
  }
  if (currentUserText) {
    bullets.push(`- 👤 (שאלה נוכחית שלא נענתה) ${preview(currentUserText)}`);
  }

  const header = `${CONVERSATION_TOO_LONG_HEBREW}\n\n---\n\n*${CONVERSATION_TOO_LONG_ENGLISH}*\n\n---`;
  return `${header}\n\n${bullets.join('\n')}`;
}

module.exports = {
  isRateLimitError,
  isContextLengthError,
  isConversationTooLongError,
  computeBackoffDelayMs,
  retryOnRateLimit,
  buildRecap,
  CONVERSATION_TOO_LONG_HEBREW,
  CONVERSATION_TOO_LONG_ENGLISH,
};
