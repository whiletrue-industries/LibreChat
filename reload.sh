#!/bin/sh
(docker pull ghcr.io/whiletrue-industries/botnim/botnim-api:add_query_modes || true) && \
    rm add_query_modes.zip || true && \
    wget https://github.com/whiletrue-industries/LibreChat/archive/refs/heads/add_query_modes.zip && \
    unzip -o add_query_modes.zip && \
    cp .env.production LibreChat-main/.env && \
    cp botnim.yaml LibreChat-main/api/app/clients/tools/.well-known/openapi/botnim.yaml && \
    cp serviceAccountKey.json LibreChat-main/serviceAccountKey.json && \
    cp librechat.yaml LibreChat-main/librechat.yaml && \
    cd LibreChat-main && \
    ./rerun.sh
