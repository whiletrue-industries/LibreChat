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
  if ! node /app/config/create-default-user.js; then
    echo "entrypoint: create-default-user FAILED, aborting boot" >&2
    exit 1
  fi
fi

# Run the provided command
exec "$@"