# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**U-Haul Migration Tracker** is a Playwright-based scraper that collects daily one-way U-Haul truck rental pricing for 36 Bay Area migration corridors (3 origins x 12 destinations). Price asymmetry between outbound and inbound routes is a real-time proxy for migration demand.

### Core Features

- **Data Collection**: Playwright scraper navigates U-Haul's SPA reservation flow for 72 routes (36 corridors x 2 directions)
- **Bright Data Retry**: Failed routes are retried via Bright Data's Browser API (remote Playwright with anti-CAPTCHA)
- **Migration Pressure Index**: Computes MPI (outbound/inbound price ratio) with corridor-specific baselines and seasonal normalization
- **Dashboard**: Single-file Chart.js dashboard with D3 maps, heatmap, dark/light theme. Hosted on GitHub Pages.
- **GitHub Pages**: Static deployment at `https://jrenaldi79.github.io/uhaul-migration-tracker/`

---

## Essential Commands

### Development
```bash
npm run collect              # Run data collection headless (~10-15 min for 72 routes)
npm run collect:headed       # Run with visible browser for debugging
npm run serve                # Start dashboard on localhost:3847 (LAN accessible)
npx tsx src/bd-scrape.ts     # Retry failed routes via Bright Data Browser API
bash scripts/collect-and-publish.sh  # Full pipeline: collect → retry → deploy → push
bash scripts/deploy.sh       # Copy dashboard + data to docs/ for GitHub Pages
```

### Testing
```bash
npm test                     # Unit tests only (fast, <1s)
npm run test:watch           # Watch mode (unit tests)
npm run test:integration     # One real route scrape (~30s, hits U-Haul)
npm run test:e2e             # Full 14-route collection + dashboard validation (~5min)
npm run test:all             # All tests including integration and e2e
npm test tests/mpi.test.ts   # Single file (preferred during dev)
```

### Enforcement
```bash
node scripts/check-secrets.cjs        # Scan staged files for secrets
node scripts/check-file-sizes.cjs     # Check staged files against 300-line limit
node scripts/validate-docs.cjs        # Pre-commit: warn if CLAUDE.md may need update
node scripts/validate-docs.cjs --full # Full: compare CLAUDE.md against codebase
```

---

## Architecture

```
Daily collection (collect-and-publish.sh)
  -> collector.ts (Playwright + stealth, 72 routes, headless)
  -> bd-scrape.ts (Bright Data retry for failed routes)
  -> mpi.ts (compute MPI per corridor)
  -> baselines.ts (corridor baselines + seasonal normalization)
  -> storage.ts (upsert Collection to data/history.json)
  -> deploy.sh (copy to docs/)
  -> git push (GitHub Pages auto-deploys)

Dashboard (two modes)
  Local:  server.ts (Express on 0.0.0.0:3847) -> /api/data
  Static: docs/index.html fetches docs/data/history.json (GitHub Pages)
  -> public/index.html (D3 maps, Chart.js, heatmap, dark/light theme)
```

### Data Flow

```
U-Haul SPA (Playwright)
  -> Fill pickup/dropoff/date via discovered selectors
  -> Wait for results page (/Reservations/)
  -> Extract truck names (h3) + prices (b.block.text-3x)
  -> Parse price: $266.00 -> 266 (parseFloat + Math.round)
  -> Select 15ft reference price (fallback: 20ft -> 10ft -> 26ft)
  -> MPI = outbound_reference / inbound_reference
  -> Baseline signal (mean +/- 1 sigma, requires 14+ data points)
  -> Append to history.json (atomic write via tmp + rename)
```

---

## Directory Structure

<!-- AUTO:tree -->
src/
  collector.ts       # Playwright scraper with stealth, retry, CAPTCHA handling, --headed/--connect/--skip flags
  bd-scrape.ts       # Bright Data Browser API scraper — auto-detects and retries failed routes
  server.ts          # Express API on 0.0.0.0:3847 serving dashboard + JSON endpoints
  types.ts           # All TypeScript interfaces for data model and config
  mpi.ts             # MPI calculation, signal classification, reference price selection
  baselines.ts       # Corridor-specific baselines and seasonal normalization
  storage.ts         # JSON read/write with atomic writes and upsert merging
  utils.ts           # Delay, date formatting, structured logging
