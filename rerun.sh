#!/bin/sh
docker compose -f deploy-compose.yml up client botnim_api --build api -d
