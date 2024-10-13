#!/bin/sh
scp reload.sh bonim:reload.sh
scp .env.production bonim:.env.production
scp librechat.yaml bonim:librechat.yaml
ssh bonim /bin/bash -c "./reload.sh"