tests/
  mpi.test.ts              # 18 unit tests for MPI calculation
  baselines.test.ts        # 17 unit tests for baselines and seasonal
  storage.test.ts          # 6 unit tests for storage read/write
  collector.test.ts        # 2 unit tests for collector helper integration
  smoke.test.ts            # 1 smoke test
scripts/
  collect-and-publish.sh   # Full pipeline: collect → Bright Data retry → deploy → push
  deploy.sh                # Copy index.html + history.json to docs/ for GitHub Pages
  check-secrets.cjs        # Secret detection for pre-commit
  check-file-sizes.cjs     # File size enforcement (300-line limit)
  validate-docs.cjs        # CLAUDE.md drift detection
public/
  index.html               # Single-file dashboard (D3 maps, Chart.js, heatmap, dark/light theme)
docs/
  index.html               # GitHub Pages copy of dashboard
  data/history.json         # GitHub Pages copy of data (tracked in git)
<!-- /AUTO:tree -->

---

## Key Modules

<!-- AUTO:modules -->
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `types.ts` | Data model and config interfaces | Types only |
| `mpi.ts` | MPI calculation and signal classification | `calculateMpi()`, `classifySignal()`, `selectReferencePrice()` |
| `baselines.ts` | Corridor baselines and seasonal normalization | `computeBaseline()`, `classifySignalWithBaseline()`, `computeSeasonalFactor()`, `computeNormalizedMpi()` |
| `storage.ts` | JSON data store with upsert merging | `readHistory()`, `appendCollection()`, `upsertCollection()` |
| `utils.ts` | Shared utilities | `randomDelay()`, `formatDate()`, `getLookupDate()`, `log()`, `logError()` |
| `collector.ts` | Playwright scraper with stealth + CAPTCHA handling | CLI entry point (`--headed`, `--connect`, `--skip N`) |
| `bd-scrape.ts` | Bright Data Browser API retry scraper | CLI entry point (auto-detects missing routes) |
| `server.ts` | Express dashboard server (0.0.0.0:3847) | CLI entry point |
<!-- /AUTO:modules -->

---

## Code Quality Rules

### File Size Limits (HARD LIMITS)

| Entity | Max Lines | Action If Exceeded |
|--------|-----------|-------------------|
| **Any file** | 300 lines | MUST refactor immediately |
| **Any function** | 50 lines | MUST break into smaller functions |

### Documentation Sync (HARD RULE)

Any commit that adds, removes, or renames a file in `src/` or `scripts/` MUST include a CLAUDE.md update in the same commit. The pre-commit hook will warn if CLAUDE.md is not staged alongside tracked file changes.

### Complexity Red Flags

**STOP and refactor immediately if you see:**

- **>5 nested if/else statements** -> Extract to separate functions
- **>3 try/catch blocks in one function** -> Split error handling
- **>10 imports** -> Consider splitting the module
- **Duplicate logic** -> Extract to shared utilities

---

## Git Hooks

