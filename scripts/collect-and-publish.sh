#!/bin/bash
# Daily collection + publish to GitHub Pages
# Handles partial scrapes gracefully — always publishes what we have
# Can be re-run to fill in missing routes from failed attempts
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== U-Haul Migration Tracker — Daily Collection ==="
echo "Date: $(date)"

# Step 1: Run the main collector (headless, stealth)
echo ""
echo "--- Step 1: Collecting via headless Playwright ---"
npx tsx src/collector.ts 2>&1 || true
# Note: collector saves incrementally via upsertCollection, so even partial runs produce data

# Step 2: Check for missing routes and retry via Bright Data
echo ""
echo "--- Step 2: Checking for missing routes ---"
MISSING=$(node -e "
const { readFileSync } = require('fs');
const { join } = require('path');
const h = JSON.parse(readFileSync(join('$ROOT', 'data', 'history.json'), 'utf-8'));
const today = new Date().toISOString().split('T')[0];
const latest = h.collections.find(c => c.date === today) || h.collections[h.collections.length - 1];
const failed = latest.routes.filter(r => r.error !== null);
console.log(failed.length);
")

if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING routes missing — retrying via Bright Data Browser API..."
  npx tsx src/bd-scrape.ts 2>&1 || true
else
  echo "All routes collected successfully!"
fi

# Step 3: Deploy to docs/ for GitHub Pages
echo ""
echo "--- Step 3: Publishing to GitHub Pages ---"
bash scripts/deploy.sh

# Step 4: Commit and push
echo ""
echo "--- Step 4: Pushing to GitHub ---"
git add docs/data/history.json docs/index.html
if git diff --cached --quiet; then
  echo "No changes to publish"
else
  git commit -m "data: daily collection $(date +%Y-%m-%d)"
  git push origin main --no-verify
  echo "Published!"
fi

echo ""
echo "=== Done ==="
