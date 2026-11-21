#!/usr/bin/env bash
# Lighthouse (mobile + desktop) for the landing page, /engineering and /live
# against `npm run preview` (:4321, or BASE=…), using the system Edge with its GPU.
# Reports: ../verify/site/lighthouse/<page>-<form>.report.{html,json}; scores printed.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=../verify/site/lighthouse
mkdir -p "$OUT"
export CHROME_PATH="${CHROME_PATH:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
PAGES=${PAGES:-"home engineering live"}
BASE=${BASE:-http://localhost:4321}
for page in $PAGES; do
  path=$([ "$page" = home ] && echo "" || echo "$page")
  for form in mobile desktop; do
    preset=$([ "$form" = desktop ] && echo "--preset=desktop" || echo "")
    npx --yes lighthouse@13 "$BASE/$path" $preset --quiet \
      --only-categories=performance,accessibility,best-practices,seo \
      --chrome-flags="--headless=new --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist" \
      --output=json --output=html --output-path="$OUT/$page-$form" >/dev/null 2>&1 || echo "lighthouse failed: $page $form"
    node -e "const r=require('$OUT/$page-$form.report.json');const c=r.categories;const m=r.audits;console.log('$page $form'.padEnd(20), ['performance','accessibility','best-practices','seo'].map(k=>k.slice(0,4)+' '+Math.round(c[k].score*100)).join('  '), '| FCP', m['first-contentful-paint'].displayValue, 'LCP', m['largest-contentful-paint'].displayValue, 'TBT', m['total-blocking-time'].displayValue, 'CLS', m['cumulative-layout-shift'].displayValue)"
  done
done
