#!/bin/bash
# Deploy dashboard to docs/ for GitHub Pages
# Run after collection to publish updated data

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Deploying dashboard to docs/..."

# Copy dashboard HTML
cp "$ROOT/public/index.html" "$ROOT/docs/index.html"

# Copy data
mkdir -p "$ROOT/docs/data"
cp "$ROOT/data/history.json" "$ROOT/docs/data/history.json"

echo "Done. Files updated in docs/"
echo "  docs/index.html ($(wc -c < "$ROOT/docs/index.html" | tr -d ' ') bytes)"
echo "  docs/data/history.json ($(wc -c < "$ROOT/docs/data/history.json" | tr -d ' ') bytes)"
