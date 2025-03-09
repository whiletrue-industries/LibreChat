#!/bin/sh
/usr/sbin/crond -b -l0 -d0 -c /etc/crontabs/
# Run the provided command
exec "$@"