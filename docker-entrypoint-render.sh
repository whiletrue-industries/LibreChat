#!/bin/sh
# Render /app/librechat.yaml from /app/librechat.yaml.tpl, substituting
# ${BOTNIM_AGENT_ID_UNIFIED}. If the var is empty or unset, strip the
# modelSpecs block so the API can still boot — the bot will not be
# auto-selected, but seed scripts and admin UI still work.
#
# Test paths can be overridden via TPL_PATH / OUT_PATH env vars; production
# uses the defaults below.
set -eu

TPL="${TPL_PATH:-/app/librechat.yaml.tpl}"
OUT="${OUT_PATH:-/app/librechat.yaml}"

if [ -n "${BOTNIM_AGENT_ID_UNIFIED:-}" ]; then
  # Single-var envsubst so a stray $... elsewhere in the yaml is not expanded.
  envsubst '${BOTNIM_AGENT_ID_UNIFIED}' < "$TPL" > "$OUT"
else
  # Strip the modelSpecs block: drop everything from `modelSpecs:` (column 0)
  # up to but not including the next column-0 key. Leaves all other top-level
  # blocks intact.
  awk '
    /^modelSpecs:/  { skip = 1; next }
    /^[A-Za-z]/     { skip = 0 }
    !skip           { print }
  ' "$TPL" > "$OUT"
  echo "[entrypoint] WARNING: BOTNIM_AGENT_ID_UNIFIED unset — modelSpecs stripped" >&2
fi

exec "$@"
