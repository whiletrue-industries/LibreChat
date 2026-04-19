# Admin Feedback Insights Page — Design

**Status:** approved (sections 1–4)
**Date:** 2026-04-19
**Monday:** 2814163946 follow-up (not yet filed as a separate item)
**Repo:** `LibreChat` (main branch, upstream v0.8.4 base)

## Goal

Give admin and product manager a single page in LibreChat that surfaces thumbs-up/down feedback in a way that drives product decisions. Audience is both admin (triage, ops) and PM (insights, prompt/agent iteration), weighted toward PM.

The underlying feedback data already exists — upstream v0.8.4 ships the UI and Mongo schema, and this session wired thumbs into agent messages plus a read-only `GET /api/messages/feedback/analytics` endpoint. This design covers the work *on top of that*: a real dashboard at `/d/feedback`, plus a classification pipeline that turns raw feedback into topic-grouped insights.

Out of scope for this spec: redesigning the thumb UI itself, making the thumb tags configurable at runtime, multi-tenant feedback separation (there is only one Botnim deployment), user-level feedback (e.g. "which users leave bad feedback").

## Headline decisions

1. **Primary slice is Topic** (question subject: "תקציב", "תקנון הכנסת", "ועדת האתיקה", etc.). Endpoint, tool, reason tag, and time are available as filters.
2. **Topic inference is hybrid** — fixed Hebrew taxonomy first pass, LLM fallback for the long tail, weekly cluster-discovery over the long tail to propose new taxonomy entries for admin review.
3. **Full v1 scope** — KPI strip + time-series + topic table + per-tool-call slice + pending-discoveries queue ship together, not incrementally.
4. **Classification runs async** (nightly scheduled ECS task). Chat latency untouched.

## Architecture

Three independent pieces, all running in the existing `librechat-staging-api` / prod ECS cluster. No new services.

### 1. Classification pipeline

A Node script `scripts/classify-feedback-topics.js` run nightly (02:00 local) via EventBridge → `RunTask`. For each assistant message with `feedback` set but no `feedback.topic`, it:

1. Resolves the user's originating question via `parentMessageId`.
2. Runs `taxonomy.match(text)` — keyword/regex scan against a fixed taxonomy stored in `scripts/feedback-topics/taxonomy.js`.
3. On no match → calls an LLM (gpt-4o-mini, Hebrew system prompt, known topic keys passed as enum) which returns either a known key or `other:<short_hebrew_label>`.
4. Writes back `message.feedback.topic`, `message.feedback.topicSource = "taxonomy" | "llm" | "llm-invalid"`, `message.feedback.topicClassifiedAt = now`.

Runs as an ECS Scheduled Task (EventBridge cron → `RunTask`), not a container sidecar — keeps the API container lean and the job retry-safe. Capped at 500 LLM calls per run (env-configurable). Idempotent; re-runs only touch newly-arrived unclassified messages.

### 2. Cluster-discovery pass

