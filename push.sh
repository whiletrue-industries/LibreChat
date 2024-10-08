#!/bin/sh
scp reload.sh bonim:reload.sh
scp .env.production bonim:.env.production
ssh bonim /bin/bash -c "./reload.sh"