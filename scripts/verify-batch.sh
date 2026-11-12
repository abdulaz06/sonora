#!/usr/bin/env bash
# Render the main Ink combinations on one track (no FPS bench).
track=${1:-house-124}
node scripts/verify.mjs --track "$track" --style ink --variant glow --no-bench
node scripts/verify.mjs --track "$track" --style ink --variant sumi --no-bench
node scripts/verify.mjs --track "$track" --style ink --variant marble --palette 7 --no-bench
node scripts/verify.mjs --track "$track" --style ink --variant glow --flat --no-bench
