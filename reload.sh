#!/bin/sh
rm main.zip && \
    wget https://github.com/whiletrue-industries/LibreChat/archive/refs/heads/main.zip && \
    unzip -o main.zip && \
    cp .env.production LibreChat-main/.env && \
    cp librechat.yaml LibreChat-main/librechat.yaml && \
    cd LibreChat-main && \
    ./rerun.sh
