const express = require('express');
const nodeFetch = require('node-fetch');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');

const router = express.Router();

router.get('/:traceId', requireJwtAuth, checkAdmin, async (req, res) => {
  const { traceId } = req.params;
  if (!/^[0-9a-f]{32}$/i.test(traceId)) {
    return res.status(400).json({ error: 'bad trace id' });
  }

  const endpoint = process.env.PHOENIX_GRAPHQL_ENDPOINT || 'http://phoenix:6006/graphql';
  // Phoenix v7 schema: Query.projects → Project.trace(traceId:) → Trace.spans
  // (Span has parentId + context{spanId,traceId} + spanKind + statusCode +
  //  startTime/endTime + attributes-as-JSON-string + name.)
  const query = `
    query($tid: ID!) {
      projects(first: 5) {
        edges { node { name trace(traceId: $tid) { spans(first: 200) { edges { node {
          name parentId spanKind statusCode startTime endTime
          context { spanId traceId } attributes
        } } } } } }
      }
    }
  `;
  let phoenixResp;
  try {
    const fetchFn = typeof global.fetch === 'function' ? global.fetch : nodeFetch;
    const r = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { tid: traceId } }),
    });
    phoenixResp = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: 'phoenix upstream', status: r.status, detail: phoenixResp });
    }
  } catch (e) {
    return res.status(502).json({ error: 'phoenix unreachable', detail: e.message });
  }

  // Find the project that returned a non-empty trace.spans (the trace lives
  // in exactly one project; we don't know which one a-priori).
  const edges = phoenixResp?.data?.projects?.edges || [];
  let projectName = null;
  let spans = [];
  for (const e of edges) {
    const t = e?.node?.trace?.spans?.edges || [];
    if (t.length) {
      projectName = e.node.name;
      spans = t.map((x) => x.node);
      break;
    }
  }
  if (!spans.length) {
    return res.status(404).json({ error: 'trace not found in phoenix', raw: phoenixResp });
  }

  const dto = transformToDto(spans, traceId, process.env.ENVIRONMENT || 'local', projectName);
  res.json(dto);
});

function transformToDto(spans, traceId, env, projectName) {
  // Phoenix returns attributes as a JSON-encoded string; decode lazily.
  const safeParse = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  spans.forEach((s) => {
    s._attrs = safeParse(s.attributes);
    s._spanId = s.context?.spanId;
    s._startMs = Date.parse(s.startTime);
    s._endMs = Date.parse(s.endTime);
    s._durMs = Math.max(0, s._endMs - s._startMs);
  });
  const root = spans.find((s) => !s.parentId) || spans[0];
  const totalMs = Math.max(...spans.map((s) => s._endMs)) - root._startMs;

  // Build a parentId → [children] index for stage lookups.
  const childrenByParent = {};
  for (const s of spans) {
    if (s.parentId) {
      (childrenByParent[s.parentId] = childrenByParent[s.parentId] || []).push(s);
    }
  }

  const rootStartMs = root._startMs;
  const steps = spans
    .map((s) => enrichStep(classifyKind(s), s, childrenByParent, rootStartMs))
    .sort((a, b) => a.tStartMs - b.tStartMs);

  return { traceId, env, projectName, totalMs, steps, spanCount: spans.length };
}

/**
 * Build a structured step object from a raw Phoenix span.
 * Fields are only set when the underlying data is available —
 * the React UI conditionally renders based on presence.
 */
