#!/bin/sh
/usr/sbin/crond -b -l0 -d0 -c /etc/crontabs/

# Override botnim API URL if BOTNIM_API_URL is set (for local dev)
if [ -n "$BOTNIM_API_URL" ]; then
  SPEC="/app/api/app/clients/tools/.well-known/openapi/botnim.yaml"
  if [ -f "$SPEC" ]; then
    sed -i "s|https://www.botnim.co.il|${BOTNIM_API_URL}|g" "$SPEC"
    echo "botnim.yaml: URL overridden to ${BOTNIM_API_URL}"
  fi
fi

# Bootstrap a default admin user on first boot, if requested.
#
# This exists because on ECS Fargate we cannot `docker exec` into the task to
# run `npm run create-user`, and the /api/auth/register HTTP route is closed
# when ALLOW_REGISTRATION=false. The script is idempotent: if any user already
# exists it exits 0 immediately. A non-zero exit ABORTS boot on purpose, so a
# broken secret wiring is loud rather than silent.
#
# Terraform sets CREATE_BOOTSTRAP_USER=true and injects:
#   BOOTSTRAP_USER_EMAIL, BOOTSTRAP_USER_NAME, BOOTSTRAP_USER_PASSWORD
# BOOTSTRAP_USER_PASSWORD is sourced from Secrets Manager (value set
# out-of-band via `aws secretsmanager put-secret-value`).
if [ "$CREATE_BOOTSTRAP_USER" = "true" ]; then
  echo "entrypoint: CREATE_BOOTSTRAP_USER=true, running create-default-user"
  # Retry loop: sidecars (mongo, meilisearch) start in parallel with the api
  # container, so the first attempt may fail with a MeiliSearch or Mongo
  # connection error. Wait up to 25s (5 attempts × 5s) for them to come up.
  _attempt=0
  _ok=false
  while [ $_attempt -lt 5 ]; do
    _attempt=$((_attempt + 1))
    if node /app/config/create-default-user.js 2>&1; then
      _ok=true
      break
    fi
    echo "entrypoint: create-default-user attempt $_attempt failed, retrying in 5s..."
    sleep 5
  done
  if [ "$_ok" != "true" ]; then
    echo "entrypoint: create-default-user FAILED after $_attempt attempts, aborting boot" >&2
    exit 1
  fi
fi

# Run the provided command
exec "$@"