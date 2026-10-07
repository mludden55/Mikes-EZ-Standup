#!/bin/sh
cd "$(dirname "$0")" || exit 1
echo "Installing required packages (npm install)..."
npm install --omit=dev || exit 1
node install/install-server.js
