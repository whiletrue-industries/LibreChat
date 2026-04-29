#!/bin/sh
# Render /app/librechat.yaml from /app/librechat.yaml.tpl, substituting
# ${BOTNIM_AGENT_ID_UNIFIED}. The id is resolved in priority order:
#   1. BOTNIM_AGENT_ID_UNIFIED env var (explicit override; fastest path).
#   2. MongoDB lookup by name on the `agents` collection. The seed script
#      reuses the existing agent by name on every run, so the (name → id)
#      mapping is the real source of truth — re-seeding into a fresh DB
#      doesn't require a redeploy or terragrunt edit.
# If both are empty (fresh stack with nothing seeded yet), strip the
# modelSpecs block so the API still boots in degraded fallback.
#
# Test paths can be overridden via TPL_PATH / OUT_PATH env vars; production
# uses the defaults below. BOTNIM_SKIP_AGENT_LOOKUP=1 disables the Mongo
# lookup (useful for tests so they don't need a Mongo instance).
set -eu

TPL="${TPL_PATH:-/app/librechat.yaml.tpl}"
OUT="${OUT_PATH:-/app/librechat.yaml}"
AGENT_NAME="${BOTNIM_AGENT_NAME:-בוט מאוחד - תקנון, חוקים ותקציב}"

AGENT_ID="${BOTNIM_AGENT_ID_UNIFIED:-}"

if [ -z "$AGENT_ID" ] && [ -n "${MONGO_URI:-}" ] && [ -z "${BOTNIM_SKIP_AGENT_LOOKUP:-}" ]; then
  # Mongo lookup: connect, find one document in `agents` matching the
  # configured name, print its `id` field. Errors (connection refused,
  # auth failure, no match) silently produce empty output and we fall
  # through to the strip path. The 5s server-selection timeout keeps
  # boot fast on a stack with no Mongo at all.
  AGENT_ID="$(BOTNIM_AGENT_NAME="$AGENT_NAME" node -e '
    const m = require("mongoose");
    (async () => {
      try {
        await m.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        const a = await m.connection.db.collection("agents").findOne(
          { name: process.env.BOTNIM_AGENT_NAME },
          { projection: { id: 1 } }
        );
        if (a && a.id) process.stdout.write(a.id);
      } catch (e) { /* fall through to strip */ }
      finally { try { await m.disconnect(); } catch (_) {} }
    })();
  ' 2>/dev/null || true)"
  if [ -n "$AGENT_ID" ]; then
    echo "[entrypoint] resolved agent_id by name lookup: $AGENT_ID" >&2
  fi
fi

if [ -n "$AGENT_ID" ]; then
  # Single-var envsubst so a stray $... elsewhere in the yaml is not expanded.
  BOTNIM_AGENT_ID_UNIFIED="$AGENT_ID" envsubst '${BOTNIM_AGENT_ID_UNIFIED}' < "$TPL" > "$OUT"
  # Export so the spawned API server (api/server/index.js's
  # app.locals.liveAgentIds.unified) sees the same resolved id whether
  # it came from the env var or the lookup.
  export BOTNIM_AGENT_ID_UNIFIED="$AGENT_ID"
else
  # Strip the modelSpecs block: drop everything from `modelSpecs:` (column 0)
  # up to but not including the next column-0 key. Leaves all other top-level
  # blocks intact.
  awk '
    /^modelSpecs:/  { skip = 1; next }
    /^[A-Za-z]/     { skip = 0 }
    !skip           { print }
  ' "$TPL" > "$OUT"
  echo "[entrypoint] WARNING: BOTNIM_AGENT_ID_UNIFIED unset and Mongo lookup yielded nothing — modelSpecs stripped" >&2
fi

exec "$@"
