#!/bin/sh
set -eu
cd /workspace
if [ -n "${GOOGLE_TTS_DATA_DIR:-}" ] && ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:8092/; then
  node services/tts/server.mjs >>/tmp/google-tts.log 2>&1 &
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