Second script `scripts/discover-feedback-clusters.js`, run weekly (Sunday 03:00 local). Pulls the last 7 days of messages labeled `other:*` (i.e. LLM couldn't map to a known topic), collects unique raw sublabels, sends them in a single LLM call for clustering, and upserts proposals into a new Mongo collection `feedbackTopicsPending`. Nothing is auto-promoted — admins approve or reject from the dashboard.

### 3. Dashboard page + API

- Route `/d/feedback` in LibreChat (gated by `SystemRoles.ADMIN`, returns 404 otherwise so the existence of the page isn't advertised).
- Backend: new router `api/server/routes/admin/feedback.js`, mounted at `/api/admin/feedback`:
  - `GET /overview` — KPIs + time-series + topic table + tool-call table in a single aggregation, with optional `?since=&until=&endpoint=&tag=&topic=` filters.
  - `GET /messages` — drill-down list, paginated.
  - `GET /pending-topics` + `POST /pending-topics/:id/approve|reject` — cluster-discovery queue.
- Frontend: `client/src/components/Admin/Feedback/` (see Components section).

### Data model additions

- `messages.feedback.topic?: string` — denormalized label. Indexed (`{ 'feedback.topic': 1, createdAt: -1 }`).
- `messages.feedback.topicSource?: 'taxonomy' | 'llm' | 'llm-invalid' | 'taxonomy-retroactive'`
- `messages.feedback.topicClassifiedAt?: Date`
- New collection `feedbackTopics`: `{ key, labelHe, labelEn, keywords: [RegExp-as-string], active: boolean, createdAt, createdBy }` — source of truth for the taxonomy. Seeded with ~15 initial categories in a migration.
- New collection `feedbackTopicsPending`: `{ proposedKey, labelHe, labelEn, rawLabels: [string], exampleMessageIds: [ObjectId], status: 'pending'|'rejected', proposedAt, reviewedAt?, reviewedBy? }`

## Components

### Frontend

All under `client/src/components/Admin/Feedback/`:

- `FeedbackDashboard.tsx` — route-level container, owns filter state, wires the react-query hook
- `FilterBar.tsx` — date range (7/30/90/custom), endpoint dropdown, reason-tag dropdown, manual refresh
- `KpiStrip.tsx` — 4 cards: total assistant messages, feedback rate, positive %, Δ vs previous period
- `FeedbackTimeSeries.tsx` — recharts `<LineChart>`, two lines (feedback rate, positive %), hover tooltip with raw counts
- `TopicTable.tsx` — headline slice. Sortable. Columns: topic, total, withFeedback, positivePct, 7-day sparkline (inline SVG, no extra lib), last thumbs-down timestamp. Rows for `other:*` topics show a "++promote" affordance.
- `ToolCallChart.tsx` — recharts `<BarChart>` of top-10 tool names by thumbs-down. Clicking a bar filters the topic table above.
- `PendingTopicsQueue.tsx` — only renders if count > 0. Each row: proposed label, N example messages, `[approve]` / `[reject]` buttons.
- `FeedbackDrillDown.tsx` — side sheet opened from TopicTable row click. Scrollable list of recent thumbs-down Q&A pairs for that topic: user question + truncated assistant answer (500 chars) + reason tag + "view in chat" button that opens `/c/<convId>?highlight=<msgId>`.
- `useAdminFeedback.ts` — react-query hook, gets all dashboard data in one call.

All user-facing strings go through `useLocalize()` with new `com_admin_feedback_*` keys in `en/translation.json`.

### Backend

- `api/server/routes/admin/feedback.js` — router, `requireJwtAuth` + `adminOnly` middleware, mounts three controllers
- `api/server/controllers/admin/feedbackController.js` — thin controllers delegating to the service layer
- `api/server/services/FeedbackAnalytics.js` — pure functions `aggregateOverview(filter)`, `listMessagesByFilter(filter, page)`, `approvePendingTopic(id, opts)`. Unit-testable without spinning Express.

### Classification scripts

- `scripts/feedback-topics/taxonomy.js` — exports the fixed taxonomy array `{ key, labelHe, labelEn, keywords: RegExp[] }[]`. Editable; checked into git.
- `scripts/classify-feedback-topics.js` — nightly worker (see Data Flow).
- `scripts/discover-feedback-clusters.js` — weekly worker (see Data Flow).

Both scripts expose their core function as a pure DI-receiving unit: `classifyOne(msg, { llm, db, logger, config })` / `proposeClusters(labels, { llm, db, logger, config })`. Wired to real OpenAI + Mongoose adapters in the CLI entry point. Wired to fakes/mocks in tests.

### ECS Scheduled Tasks (Terragrunt)

Two new `aws_cloudwatch_event_rule` resources in `infra/envs/staging/`:

- `librechat-feedback-classify` — cron `0 2 * * ? *` (02:00 daily), targets `RunTask` on the existing `librechat-staging-api` task definition with container command override `["node","scripts/classify-feedback-topics.js"]`.
- `librechat-feedback-discover` — cron `0 3 ? * SUN *` (03:00 Sunday), same pattern with `["node","scripts/discover-feedback-clusters.js"]`.

Prod module copy added once staging is proven.

## Data flow

### User leaves feedback (existing path — no change)

1. User hovers assistant message → clicks ⬆️ "Love this" → picks a tag.
2. Frontend `handleFeedback` fires `useUpdateFeedbackMutation` → `PUT /api/messages/:convId/:msgId/feedback`.
3. `updateMessage()` writes `messages.feedback = { rating, tag, text? }`.
4. No topic classification happens inline — chat latency untouched. Topic stays `undefined` until the nightly job picks it up.

### Nightly classification

1. EventBridge cron fires → ECS `RunTask`.
2. Script connects to Mongo, streams `Message.find({ isCreatedByUser: false, feedback: { $exists: true }, 'feedback.topic': { $exists: false } })` in batches of 50.
3. For each message:
   - Resolve parent user message text.
   - `taxonomy.match(text)` → on match, write `{ topic: <key>, topicSource: 'taxonomy' }`.
   - On no match → LLM classify (3-try backoff 2s/6s/18s on HTTP errors). Write `{ topic: <key-or-"other:<label>">, topicSource: 'llm' }`.
   - Garbage LLM response → `{ topic: 'unknown', topicSource: 'llm-invalid' }` + log raw response.
   - Missing parent → `{ topic: 'unknown', topicSource: 'taxonomy' }` (so it's not re-queried).
4. Sleep 3s between batches. Hard cap at 500 LLM calls per run; exit cleanly on cap reached.
5. Structured JSON log per processed message. Exit code 0 (success), 1 (hard error), 2 (rate-limit or cap hit). EventBridge alarm on non-zero for 3 consecutive runs.

### Weekly cluster-discovery

1. EventBridge cron fires → ECS `RunTask`.
2. Pull last 7 days of `feedback.topicSource === 'llm'` AND `feedback.topic` starts with `other:`.
3. Collect unique raw sublabels + example msgIds.
4. Single LLM call: "cluster these Hebrew labels, propose canonical keys, return JSON".
5. Upsert into `feedbackTopicsPending` with `status: 'pending'`, 5 example msg IDs per cluster.
6. Zero new labels → log "no new clusters", exit 0.
7. Malformed LLM JSON → log raw response, exit 2 (no partial writes).

### Dashboard load

1. Browser navigates to `/d/feedback`.
2. React guard: `role === ADMIN`? No → redirect to `/c/new` silently.
3. Yes → mount `FeedbackDashboard`, which fires `GET /api/admin/feedback/overview?since=...&until=...&endpoint=agents`.
4. Backend runs a single Mongo aggregation with `$facet` over four pipelines (kpis, timeSeries, byTopic, byTool) + a count of pending topics.
5. Response shape:
   ```
   { range: { since, until },
     kpis: { total, withFeedback, feedbackRate, positivePct, deltaVsPrev },
     timeSeries: [{ date, total, withFeedback, up, down }],
     byTopic: [{ topic, total, withFeedback, positivePct, lastThumbsDownAt, sparkline: [7 nums] }],
     byTool: [{ toolName, total, thumbsDown }],
     pendingTopicsCount: 3 }
   ```
6. Widgets render. Clicking a topic row fires `GET /api/admin/feedback/messages?topic=<key>&rating=thumbsDown&page=1` → side sheet.
7. `staleTime: 5 min` on overview; per-(topic, page, rating) cache on drill-down.

### Approve a pending topic

1. Admin clicks `[Approve]` on a pending row.
2. Frontend fires `POST /api/admin/feedback/pending-topics/:id/approve?rewrite=true`.
3. Controller:
   - Read the pending doc.
   - Insert a new `feedbackTopics` doc with the proposed key, labels, `keywords: []`, `active: true`.
   - If `rewrite=true`, `Message.updateMany({ 'feedback.topic': { $in: rawLabels } }, { $set: { 'feedback.topic': proposedKey, 'feedback.topicSource': 'taxonomy-retroactive' } })`.
   - Delete the pending doc.
4. Frontend invalidates `['admin-feedback-overview']` — topic table reflects the promotion on next render.

## Error handling

**Classification script**
- Per-message try/catch — one bad doc does not halt the batch.
- LLM HTTP errors → 3-try backoff (2s / 6s / 18s), then skip + log.
- Garbage LLM response → `topic: 'unknown'`, source `'llm-invalid'`, raw logged.
- OpenAI 429 → exit 2.
- Mongo drop → reconnect once, else exit 1.
- No partial writes per document.

**Cluster-discovery script**
- Same LLM backoff.
- Malformed JSON → exit 2, no pending writes.
- Zero labels → exit 0 with log.

**API endpoints**
- 403 if not ADMIN.
- 400 on bad `since` / `until` parse.
- 500 on aggregation failure; client shows inline banner with retry.
- Empty result → 200 zeroed; UI shows empty state.

**Frontend**
- react-query default retry.
- 403 → redirect to `/c/new` + toast "Admin access required".
- Drill-down failure is isolated to its own side sheet.

## Testability

Every new component must be exercisable without waiting for cron, without calling OpenAI, and without touching staging Mongo.

### Scripts

- Core functions `classifyOne(msg, deps)` / `proposeClusters(labels, deps)` — pure, DI-receiving. `deps = { llm, db, logger, config }`.
- LLM adapter interface: `{ classify(prompt, enum) → Promise<string> }`. One real adapter, one `test/fakes/fakeLlm.js` that returns canned responses keyed by input prefix — deterministic, no network.
- Mongo adapter interface: `{ findUnclassifiedFeedback, getUserMessage, updateMessageTopic, insertPendingTopic }`. Real + in-memory-array fakes.

**Unit tests**
- `taxonomy.match(text)` — regex coverage, edge cases (empty, mixed LTR/RTL, punctuation, nikud).
- `classifyOne()` — taxonomy hit, LLM fallback, LLM 429, LLM garbage, missing parent.
- `proposeClusters()` — duplicate synonyms, too few labels, malformed LLM JSON.

**Integration tests** (per CLAUDE.md "real logic over mocks" — use `mongodb-memory-server`)
- Seed ~30 messages with a mix of feedback / no-feedback / Hebrew / English.
- Run `node scripts/classify-feedback-topics.js --mongo-uri=$MEMSERVER --llm=fake --limit=10`.
- Assert on actual Mongo state after.
- **Idempotency**: run twice against the same seed, assert second run is a no-op (zero LLM calls, zero updates).

**On-demand invocation flags (manual testability)**
- `--dry-run` — prints what would be updated, writes nothing.
- `--message-id=<id>` — classify one specific message.
- `--since=YYYY-MM-DD --limit=50` — targeted run.
- `--llm=fake` or `LLM_PROVIDER=fake` env — use the fake adapter end-to-end.
- `--mongo-uri=...` env — point at any Mongo, not just prod.

### Cron / EventBridge

1. `terragrunt validate` in CI.
2. Snapshot tests against the rendered `aws_cloudwatch_event_rule` + `aws_cloudwatch_event_target` config (golden JSON).
3. **Force-run in staging**: `aws ecs run-task ... overrides='{"command":["node","scripts/classify-feedback-topics.js","--dry-run","--limit=5"]}'` — triggers the exact prod invocation path without waiting for 02:00.
4. Deploy pipeline runs step 3 automatically after every staging deploy and fails the build if exit code ≠ 0. Proves the image can actually run the scripts before the first scheduled fire.

### API

- `supertest` against the Express app (pattern already in `api/test/`), `mongodb-memory-server` per test file.
- `buildFeedbackFixture()` helper: 3 users, 50 messages across 3 topics, varied feedback.
- Test matrix: filter combinations (date, endpoint, tag, topic), 403 for non-admin, pagination edges, empty result, timezone handling for `since`/`until` DST boundaries.

### Frontend

- Each widget rendered in isolation with mocked data via `test/layout-test-utils`.
- Loading / success / error / empty states covered (CLAUDE.md rule).
- `FeedbackDashboard.spec.tsx` mounts the whole page with a mocked react-query cache + mocked admin role; asserts filter-bar round-trips update query params + refetch.
- Keyboard navigation + focus-trap on side sheet + Hebrew `aria-label`s via `useLocalize`.

### End-to-end dress rehearsal (manual, documented in staging README)

1. `aws ecs run-task ... --overrides='{"command":["node","scripts/classify-feedback-topics.js","--limit=100"]}'` — classify real staging Mongo, watch CloudWatch.
2. Open `https://botnim.staging.build-up.team/d/feedback` as admin, confirm topic table populates.
3. `aws ecs run-task ... --overrides='{"command":["node","scripts/discover-feedback-clusters.js","--dry-run"]}'` — dry-run cluster-discovery, inspect proposed clusters in log.
4. Re-run without `--dry-run`, confirm pending-topics section appears on the dashboard.

## Open questions / deferred

- The 15 initial taxonomy categories need a product-side review with a Hebrew-speaking PM before we hardcode them. Put the first pass in the taxonomy file, but treat it as a v1 best-guess — rev it based on real cluster-discovery output in the first few weeks.
- LLM model choice (gpt-4o-mini) is a default; could swap to Claude Haiku if cost/quality reads better. Not blocking this design.
- No alerting wired in v1 beyond the EventBridge alarm on 3 consecutive non-zero script exits. If PM wants a "thumbs-down spike in topic X" alert, that's v2.
- No CSV/Sheets export of the topic table. If PM asks, it's an easy follow-up (one more endpoint + a download button).
