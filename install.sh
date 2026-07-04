#!/usr/bin/env bash
set -e
REPO="/c/Users/kira/Documents/Tavern"

if [ -f "package.json" ] && [ -d "data/default-user" ]; then
  export ST_ROOT="$(pwd -W 2>/dev/null || pwd)"
else
  export ST_ROOT="/c/Games/SillyTavern (release)"
fi

node "$REPO/deploy.js"