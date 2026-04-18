# Upstream-Merge Experiment — Findings

**Date:** 2026-04-18
**Branch:** `experiment/merge-upstream-main`
**Question:** Can we adjust our code to mainstream LibreChat's current `main`?

## Short answer

**Not via `git merge`.** 677 files conflict on a `--allow-unrelated-histories`
merge (the two histories have no common ancestor any more). But the underlying
question — "can we adopt upstream's behaviour without losing abilities?" — is
yes, via a **re-platform** (port Botnim logic onto upstream's Agents endpoint)
rather than a merge.

## What the merge actually produced

```
git merge upstream/main --allow-unrelated-histories
→ 677 conflicts, mostly add/add on files that exist on both sides
  but were rewritten independently.
```

The conflict shape:

- Entire directories we didn't have: `/packages/api/src/*` (TypeScript),
  `/packages/data-schemas/src/*`, `/client/src/*` (new component layout)
- Entire directories upstream removed or reorganized
- Every `package.json` in the monorepo
- Core backend files rewritten by us AND by upstream: `Threads/manage.js`,
  `controllers/assistants/helpers.js`, `controllers/assistants/chatV2.js`,
  `ResponseStreamManager.js` (upstream replaces with `@librechat/agents`)

Line-by-line resolution is not feasible in any reasonable timeframe.

## What upstream has now that we built ourselves

| Our code | Upstream equivalent (already built) | Where in upstream |
|---|---|---|
| `ResponseStreamManager.js` | `createRun` + `@librechat/agents` runtime | `packages/api/src/**` + `agents/client.js` |
| `BotConfigService.js` (fetch config from external API) | Agent records stored in mongo; `loadAgent` / `initializeAgent` | `controllers/agents/request.js` |
| `specs/openapi/*.yaml` → ad-hoc tool loading | MCP (Model Context Protocol) 3-tier server architecture | `packages/api/src/mcp/**` |
| `hydrateHistory.js` (stateless history hydration) | Native Agents conversation state with summary blocks | Part of Agents endpoint flow |
| `oversizedConversation.buildRecap` | `buildSummarizationHandlers` — calls a smaller LLM to summarize | `controllers/agents/callbacks.js` |
| `retryOnRateLimit` + tenacity-style backoff | Built into `@librechat/agents` runtime | External package |
| `emitRetryNotice` UI status bubble | `on_summarize_status` SSE event + Tool Call UI Redesign (PR #12163) | First-class |
| `ASSISTANT_SUPPORTED_IDS` env allowlist | Agent ACL system with resource-level permissions | `packages/api/src/acl/**` |

Our fork reinvented most of this during the Assistants → Responses migration;
upstream independently built a cleaner version as part of the same industry
shift.

## Abilities we'd need to re-express (not lose) on upstream

All of these have upstream paths — but the paths are different:

1. **External `BotConfig` from botnim-api.** Upstream expects agents in
   MongoDB. Options:
   - Run a periodic sync job that mirrors `specs/<bot>/` into LibreChat's
     agents collection.
   - Or expose botnim-api as an **MCP server** and let LibreChat load tools
     + instructions from it natively. Arguably cleaner — keeps botnim-api
     as the source of truth and gains MCP's other clients for free.

2. **OpenAPI tool specs (`specs/openapi/*.yaml`).** Upstream uses MCP
   for tools, but it also has an **Actions** system that ingests OpenAPI
   specs for per-agent tool binding (visible in our current fork too under
   `ActionService`). Re-expressing: register each OpenAPI spec as an Action
   on the corresponding Agent record.

3. **Stateless per-question design** (our post-Conversations-API stance).
   Upstream's Agents endpoint is stateful by default, but includes
   summarization to bound context. Equivalent outcome: cap history with
   the built-in summarizer instead of our recap-on-failure pattern.

4. **`ASSISTANT_SUPPORTED_IDS` env allowlist.** Replace with Agent ACL:
   mark the unified bot Agent as "public within tenant" and leave the
   other two hidden. No env var needed; cleaner permission model.

5. **Hebrew prompt engineering, specs, models.** All fork-agnostic. Carry
   over verbatim.

6. **Fork-unrelated code** (rebuilding-bots, infra, deploy.sh, ES
   snapshot, parallelize sync, Service Connect) — untouched by any
   LibreChat migration.

## Abilities we'd GAIN by re-platforming

Things we haven't built and upstream has:

- Tool Call UI redesign — contextual icons, smart grouping, rich output rendering (PR #12163)
- Real LLM-backed summarization for long conversations (PR #12287)
- MCP support with lazy init + 3-tier server architecture (PR #12435)
- Agent Marketplace
- Tenant-scoped app config in auth flows (PR #12434)
- Admin Roles API (PR #12400)
- Entra ID group sync (PR #12606)
- Dependabot-ready dependency posture; security patches land upstream
  without our intervention
- TypeScript monorepo — better maintainability going forward
- Claude Opus 4.7 model support (and future model support flows natively)

## Cost estimate (re-platform, not merge)

**2-4 weeks of focused work**, rough breakdown:

- Understand upstream's Agent lifecycle, ACL model, MCP server registration, summarization config (3-5 days)
- Decide: botnim-api-as-MCP-server vs periodic sync of BotConfig → mongo (1 day)
- Port bots as upstream Agent records with Actions from our OpenAPI specs (2-3 days)
- Configure agent access, tenant config, model defaults; replace `ASSISTANT_SUPPORTED_IDS` (1-2 days)
- Wire the Responses-API Agents endpoint in place of our chatV2 path; delete our reinventions (2-3 days)
- Parallel staging deploy alongside current fork; validate Hebrew flow, tool calls, summarization (2-3 days)
- Cut over — staging → production (1-2 days)

## Cost of staying on fork

- Ongoing: manual cherry-picks of upstream security patches
- Rising: the longer we wait, the more 12,000+ upstream commits of drift
- Security risk: no automatic dependency-audit flow
- Feature gap: every upstream feature we want, we build ourselves

## Recommendation

**Can't** merge. **Can** re-platform, as a dedicated project with its own
Monday ticket and its own staging validation window. Staging is stable
right now on the fork — no disruption required. The re-platform runs in
parallel until it passes the same DoD the current fork does.

---

This branch (`experiment/merge-upstream-main`) is kept purely for reference.
The merge was aborted; the branch now contains only this findings file on
top of our current `main`.
