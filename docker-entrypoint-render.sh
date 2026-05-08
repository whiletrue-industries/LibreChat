#!/bin/sh
# Render /app/librechat.yaml from /app/librechat.yaml.tpl, substituting
# ${BOTNIM_AGENT_ID_UNIFIED} and ${BOTNIM_AGENT_ID_UNIFIED_DRAFT}.
# Each id is resolved in priority order:
#   1. The matching env var (explicit override; fastest path).
#   2. MongoDB lookup by name on the `agents` collection. The seed script
#      reuses the existing agent by name on every run, so the (name → id)
#      mapping is the real source of truth — re-seeding into a fresh DB
#      doesn't require a redeploy or terragrunt edit.
# Canonical agent: name = ${BOTNIM_AGENT_NAME} (default "בוט מאוחד - …").
# Draft agent:     name = "${BOTNIM_AGENT_NAME} — DRAFT" (suffixed by the
#                  refreshDraftAgentForBot helper on every save).
#
# Both unset (fresh stack with nothing seeded yet): strip the modelSpecs
# block so the API still boots in degraded fallback.
# Canonical resolved but draft unset: strip JUST the draft entry from the
# modelSpecs.list, leaving the canonical entry intact. This covers fresh
# stacks where a draft hasn't been saved yet.
#
# Test paths can be overridden via TPL_PATH / OUT_PATH env vars; production
# uses the defaults below. BOTNIM_SKIP_AGENT_LOOKUP=1 disables the Mongo
# lookup (useful for tests so they don't need a Mongo instance).
set -eu

TPL="${TPL_PATH:-/app/librechat.yaml.tpl}"
OUT="${OUT_PATH:-/app/librechat.yaml}"
AGENT_NAME="${BOTNIM_AGENT_NAME:-בוט מאוחד - תקנון, חוקים ותקציב}"
# em-dash matches the suffix produced by draftAgent.js:draftAgentNameFor
DRAFT_AGENT_NAME="${AGENT_NAME} — DRAFT"

AGENT_ID="${BOTNIM_AGENT_ID_UNIFIED:-}"
DRAFT_AGENT_ID="${BOTNIM_AGENT_ID_UNIFIED_DRAFT:-}"

if { [ -z "$AGENT_ID" ] || [ -z "$DRAFT_AGENT_ID" ]; } \
   && [ -n "${MONGO_URI:-}" ] \
   && [ -z "${BOTNIM_SKIP_AGENT_LOOKUP:-}" ]; then
  # Mongo lookup: connect once, find both agents, print as TAB-separated
  # "<canonical_id>\t<draft_id>". Either field may be empty if the
  # corresponding agent doesn't exist; the caller falls through to its
  # respective fallback (strip-all vs strip-just-draft) accordingly.
  LOOKUP="$(BOTNIM_AGENT_NAME="$AGENT_NAME" \
            BOTNIM_AGENT_NAME_DRAFT="$DRAFT_AGENT_NAME" \
            node -e '
    const m = require("mongoose");
    (async () => {
      try {
        await m.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        const coll = m.connection.db.collection("agents");
        const [c, d] = await Promise.all([
          coll.findOne({ name: process.env.BOTNIM_AGENT_NAME }, { projection: { id: 1 } }),
          coll.findOne({ name: process.env.BOTNIM_AGENT_NAME_DRAFT }, { projection: { id: 1 } }),
        ]);
        process.stdout.write((c && c.id ? c.id : "") + "\t" + (d && d.id ? d.id : ""));
      } catch (e) { /* fall through */ }
      finally { try { await m.disconnect(); } catch (_) {} }
    })();
  ' 2>/dev/null || true)"
  # Parse TAB-separated result; preserve any caller-provided value.
  if [ -z "$AGENT_ID" ]; then
    AGENT_ID="$(printf '%s' "$LOOKUP" | cut -f1)"
  fi
  if [ -z "$DRAFT_AGENT_ID" ]; then
    DRAFT_AGENT_ID="$(printf '%s' "$LOOKUP" | cut -f2)"
  fi
  if [ -n "$AGENT_ID" ]; then
    echo "[entrypoint] resolved agent_id by name lookup: $AGENT_ID" >&2
  fi
  if [ -n "$DRAFT_AGENT_ID" ]; then
    echo "[entrypoint] resolved draft agent_id by name lookup: $DRAFT_AGENT_ID" >&2
  fi
fi

if [ -n "$AGENT_ID" ]; then
  # If draft agent doesn't exist yet, drop the draft modelSpec entry from
  # the template before envsubst. Boundaries: the entry is the second
  # `- name: …` block under `list:`. We strip from the `# Draft mirror`
  # comment block (line "    # Draft mirror …") through the end of the
  # entry, identified by its `name: botnim-unified-draft`.
  if [ -z "$DRAFT_AGENT_ID" ]; then
    TMP_TPL="$(mktemp)"
    awk '
      /^    # Draft mirror/                    { skip = 1; next }
      skip && /^    - name: botnim-unified-draft/ { in_draft = 1 }
      skip && /^      agent_id: \$\{BOTNIM_AGENT_ID_UNIFIED_DRAFT\}/ {
        # last line of the draft block; consume it then stop skipping
        in_draft = 0; skip = 0; next
      }
      !skip                                    { print }
    ' "$TPL" > "$TMP_TPL"
    echo "[entrypoint] WARNING: BOTNIM_AGENT_ID_UNIFIED_DRAFT unset and Mongo lookup yielded nothing — draft modelSpec stripped" >&2
    INPUT="$TMP_TPL"
    DRAFT_AGENT_ID="placeholder-unused"
  else
    INPUT="$TPL"
  fi
  # Substitute both vars; envsubst with explicit list keeps stray $... safe.
  BOTNIM_AGENT_ID_UNIFIED="$AGENT_ID" \
    BOTNIM_AGENT_ID_UNIFIED_DRAFT="$DRAFT_AGENT_ID" \
    envsubst '${BOTNIM_AGENT_ID_UNIFIED} ${BOTNIM_AGENT_ID_UNIFIED_DRAFT}' < "$INPUT" > "$OUT"
  [ "${INPUT}" != "${TPL}" ] && rm -f "$TMP_TPL"
  # Export so the spawned API server (api/server/index.js's
  # app.locals.liveAgentIds.unified) sees the same resolved ids whether
  # they came from env vars or the lookup.
  export BOTNIM_AGENT_ID_UNIFIED="$AGENT_ID"
  if [ "$DRAFT_AGENT_ID" != "placeholder-unused" ]; then
    export BOTNIM_AGENT_ID_UNIFIED_DRAFT="$DRAFT_AGENT_ID"
  fi
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
