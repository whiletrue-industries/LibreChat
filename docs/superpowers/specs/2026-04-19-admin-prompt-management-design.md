# Admin Prompt Management UI — Design

**Status:** approved (sections 1-6)
**Date:** 2026-04-19
**Branch target:** new feature branch off `main`
**Spec source:** superseded `specs/PROMPT_WORKFLOW.md` (which stays as a README for git-level workflow); this design moves the source of truth for prompts from `specs/*/agent.txt` → MongoDB.

## Goal

Let an admin edit each section of each Botnim agent's system prompt from a web UI, at `/d/prompts`, with audit-by-row, preview-against-test-questions, and publish-with-optimistic-concurrency. Propagation to the live LibreChat agent is ~3s instead of requiring a deploy. Git history is preserved via a nightly export job.

Out of scope: non-admin access, multi-agent approvals, cross-environment promotion (staging → prod), prompt templating or variables.

## Headline decisions

1. **Per-section granularity.** Each `##` section in the existing agent.txt files becomes a row. Non-Markdown-headed text (budgetkey) gets manually segmented into sections for the migration.
2. **Stable section keys via markers.** Each section is prefixed with `<!-- SECTION_KEY: snake_case_key -->`. Rename-safe forever; ~30 tokens of LLM overhead across the 3 agents combined.
3. **Full Draft → Preview → Publish workflow** (Approach C from brainstorming). Preview runs the canned test questions against a shadow agent; side-by-side diff with the current-active responses.
4. **MongoDB, not Postgres.** Same DB as `messages`, `feedbackTopics`, and `feedbackTopicsPending`. Zero new infra.
5. **Row-per-version = audit trail.** No separate history table. `active: true` is a partial-indexed flag scoped to `(agentType, sectionKey)`.
6. **Nightly git export** from DB → `specs/*/agent.txt` → auto-commit + push to `rebuilding-bots` main. Keeps `git log` as a rollback backstop and lets offline reviewers still read prompts.
7. **Change-note required on Publish**, optional on Save Draft. Restore requires a confirmation modal (rollback bypasses preview).

## Architecture

Three pieces. Same shape as the feedback dashboard so we reuse infra.

### 1. Admin UI

React page at `/d/prompts`, gated by `SystemRoles.ADMIN` (same pattern as `/d/feedback`).

Component tree (all under `client/src/components/Admin/Prompts/`):
- `PromptsDashboard.tsx` — route-level container, lists the 3 agents.
- `PromptSectionList.tsx` — collapsible per-agent section tree. Columns: section key, header text, reorder handle, last-edited timestamp, "has draft" badge.
- `PromptEditor.tsx` — Monaco editor (`dir="rtl"` aware), Save Draft + Publish buttons, required change-note field on Publish.
- `PromptDiff.tsx` — Monaco diffEditor, toggleable: active ↔ draft, or active ↔ any prior version.
- `PromptPreview.tsx` — test-question runner + side-by-side response comparison (tool traces + final answers).
- `PromptHistory.tsx` — version timeline with Restore action + change-note column.
- `TestQuestions.tsx` — settings panel to CRUD `promptTestQuestions`.

All user-facing strings via `useLocalize()` with `com_admin_prompts_*` keys.

### 2. Backend service + routes