function enrichStep(kind, span, childrenByParent, rootStartMs) {
  const base = {
    kind,
    spanId: span._spanId,
    parentId: span.parentId || null,
    name: span.name,
    spanKind: span.spanKind,
    statusCode: span.statusCode,
    tStartMs: span._startMs - rootStartMs,
    durationMs: span._durMs,
    attrs: span._attrs,
  };

  if (kind === 'llm') {
    // Semantic attributes written by our retrospective span emitter or by
    // opentelemetry-instrumentation-openai.
    const a = span._attrs || {};
    const model =
      a['llm.model_name'] ||
      a['gen_ai.request.model'] ||
      a['llm.request.model'] ||
      undefined;
    const prompt =
      a['llm.token_count.prompt'] ||
      a['gen_ai.usage.prompt_tokens'] ||
      a['llm.usage.prompt_tokens'] ||
      undefined;
    const completion =
      a['llm.token_count.completion'] ||
      a['gen_ai.usage.completion_tokens'] ||
      a['llm.usage.completion_tokens'] ||
      undefined;
    const total =
      a['llm.token_count.total'] ||
      (prompt != null && completion != null ? prompt + completion : undefined);

    // Tool calls the LLM decided to make (from openinference schema).
    const toolCallsRaw = a['llm.output_messages.0.message.tool_calls'];
    let toolCalls;
    if (toolCallsRaw) {
      try {
        const parsed = typeof toolCallsRaw === 'string' ? JSON.parse(toolCallsRaw) : toolCallsRaw;
        if (Array.isArray(parsed)) {
          toolCalls = parsed.map((tc) => ({
            name: tc?.tool_call?.function?.name || tc?.name || '',
            args: tc?.tool_call?.function?.arguments || tc?.args || '',
          }));
        }
      } catch { /* best-effort */ }
    }

    return Object.assign(base, {
      model,
      tokens: (prompt != null || completion != null || total != null)
        ? { prompt, completion, total }
        : undefined,
      toolCalls: toolCalls || null,
    });
  }

  if (kind === 'tool' || kind === 'tool_retrieve') {
    // Phoenix returns OpenInference attrs as a NESTED JSON tree
    // (e.g. { tool: { name, response: { preview } }, retrieval: { documents: { count } } })
    // — read both nested and flat key forms.
    const get = (obj, path) => {
      let cur = obj;
      for (const k of path.split('.')) {
        if (cur == null) return undefined;
        cur = cur[k];
      }
      return cur;
    };
    const a = span._attrs || {};
    const toolName =
      a['tool.name'] || get(a, 'tool.name') || span.name || '';
    const toolParams =
      a['tool.parameters'] || get(a, 'tool.parameters') ||
      a['tool.input'] || get(a, 'tool.input') ||
      undefined;
    const httpUrl = a['http.url'] || get(a, 'http.url');
    const responsePreview =
      a['tool.response.preview'] || get(a, 'tool.response.preview') ||
      a['tool.response'] || get(a, 'tool.response');
    const docsCount =
      a['retrieval.documents.count'] || get(a, 'retrieval.documents.count');

    // Parse the response preview (YAML "- header: ...\n  text: ..." format)
    // into a docs[] list when possible, so RetrieveDetail can render rows.
    let docs;
    if (typeof responsePreview === 'string' && responsePreview.length > 10) {
      docs = parseDocPreviews(responsePreview);
    }

    // Gather sub-stage durations from child spans (embed, rrf.fuse, db.* …)
    const children = childrenByParent[span._spanId] || [];
    const stages = {};
    for (const child of children) {
      const n = (child.name || '').toLowerCase();
      if (n === 'embed' || n.includes('embedding')) {
        stages.embed = (stages.embed || 0) + child._durMs;
      } else if (n === 'rrf.fuse' || n.includes('rrf')) {
        stages.rrf = (stages.rrf || 0) + child._durMs;
      } else if (n.startsWith('select ') || n.startsWith('insert ') || n.includes('sql')) {
        stages.vector = (stages.vector || 0) + child._durMs;
      } else if (n.includes('bm25') || n.includes('full_text')) {
        stages.bm25 = (stages.bm25 || 0) + child._durMs;
      }
    }

    return Object.assign(base, {
      toolName,
      args: toolParams || (httpUrl ? extractQueryFromUrl(httpUrl) : undefined),
      stages: Object.keys(stages).length ? stages : undefined,
      docs: docs && docs.length ? docs : undefined,
      docsCount: docsCount,
      httpUrl,
    });
  }

  if (kind === 'retrieve_stage') {
    // A sub-span of a retrieve (rrf.fuse, embed, db.select …) — minimal enrichment.
    return base;
  }

  return base;
}

