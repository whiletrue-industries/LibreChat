#!/bin/sh
scp .env.staging botnim-staging:.env.production
scp reload.sh botnim-staging:
scp ../rebuilding-bots/specs/openapi/botnim.yaml botnim-staging:botnim.yaml
ssh botnim-staging 'bash -c "./reload.sh"'