Service (`packages/api/src/admin/prompts/`):
- `PromptsService.ts` — `getActiveSections`, `getSectionHistory`, `saveDraft`, `publish`, `preview`, `restore`.
- `assemble.ts` — pure function: ordered sections → single Hebrew string (with `<!-- SECTION_KEY --> marker preserved for round-trip integrity).
- `shadowAgent.ts` — creates/tears down a temporary LibreChat agent for preview.

Routes (`api/server/routes/admin/prompts.js`) — thin JS wrappers, all behind `requireJwtAuth + checkAdmin`:

```
GET    /api/admin/prompts/agents
GET    /api/admin/prompts/:agent/sections
GET    /api/admin/prompts/:agent/sections/:key/versions
POST   /api/admin/prompts/:agent/sections/:key/drafts      { body, changeNote? }
POST   /api/admin/prompts/:agent/sections/:key/publish     { parentVersionId, body, changeNote }
POST   /api/admin/prompts/:agent/sections/:key/preview     { body }
POST   /api/admin/prompts/:agent/sections/:key/restore     { versionId, changeNote }
GET    /api/admin/prompts/:agent/test-questions
PUT    /api/admin/prompts/:agent/test-questions            { questions: [...] }
```

### 3. Prompt store + git export

MongoDB collection `prompts`:

```ts
{
  _id: ObjectId,
  agentType: 'unified' | 'takanon' | 'budgetkey',
  sectionKey: string,          // matches <!-- SECTION_KEY: xxx --> marker
  ordinal: number,
  headerText: string,          // e.g. "## Core Characteristics"
  body: string,
  active: boolean,
  isDraft: boolean,
  parentVersionId: ObjectId?,  // optimistic concurrency
  changeNote: string?,
  createdAt: Date,
  createdBy: ObjectId,
  publishedAt: Date?,
}
```

Indexes:
- Partial `{ agentType: 1, sectionKey: 1 }` where `active: true` → O(1) active lookup
- `{ agentType: 1, sectionKey: 1, createdAt: -1 }` → version timeline

Sibling collection `promptTestQuestions`:
```ts
{ _id, agentType, text, ordinal, enabled }
```

Git export: nightly ECS scheduled task (`scripts/export-prompts-to-git.js`), same EventBridge pattern as `classify-feedback-topics`. Reads active rows, reassembles per-agent text, writes to `rebuilding-bots/specs/*/agent.txt`, `git add + commit -m "chore(prompt): nightly DB export YYYY-MM-DD" + push origin main` if the tree is non-empty.

## Data flow

### Load — `/d/prompts`
1. React page mounts. `useAdminPromptSections(agentType)` fetches `/api/admin/prompts/:agent/sections`.
2. Service returns active sections ordered by `ordinal`, each with a `hasDraft` boolean (computed by a lookaside query for `isDraft: true` rows).

### Save Draft
1. Admin edits in Monaco, clicks "Save Draft".
2. `POST /drafts` → service inserts `{ isDraft: true, active: false, parentVersionId: <current-active-id>, changeNote?, body }`.
3. UI refreshes the section list and tags the section with "has draft".

### Preview
1. Admin clicks Preview on a draft.
2. `POST /preview` with the draft body.
3. Service calls `shadowAgent.create()`:
   - Assembles the full agent prompt using active sections, but with the draft's section swapped in for the target `sectionKey`.
   - PATCHes a new LibreChat agent (cloned from the active one) with `instructions = <assembled>`.
4. Service loads `promptTestQuestions` for that agent (3-5 canned Hebrew questions).
5. Parallel-runs each question against the shadow agent (90s timeout each) AND against the current-active agent (cached per-question for 10min).
6. Returns `{ questions: [{ text, current: {answer, toolCalls}, draft: {answer, toolCalls}, deltaSummary? }] }`.
7. Shadow agent lives for 10min (reused on re-preview) then torn down by a TTL sweep.

### Publish
1. Admin clicks Publish, fills required change-note, confirms.
2. `POST /publish` with `parentVersionId`, `body`, `changeNote`.
3. Service does optimistic check: is `parentVersionId` still the current active for `{agent, sectionKey}`? If no → HTTP 409 with the new active's id + body in the payload (UI opens a rebase diff).
4. If yes: in a Mongo transaction, flip old active `{active: false}` and insert new row `{active: true, isDraft: false, publishedAt: now, createdBy, changeNote, parentVersionId}`.
5. Post-transaction: reassemble the whole prompt for that agent, call LibreChat's agent update API to set `instructions`.
6. Emit a stdout JSON log line (picked up by CloudWatch) so we can audit outside the DB if needed.
7. Trigger the git-export job to run within 60s (cron-triggered, so actually: insert a small "dirty" flag row that the next scheduled run sees, or just let the nightly cron catch it — v1 goes with nightly-only).

### Restore
1. Admin picks a prior version in `PromptHistory` → "Restore".
2. Confirmation modal ("This publishes without preview. Continue?").
3. On confirm: acts exactly like Publish with the old body + a synthesized change-note (`Restored from version <sha-short>`).

## Error handling

- **409 on Publish** — UI rebases: shows the user's body vs. the new active, lets them resolve and re-publish.
- **Preview timeout on any question** — return what we have so far, mark the slow question as `timed_out: true`. Don't block on a bad tool call.
- **Shadow agent creation failure** — return 503 with "preview temporarily unavailable; try again in a minute" (the LibreChat agents API is occasionally flaky on first-request; automatic retry is handled at the service layer).
- **Git export failure** — log, alarm, continue. The DB is authoritative; git is the backup.
- **LibreChat agent PATCH failure on publish** — the DB write already committed, but the live agent didn't update. Retry 3× with backoff. If all fail, surface as `502 publish_propagation_failed`, and a background job keeps retrying every minute until successful (LibreChat agent instructions converge on the latest DB state).

## Testability

Same DI-receiving pure-function pattern as the classify-feedback-topics module.

- `assemble(sections)` — pure, table-driven tests.
- `publish(input, { db, agentsClient })` — unit test with in-memory db + fake agents client; integration test with `mongodb-memory-server` + real Mongoose models.
- `preview(...)` — unit test with fake shadow-agent adapter returning canned responses; integration test with a stubbed LibreChat fake server.
- `supertest` coverage of each route, including 403 for non-admin and 409 on stale `parentVersionId`.
- Frontend component tests per widget (rendering, empty states, confirm-modal behavior).

Manual dress rehearsal: after staging deploy, run the marker-migration script, import current agent.txt → DB, publish a no-op change, preview, publish again, verify the LibreChat agent's `instructions` field mirrors the DB, verify `git log -p specs/unified/agent.txt` still shows the migration commit.

## Migration plan

Four PRs in order. Each is independently shippable.

1. **Markers** (`rebuilding-bots`) — add `<!-- SECTION_KEY: xxx -->` above every `##` header in `specs/{unified,takanon,budgetkey}/agent.txt`. No runtime change.
2. **Schema + seed-from-DB** (`LibreChat`) — new `prompts` + `promptTestQuestions` models; `PromptsService.assembleActive(agentType)`; `seed-botnim-agent.js` prefers DB, falls back to file. No UI yet.
3. **Initial load** (`LibreChat` or standalone script) — `scripts/migrate-prompts-into-db.js` parses the marker-augmented files and populates `prompts` with `{ active: true, isDraft: false, createdBy: 'migration' }`. One-shot, idempotent.
4. **UI + API + nightly git export** (`LibreChat`) — the actual /d/prompts feature. Shipped last so the DB is populated before anyone can see the page.

## Open / deferred

- **Cross-environment prompt promotion.** For now, staging and prod each have their own `prompts` collection. Copying a validated prompt from staging → prod is manual (mongoexport + mongoimport scoped to one `{agentType, sectionKey}`). v2.
- **Prompt templating / variables.** Today's prompts are pure Hebrew text. Not adding `{{year}}` / `{{today}}` etc. until a concrete need arises.
- **Non-admin review / approval.** One-admin publish is fine for a 3-person team. Two-admin approval flow is v2+ if the team grows.
- **Prompt diffs in the PR-review path.** The nightly git export keeps file-level diffs for human review, but inline PR comments on specific prompt edits aren't wired in. Could add a Slack notification on Publish as a lightweight alert. v2.
