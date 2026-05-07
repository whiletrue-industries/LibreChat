# UPE DoD — Playwright specs (Task 15a)

Automated counterparts of the four manual scenarios in
`rebuilding-bots/.worktrees/unified-prompt-editor/docs/superpowers/manual-tests/2026-05-07-unified-prompt-editor.md`.

## Files

| Spec | Manual scenario |
|---|---|
| `round-trip.spec.ts`   | 1. Edit → Save draft → Try draft → Publish round-trip |
| `snapshots.spec.ts`    | 2. Three publishes → restore oldest |
| `tool-override.spec.ts`| 3. Tool description override lifecycle |
| `auth-gate.spec.ts`    | 4. `restrictDraftAgent` middleware |

The four specs are intentionally independent — a single failing
scenario does not mask the others.

## How to run

Targets an EXTERNAL deployment. Spec defaults to `https://botnim.staging.build-up.team`.

```bash
cd /Users/amir/Development/anubanu/parlibot/LibreChat/.worktrees/unified-prompt-editor

# Install Playwright browsers if you haven't already.
npx playwright install chromium

# Resolve admin credentials (staging).
export ADMIN_PROMPTS_URL=https://botnim.staging.build-up.team
export ADMIN_PROMPTS_USER=botnim.staging.admin@build-up.team
export ADMIN_PROMPTS_PASSWORD="$(aws --profile anubanu-staging \
  secretsmanager get-secret-value \
  --secret-id librechat/staging/bootstrap-user-password \
  --query SecretString --output text)"

# Optional: non-admin for the auth-gate spec.
export ADMIN_PROMPTS_USER2=…
export ADMIN_PROMPTS_PASSWORD2=…

npx playwright test --config=e2e/admin-prompts/playwright.config.ts
```

## Why not local docker-compose?

The four specs are written to be substrate-agnostic — only
`ADMIN_PROMPTS_URL` selects the target. In principle they run against
`docker-compose.aurora-local.yml` once you have:

1. Built `botnim-librechat:local` from the unified-prompt-editor
   worktree (`./deploy.sh` phase 3 or `docker build … LibreChat/.worktrees/unified-prompt-editor`).
2. Built a `botnim-api` image from the rebuilding-bots worktree at
   the same branch (matching alembic 0009 schema).
3. Restored the Aurora staging dump into the compose Postgres so the
   prompt sections + tool overrides exist.
4. Run the seed script to plant both the canonical and DRAFT agent
   docs in MongoDB.
5. Created a non-admin user via the LibreChat signup flow.

In the 2026-05-07 Task 15a session none of (1)–(5) were pre-built on
this developer's machine — the available `botnim-api` and `librechat`
images in local Docker were all pre-UPE tags (4171d22, cb92b41,
d7b1e63), and `/tmp/aurora-staging.dump` was missing. Building both
images from scratch + restoring + seeding takes well over the
10-minute soft cap the task placed on local stack orchestration.

For the staging gate, the same specs run against
`https://botnim.staging.build-up.team` after `./deploy.sh staging`
finishes phase 9 (the seed). That is the project's existing pattern
for post-deploy DoD (see `parlibot/scripts/ui-sanity.spec.js`).

## Known caveats

- **Clock-skew dependency in `snapshots.spec.ts`.** The
  `agent_prompt_snapshots` view buckets section history by minute, so
  the spec deliberately sleeps 61s between publishes to force three
  distinct snapshots. Total runtime ≥ 130s.
- **Sentinel injection model.** All four specs append a sentinel to
  the joined text rather than replace a section body. The unified bot
  generally repeats sentinels verbatim when explicitly asked, but if
  the model paraphrases, the round-trip and auth-gate assertions on
  `text.toContain(sentinel)` may flake. Re-run before declaring red.
- **Tool name fallback in `tool-override.spec.ts`.** Defaults to
  `search_unified__legal_text`; if absent on the target env, the spec
  falls back to whatever the table's first row exposes. Set
  `ADMIN_PROMPTS_TOOL_NAME` explicitly for stable reproduction.