function classifyKind(span) {
  const n = span.name || '';
  const nLow = n.toLowerCase();
  const sk = (span.spanKind || '').toUpperCase();
  const a = span._attrs || {};
  // Read the tool.name attribute (Phoenix returns it as nested attrs.tool.name)
  const toolName = a['tool.name'] || (a.tool && a.tool.name) || '';
  const httpUrl = a['http.url'] || (a.http && a.http.url) || '';

  // ---- Promote botnim-retrieve tool calls to the rich tool_retrieve kind ----
  // (so the React UI dispatches to ToolRetrieveDetail with stage bars + docs).
  if (n === 'tool.call' && (
    toolName.startsWith('search_') ||
    /\/botnim\/retrieve\//i.test(httpUrl)
  )) {
    return 'tool_retrieve';
  }

  // ---- Name-first rules (most specific) ----
  if (n === 'chat.turn') return 'chain';
  if (n === 'llm.completion') return 'llm';
  if (n === 'tool.call') return 'tool';
  if (/^(POST|GET)\s+\/botnim\/retrieve\//i.test(n)) return 'tool_retrieve';
  if (n === 'rrf.fuse') return 'retrieve_stage';
  if (n === 'embed' || nLow.includes('embedding')) return 'embedding';
  if (/^(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i.test(n)) return 'db';

  // ---- spanKind rules (set by OTel SDK) ----
  if (sk === 'LLM') return 'llm';
  if (sk === 'TOOL') return 'tool';
  if (sk === 'RETRIEVER') return 'retrieve';
  if (sk === 'EMBEDDING') return 'embedding';
  if (sk === 'CHAIN') return 'chain';

  // ---- OpenInference attribute fallback (older instrumentations) ----
  const ak = (span._attrs?.['openinference']?.['span']?.['kind'] || '').toUpperCase();
  if (ak === 'LLM') return 'llm';
  if (ak === 'TOOL') return 'tool';
  if (ak === 'RETRIEVER') return 'retrieve';
  if (ak === 'EMBEDDING') return 'embedding';

  // ---- Heuristic by name for raw HTTP / other spans ----
  if (nLow.startsWith('post ') || nLow.startsWith('get ') || nLow.includes('http')) return 'http';
  if (nLow.includes('retrieve')) return 'retrieve';
  return 'other';
}

/**
 * Extract `query=...` from a botnim /retrieve URL into { query }.
 */
function extractQueryFromUrl(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('query');
    return q ? { query: q } : undefined;
  } catch { return undefined; }
}

/**
 * Parse a botnim /retrieve YAML-text response preview into a docs[] list.
 * Format is roughly: "- header: <title>\n  text: <content>\n- header: ..."
 * Score isn't in the payload (the API doesn't return scores in text-short
 * format), so we leave score=null and let the UI render rows without scores.
 */
function parseDocPreviews(text) {
  if (typeof text !== 'string') return [];
  const docs = [];
  const blocks = text.split(/\n(?=- header:)/);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block.startsWith('- header:')) continue;
    // Split into header line + the rest (which is typically "  text: '<body>'").
    // The text body can be multi-line; we keep everything after the header
    // line as the full doc text the modal will render.
    const lines = block.split(/\n/);
    const headerLine = lines[0].replace(/^- header:\s*/, '').trim();
    const title = headerLine.replace(/^['"]/, '').replace(/['"]$/, '');
    // Extract body — strip the leading "  text: " prefix if present, and
    // the surrounding quotes YAML adds for multi-line scalars.
    let body = lines.slice(1).join('\n').replace(/^\s*text:\s*/, '');
    // Strip surrounding single/double quotes if present
    body = body.replace(/^['"]/, '').replace(/['"]$/, '');
    // Unescape YAML-doubled single quotes
    body = body.replace(/''/g, "'");
    if (title) {
      docs.push({
        score: null,
        name: title.length > 120 ? title.slice(0, 120) + '…' : title,
        chunkId: `chunk-${i}`,
        cited: false,
        text: body || title, // fallback to title if no body parsed
      });
    }
  }
  return docs;
}

module.exports = router;
