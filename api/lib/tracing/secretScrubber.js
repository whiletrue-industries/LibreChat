const SECRET_KEYS = new Set([
  'http.request.header.authorization',
  'http.request.header.cookie',
  'http.request.header.set-cookie',
  'http.request.header.x-api-key',
  'http.request.header.openai-api-key',
  'http.response.header.set-cookie',
  'openai.api_key',
  'db.connection_string',
]);
const PATTERNS = [
  /sk-[A-Za-z0-9_\-]{12,}/g,
  /Bearer\s+[A-Za-z0-9_\-\.]+/gi,
  /session=[^;\s]+/gi,
  /:\/\/[^/@:]+:[^@]+@/g,
  /api[_-]?key=[^&\s]+/gi,
];
const REDACTED = '[REDACTED]';
class SecretScrubbingSpanProcessor {
  constructor(inner) { this.inner = inner; }
  forceFlush() { return this.inner.forceFlush(); }
  shutdown()   { return this.inner.shutdown(); }
  onStart(span, ctx) { this.inner.onStart && this.inner.onStart(span, ctx); }
  onEnd(span) {
    const a = span.attributes || {};
    for (const k of Object.keys(a)) {
      if (SECRET_KEYS.has(k.toLowerCase())) { a[k] = REDACTED; continue; }
      if (typeof a[k] === 'string') {
        let v = a[k];
        for (const p of PATTERNS) v = v.replace(p, REDACTED);
        if (v !== a[k]) a[k] = v;
      }
    }
    this.inner.onEnd(span);
  }
}
module.exports = { SecretScrubbingSpanProcessor };
