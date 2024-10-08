#!/bin/sh
rm main.zip && \
    wget https://github.com/whiletrue-industries/LibreChat/archive/refs/heads/main.zip && \
    unzip -o main.zip && \
    cp .env.production LibreChat-main/.env && \
    cd LibreChat-main && \
    ./rerun.sh
