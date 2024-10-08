#!/bin/sh
docker compose -f deploy-compose.yml up client --build api -d
