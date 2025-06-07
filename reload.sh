#!/bin/sh
(docker pull ghcr.io/whiletrue-industries/botnim/botnim-api:latest || true) && \
    rm main.zip && \
    wget https://github.com/whiletrue-industries/LibreChat/archive/refs/heads/main.zip && \
    unzip -o main.zip && \
    cp .env.production LibreChat-main/.env && \
    cp botnim.yaml LibreChat-main/api/app/clients/tools/.well-known/openapi/botnim.yaml && \
    cp serviceAccountKey.json LibreChat-main/serviceAccountKey.json && \
    cp librechat.yaml LibreChat-main/librechat.yaml && \
    cd LibreChat-main && \
    ./rerun.sh
