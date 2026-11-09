#!/usr/bin/env bash
# Render the main Flow Ink combinations on one track (no FPS bench).
track=${1:-house-124}
node scripts/verify.mjs --track "$track" --variant ink --no-bench
node scripts/verify.mjs --track "$track" --variant sumi --no-bench
node scripts/verify.mjs --track "$track" --variant marble --palette 6 --no-bench
node scripts/verify.mjs --track "$track" --variant ink --flat --no-bench