Managed by [husky](https://typicode.github.io/husky/).

### pre-commit (fast, <2s)

| Step | Script | What It Does |
|------|--------|-------------|
| 1. lint-staged | `npx lint-staged` | ESLint auto-fix on staged .ts files |
| 2. Secret scan | `node scripts/check-secrets.cjs` | Blocks commits with API keys or tokens |
| 3. File size check | `node scripts/check-file-sizes.cjs` | Blocks .ts files over 300 lines |
| 4. Doc drift warning | `node scripts/validate-docs.cjs` | Warns if `src/`/`scripts/` changed without CLAUDE.md |

### pre-push (thorough)

| Step | What It Does |
|------|-------------|
| 1. Test suite | `npm run test:all` (skipped if cached - see SHA-based caching below) |
| 2. Audit | `npm audit` (warn-only, does not block push) |

### Test Caching (SHA-based)

1. `npm test` succeeds -> `posttest` script writes HEAD SHA to `.test-passed`
2. `pre-push` hook compares current HEAD against `.test-passed`
3. Match = skip tests; Mismatch = run tests
4. `.test-passed` is gitignored

---

## Key Concept: Migration Pressure Index (MPI)

MPI = outbound_reference_price / inbound_reference_price

- **Flat thresholds** (< 14 data points): MPI > 1.5 = outbound pressure, 0.67-1.5 = balanced, < 0.67 = inbound pressure
- **Corridor baselines** (>= 14 data points): signal based on corridor mean +/- 1 standard deviation
- **Seasonal normalization** (>= 365 days): adjusts MPI for monthly pricing patterns

Reference truck: 15ft (most common household move size). Fallback: 20ft -> 10ft -> 26ft.

---

## U-Haul DOM Selectors (config.json)

All selectors externalized in config.json. When U-Haul changes their DOM, update config — not code.

| Element | Selector | Notes |
|---------|----------|-------|
| Pickup input | `#PickupLocation-TruckOnly` | jQuery UI autocomplete |
| Dropoff input | `#DropoffLocation-TruckOnly` | jQuery UI autocomplete |
| Autocomplete item | `.ui-autocomplete:visible li` | Must use `:visible` — multiple hidden autocompletes exist |
| Date input | `#PickupDate` | Use `pressSequentially` not `fill` (datepicker interferes) |
| Submit button | `#getRates` | Navigates to /Reservations/RatesTrucks/ |
| Truck name | `h3` | Filter for text containing `' Truck` |
| Truck price | `b.block.text-3x` | Format: `$266.00` — parse with `parseFloat` then `Math.round` |

---

## Config

All corridors, selectors, and settings in `config.json`. If U-Haul changes their DOM, update selectors in config.json -- not in code.

**Port conflict**: Port 3847 may be used by other dev servers. Check with `lsof -i :3847` before starting.

---

## Data

`data/history.json` is gitignored (local working copy). Each collection adds one entry with all 72 route results and 36 corridor MPI summaries. Atomic writes via tmp file + rename prevent corruption. `upsertCollection()` merges routes into same-day entries so partial runs don't create duplicates.

`docs/data/history.json` is tracked in git and serves as the GitHub Pages data source. Updated by `scripts/deploy.sh`.

---

## Critical Gotchas

- **Selectors are externalized**: U-Haul DOM selectors live in `config.json`, not hardcoded. When scraping breaks, update config first.
- **Never crash for one route**: The collector must continue if a single route fails. Log the error, set null prices, move on.
- **Baselines degrade gracefully**: With < 14 data points, flat thresholds apply. With < 365 days, no seasonal normalization. Code must handle both paths.
- **Atomic writes required**: Always write to `.tmp` then rename. history.json corruption loses irreplaceable data.
- **Headless by default**: Production collector runs headless. Use `--headed` only for debugging selector issues.
- **Price parsing**: U-Haul prices include cents (`$266.00`). Use `parseFloat` + `Math.round`, NOT `parseInt` with non-numeric stripping (which turns `$266.00` into `26600`).
- **Autocomplete :visible**: U-Haul has multiple hidden autocomplete dropdowns. Always use `.ui-autocomplete:visible li` to select the active one.
- **Date input**: Use `pressSequentially` with delay, not `fill`. The datepicker widget intercepts direct fills. Press Escape after to close the calendar popup.
- **Port 3847 conflicts**: Other dev servers may bind this port. Always check `lsof -i :3847` before starting the dashboard.
- **Server binds 0.0.0.0**: Dashboard is LAN-accessible for mobile viewing. Find your IP with `ipconfig getifaddr en0`.
- **Bright Data Browser API**: Remote browser needs 3-5 warmup connection attempts (proxy_error) before succeeding. Sessions are short-lived — extract data immediately after navigation, avoid unnecessary waits.
- **Bright Data CDP URL**: Stored in `BRIGHT_DATA_CDP` env var or hardcoded in bd-scrape.ts. Zone: `scraping_browser`, customer: `hl_e1f3975a`.
- **GitHub Pages**: Served from `docs/` on main branch. Run `bash scripts/deploy.sh` to update, then push. Dashboard fetches `/api/data` (Express) with fallback to `data/history.json` (static).
- **36 corridors**: 3 Bay Area origins (SF, SJ, Oakland) x 12 destinations. Config in `config.json`.
- **CAPTCHA mitigation**: Stealth plugin + Bright Data retry. Direct Playwright gets CAPTCHAed after ~10 routes. Bright Data Browser API handles CAPTCHAs automatically but has intermittent proxy_error timeouts.

---

## Docs Map

| Topic | File |
|-------|------|
| Full technical spec | `docs/uhaul-migration-tracker-spec.md` |
| Dashboard visual mock | `docs/uhaul-dashboard-preview.html` |
| Approved design | `docs/plans/2026-03-18-uhaul-migration-tracker-design.md` |
| Implementation plan | `docs/plans/2026-03-18-uhaul-implementation-plan.md` |
