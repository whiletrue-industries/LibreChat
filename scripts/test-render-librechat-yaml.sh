#!/usr/bin/env bash
# Test harness for docker-entrypoint-render.sh. Exits 0 on success, 1 on failure.
# Run: bash scripts/test-render-librechat-yaml.sh
set -euo pipefail

cd "$(dirname "$0")/.."

ENTRYPOINT="$(pwd)/docker-entrypoint-render.sh"
FIXTURE_DIR="$(pwd)/scripts/__fixtures__"
TPL="${FIXTURE_DIR}/librechat.yaml.tpl.fixture"

[ -x "$ENTRYPOINT" ] || { echo "FAIL: $ENTRYPOINT not executable"; exit 1; }
[ -f "$TPL" ]       || { echo "FAIL: $TPL missing"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$TPL" "$WORK/librechat.yaml.tpl"

run_entrypoint() {
  # BOTNIM_SKIP_AGENT_LOOKUP=1 forces the entrypoint to skip its
  # Mongo-by-name lookup so the test harness stays hermetic — we don't
  # want a stray MONGO_URI in the dev shell to make tests query a real
  # database. The lookup itself is exercised separately in test 6.
  TPL_PATH="$WORK/librechat.yaml.tpl" OUT_PATH="$WORK/librechat.yaml" \
    BOTNIM_AGENT_ID_UNIFIED="${1-}" \
    BOTNIM_SKIP_AGENT_LOOKUP=1 \
    "$ENTRYPOINT" /usr/bin/true
}

# Test 1: env var set → agent_id substituted
run_entrypoint "agent_test_abc123"
grep -q 'agent_id: agent_test_abc123' "$WORK/librechat.yaml" \
  || { echo "FAIL: substitution did not happen"; cat "$WORK/librechat.yaml"; exit 1; }
grep -q '^modelSpecs:' "$WORK/librechat.yaml" \
  || { echo "FAIL: modelSpecs block missing in rendered output"; exit 1; }
echo "PASS: substitution"

# Test 2: env var empty → modelSpecs stripped, file still valid yaml
run_entrypoint ""
if grep -q '^modelSpecs:' "$WORK/librechat.yaml"; then
  echo "FAIL: modelSpecs should have been stripped"; cat "$WORK/librechat.yaml"; exit 1
fi
grep -q '^version:' "$WORK/librechat.yaml" \
  || { echo "FAIL: top-of-file content missing after strip"; exit 1; }
echo "PASS: fallback strip"

# Test 3: env var unset (not just empty) → same fallback behaviour
unset BOTNIM_AGENT_ID_UNIFIED || true
TPL_PATH="$WORK/librechat.yaml.tpl" OUT_PATH="$WORK/librechat.yaml" \
  BOTNIM_SKIP_AGENT_LOOKUP=1 \
  "$ENTRYPOINT" /usr/bin/true
grep -q '^modelSpecs:' "$WORK/librechat.yaml" && \
  { echo "FAIL: unset var should also strip modelSpecs"; exit 1; }
echo "PASS: unset var"

# Test 4: rendered output is valid yaml (parseable). Use python -c yaml.safe_load.
python3 -c "import yaml,sys; yaml.safe_load(open('$WORK/librechat.yaml'))" \
  || { echo "FAIL: rendered yaml is not parseable"; exit 1; }
echo "PASS: yaml parses"

# Test 5: real template renders and parses
TPL_PATH="$(pwd)/librechat.yaml.tpl" OUT_PATH="$WORK/real-rendered.yaml" \
  BOTNIM_AGENT_ID_UNIFIED="agent_real_smoke" \
  BOTNIM_SKIP_AGENT_LOOKUP=1 \
  "$ENTRYPOINT" /usr/bin/true
python3 -c "
import yaml,sys
d = yaml.safe_load(open('$WORK/real-rendered.yaml'))
assert d['modelSpecs']['enforce'] is True, 'enforce must be true'
assert d['modelSpecs']['list'][0]['default'] is True, 'default must be true'
assert d['modelSpecs']['list'][0]['preset']['agent_id'] == 'agent_real_smoke'
assert d['interface']['endpointsMenu'] is False, 'endpointsMenu must be false'
assert d['interface']['modelSelect'] is False, 'modelSelect must be false'
print('schema asserts ok')
"
echo "PASS: real template"

# Test 6: skip-flag with no env var and no MONGO_URI → still strips
# (i.e., the lookup gate is purely conditional on MONGO_URI being set).
unset BOTNIM_AGENT_ID_UNIFIED MONGO_URI || true
TPL_PATH="$WORK/librechat.yaml.tpl" OUT_PATH="$WORK/librechat.yaml" \
  "$ENTRYPOINT" /usr/bin/true 2>"$WORK/stderr"
if grep -q '^modelSpecs:' "$WORK/librechat.yaml"; then
  echo "FAIL: no env + no Mongo should still strip"; exit 1
fi
grep -q "WARNING.*modelSpecs stripped" "$WORK/stderr" \
  || { echo "FAIL: WARNING log missing on strip path"; cat "$WORK/stderr"; exit 1; }
echo "PASS: no-env-no-mongo strips with WARNING"

echo
echo "ALL TESTS PASSED"
