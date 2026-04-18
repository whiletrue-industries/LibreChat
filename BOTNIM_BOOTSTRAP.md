# Botnim on mainstream LibreChat (v0.8.4) — bootstrap guide

This branch is **mainstream LibreChat v0.8.4** with the following overlay:

- `infra/` — our ECS/Terraform stack, preserved verbatim from our fork.
- `librechat.yaml` — our config (needs adjustment for this version; see below).
- `BOTNIM_BOOTSTRAP.md` — this file.

Everything else is unmodified upstream. No custom controllers, no
`ResponseStreamManager`, no `BotConfigService`, no `hydrateHistory`, no
`oversizedConversation`. Those features are all covered by upstream's
Agents endpoint (runtime summarization, rate-limit handling, tool-call
UI, MCP support) instead.

## Architecture on this branch

```
User → LibreChat (upstream v0.8.4, Agents endpoint)
          │
          ├─ OpenAI Responses API (gpt-5.4-mini) — for generation
          │
          └─ Actions (OpenAPI specs registered per Agent)
                │
                └─ botnim-api (our existing FastAPI service)
                     ├─ GET /botnim/retrieve/{bot}/{context}   — ES vector search
                     ├─ GET /botnim/bots                       — list available bots
                     └─ existing OpenAPI endpoints (DatasetInfo, DatasetDBQuery, …)
```

`BotConfigService` and `/botnim/config/{bot}` are no longer on the
request path. The unified bot's instructions + tool list live in
LibreChat's MongoDB as an Agent record instead. botnim-api is unchanged
and continues to serve the OpenAPI tools as before.

## One-time bootstrap (what needs to happen to actually use this)

Upstream stores agents in MongoDB, not yaml, so the agent is created
at runtime. The bootstrap is five steps:

### 1. Bring up the stack locally

From the parlibot root:

```bash
docker compose up -d
# mongo, meili, botnim-api, LibreChat upstream, (es01)
```

### 2. Register the admin user

```bash
# The existing init-user service creates admin@botnim.local / admin123.
# Upstream v0.8.4 uses the same User model, so this is untouched.
```

Sign in at <http://localhost:3080> as `admin@botnim.local` / `admin123`.

### 3. Configure the endpoint for Responses API

Edit `librechat.yaml` at the root and make sure the Agents endpoint is
exposed with OpenAI as its provider:

```yaml
version: 1.2.4  # bumped for v0.8.4 schema
cache: true

interface:
  endpointsMenu: true

endpoints:
  agents:
    # Enabled by default on v0.8.4. Nothing else required here unless
    # you want to restrict which models agents may use.
    capabilities: [actions, tools, file_search, artifacts, chain, execute_code]
```

Restart LibreChat (`docker compose restart api`).

### 4. Create the Botnim Agent via the UI

1. Navigate to **Agents → New Agent**
2. Name: `בוט מאוחד - תקנון, חוקים ותקציב`
3. Provider: **OpenAI** — API key from our existing secret
4. Model: `gpt-5.4-mini`
5. Instructions: paste the contents of
   `rebuilding-bots/specs/unified/agent.txt` verbatim
6. Actions: for each file in `rebuilding-bots/specs/openapi/*.yaml`, click
   **Add Actions → Import from file** and upload. This registers each
   tool with its HTTP backend (defaults to the URL embedded in the
   `servers:` block of the OpenAPI spec — confirm it's pointing at
   `http://botnim-api:8000` for local or the staging DNS for remote).
7. Save.

You should end up with one Agent that has ~11 Actions (matching our
current `specs/unified/config.yaml` tool list).

### 5. Hide the default endpoints (optional)

To match our current fork UX where only the unified bot is visible:

```yaml
endpoints:
  agents:
    capabilities: [...]
    # Restrict which agents show up for non-admin users
    privateAssistants: true   # agents hidden from other users unless shared
```

Or share the unified agent globally via the agent's sharing UI, and set
`interface.endpointsMenu: false` to hide the provider picker.

## What's in `infra/`

Unchanged from our fork. Terraform for:

- botnim-api ECS Fargate service (mounts EFS, runs sync+snapshot cron)
- librechat ECS Fargate service (API + mongo + meili sidecars)
- ALB routing, Service Connect, S3 snapshot bucket, lifecycle rules

The librechat service's task definition needs one adjustment before
applying this branch to staging: remove our custom env vars that
upstream doesn't understand (`BOTNIM_API`, `BOTNIM_BOT_SLUG`,
`BOTNIM_ENVIRONMENT`, `ASSISTANT_SUPPORTED_IDS`, `BOOTSTRAP_USER_*`).
The admin account and agent are created via the UI post-deploy.

```hcl
# infra/envs/staging/main.tf — simplifications
# DROP these env vars (were consumed by our deleted custom code):
#   BOTNIM_API, BOTNIM_BOT_SLUG, BOTNIM_ENVIRONMENT
#   ASSISTANT_SUPPORTED_IDS
#   BOOTSTRAP_USER_EMAIL, BOOTSTRAP_USER_NAME, BOOTSTRAP_USER_PASSWORD
#   CREATE_BOOTSTRAP_USER
```

## What's NOT done yet on this branch

This branch proves **the code drop-in works**; it doesn't yet
demonstrate Hebrew Q&A end-to-end. Remaining work before staging:

1. **Adjust librechat.yaml for v0.8.4 schema** (the `version:` field
   and endpoint block shape differ from 1.1.5).
2. **Adjust infra/envs/staging/main.tf**: drop our custom env vars;
   verify upstream v0.8.4's mongo + meili sidecar env var expectations
   match what we pass today.
3. **Adjust docker-compose.yml in parlibot**: drop our
   `BOTNIM_API=`/`BOTNIM_ENVIRONMENT=`/`ASSISTANT_SUPPORTED_IDS=` env
   vars on the `api` container (upstream won't read them).
4. **Write an agent-seed script** (Node.js hitting LibreChat's API) so
   the Botnim agent + its 11 actions can be created from our
   `specs/openapi/*.yaml` files without clicking through the UI every
   time we reset the DB. This is the one piece of our custom behavior
   we'll genuinely need to replicate.
5. **Validate Hebrew Q&A against the new stack** locally first, then
   staging. The OpenAI Responses-API path inside upstream's Agents
   endpoint should handle Hebrew identically to our fork, but verify.

## Why this shape

Answers the question "can we adjust our code to the new main version?"
with "yes — by dropping our code and letting mainstream do the work,
while our custom infra and bot-data layer keep working unchanged."

Nothing in `rebuilding-bots` (botnim-api, specs, sync, benchmarks,
snapshot hook) needs to change. The OpenAPI tool specs are already in
the exact format LibreChat Actions expect. The Hebrew prompt
engineering moves verbatim into the Agent's `instructions` field.

The `experiment/merge-upstream-main` branch on the same repo has a
separate `MERGE_EXPERIMENT.md` documenting why a `git merge`-style
upstream pull isn't viable (677 conflicts, unrelated histories). This
branch is the alternative: stop fighting the history, run mainstream,
wire our bot layer around it.
