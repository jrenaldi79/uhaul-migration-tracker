# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**U-Haul Migration Tracker** is a Playwright-based scraper that collects daily one-way U-Haul truck rental pricing for 7 Bay Area migration corridors. Price asymmetry between outbound and inbound routes is a real-time proxy for migration demand.

### Core Features

- **Data Collection**: Playwright scraper navigates U-Haul's SPA reservation flow for 14 routes (7 corridors x 2 directions)
- **Migration Pressure Index**: Computes MPI (outbound/inbound price ratio) with corridor-specific baselines and seasonal normalization
- **Dashboard**: Express + Chart.js localhost dashboard with dark/light theme, KPI cards, trend charts, and data table

---

## Essential Commands

### Development
```bash
npm run collect              # Run data collection headless (~4-5 min)
npm run collect:headed       # Run with visible browser for debugging
npm run serve                # Start dashboard on localhost:3847 (LAN accessible)
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
Cron trigger (daily 7am CT)
  -> collector.ts (Playwright, 14 routes, headless)
  -> mpi.ts (compute MPI per corridor)
  -> baselines.ts (corridor baselines + seasonal normalization)
  -> storage.ts (append Collection to data/history.json)

Dashboard request
  -> server.ts (Express on 0.0.0.0:3847, LAN accessible)
  -> /api/data, /api/latest, /api/corridors, /health
  -> public/index.html (Chart.js, dark/light theme, responsive)
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
  collector.ts       # Playwright scraper with retry logic and --headed flag
  server.ts          # Express API on 0.0.0.0:3847 serving dashboard + JSON endpoints
  types.ts           # All TypeScript interfaces for data model and config
  mpi.ts             # MPI calculation, signal classification, reference price selection
  baselines.ts       # Corridor-specific baselines and seasonal normalization
  storage.ts         # Append-only JSON read/write with atomic writes
  utils.ts           # Delay, date formatting, structured logging
tests/
  mpi.test.ts              # 18 unit tests for MPI calculation
  baselines.test.ts        # 17 unit tests for baselines and seasonal
  storage.test.ts          # 6 unit tests for storage read/write
  collector.test.ts        # 2 unit tests for collector helper integration
  smoke.test.ts            # 1 smoke test
  integration/
    scrape-one-route.test.ts  # Real browser scrape of SF->Sacramento (~30s)
  e2e/
    full-collection.test.ts   # Full 14-route collection + dashboard API validation (~5min)
scripts/
  check-secrets.cjs    # Secret detection for pre-commit
  check-file-sizes.cjs # File size enforcement (300-line limit)
  validate-docs.cjs    # CLAUDE.md drift detection
public/
  index.html           # Single-file Chart.js dashboard with dark/light theme
<!-- /AUTO:tree -->

---

## Key Modules

<!-- AUTO:modules -->
| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `types.ts` | Data model and config interfaces | Types only |
| `mpi.ts` | MPI calculation and signal classification | `calculateMpi()`, `classifySignal()`, `selectReferencePrice()` |
| `baselines.ts` | Corridor baselines and seasonal normalization | `computeBaseline()`, `classifySignalWithBaseline()`, `computeSeasonalFactor()`, `computeNormalizedMpi()` |
| `storage.ts` | Append-only JSON data store | `readHistory()`, `appendCollection()` |
| `utils.ts` | Shared utilities | `randomDelay()`, `formatDate()`, `getLookupDate()`, `log()`, `logError()` |
| `collector.ts` | Playwright scraper orchestrator | CLI entry point |
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

`data/history.json` is append-only and gitignored. Each collection adds one entry with all 14 route results and 7 corridor MPI summaries. Atomic writes via tmp file + rename prevent corruption.

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

---

## Docs Map

| Topic | File |
|-------|------|
| Full technical spec | `docs/uhaul-migration-tracker-spec.md` |
| Dashboard visual mock | `docs/uhaul-dashboard-preview.html` |
| Approved design | `docs/plans/2026-03-18-uhaul-migration-tracker-design.md` |
| Implementation plan | `docs/plans/2026-03-18-uhaul-implementation-plan.md` |
