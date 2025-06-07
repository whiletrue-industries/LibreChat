#!/bin/sh
scp .env.production botnim:
scp reload.sh botnim:
python yaml_to_production.py  ../rebuilding-bots/specs/openapi/botnim.yaml botnim.production.yaml
scp botnim.production.yaml botnim:botnim.yaml
ssh botnim 'bash -c "./reload.sh"'