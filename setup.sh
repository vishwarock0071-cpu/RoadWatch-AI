#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org"; exit 1; }
echo "Installing web app packages..."
npm install --no-fund --no-audit || exit 1
node scripts/setup.js "$@"
