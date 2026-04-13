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

# Run the provided command
exec "$@"