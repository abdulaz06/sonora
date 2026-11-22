#!/usr/bin/env bash
# The desktop app for automated checks: its own WebView2 profile (an installed
# sonora may be running), remote debugging on :9333 (scripts/app/cdp.mjs), and a
# window that doesn't take focus. Logs to node_modules/.cache/tauri-dev.log.
cd "$(dirname "$0")/../.."
export WEBVIEW2_USER_DATA_FOLDER="${WEBVIEW2_USER_DATA_FOLDER:-$HOME/sonora-dev-webview}"
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${SONORA_CDP_PORT:-9333} ${SONORA_WV2_ARGS:-}"
exec npx tauri dev --config scripts/app/tauri.check.json "$@" > node_modules/.cache/tauri-dev.log 2>&1
