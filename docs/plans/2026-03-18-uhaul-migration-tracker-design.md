# U-Haul Migration Tracker — Design Document

**Date:** 2026-03-18
**Status:** Approved
**Spec:** `docs/uhaul-migration-tracker-spec.md`
**Mock:** `docs/uhaul-dashboard-preview.html`

---

## Problem

U-Haul dynamically prices one-way truck rentals based on directional demand. Price asymmetry between outbound and inbound routes is a real-time proxy for migration pressure — faster than Census data, Redfin searches, or U-Haul's own Growth Index. No public API exists; the only extraction method is browser automation.

## Solution

A Playwright-based scraper running as a daily Claude Code cron task. Scrapes 14 routes (7 Bay Area corridors × 2 directions), computes a Migration Pressure Index per corridor, appends to a historical JSON data store, and serves a localhost dashboard.

## Key Design Decisions

### 1. Implementation Approach: Spec-Order Build with Recon

Build pure logic first (types → MPI → baselines → storage), then scraper, then dashboard. **Prepend a Playwright recon step** before any code to discover U-Haul's DOM selectors and validate the scraping flow works.

**Rationale:** Each layer is testable before the next depends on it. The recon step de-risks the scraper (biggest risk) before committing to the full build.

### 2. Scraper: Headless Default with --headed Flag

Production collector runs headless (unattended via cron). A `--headed` CLI flag enables a visible browser for debugging when U-Haul changes their DOM.

### 3. Corridor-Specific Baselines (V1)

Flat MPI thresholds (1.5x/0.67x) are misleading across corridors with different distance/price profiles. After 14 data points, each corridor gets its own baseline (rolling mean ± 1σ). Falls back to flat thresholds when insufficient data.

### 4. Seasonal Normalization (V1)

Summer moving season inflates all prices. After 365 days of data, the system computes monthly seasonal factors and provides a normalized MPI. Raw MPI remains available. Gracefully inactive until enough data exists.

### 5. Dark/Light Theme

Both themes share the mock's design language (JetBrains Mono, Instrument Serif, red/teal/amber signals). CSS custom properties via `data-theme` attribute. Toggle persisted to `localStorage`, respects `prefers-color-scheme` on first visit.

### 6. Dashboard: Spec Features, Not Mock Aspirations

The HTML mock is aspirational reference design. V1 implements the spec's dashboard section (§6): KPI cards, MPI trend chart, outbound/inbound bar chart, data table, date range filter, corridor filter. Mock extras (signal banner, sparklines, truck breakdown cards) are not in scope.

## Architecture

```
Cron trigger → collector.ts (Playwright, 14 routes)
    → mpi.ts (compute MPI per corridor)
    → baselines.ts (corridor baselines + seasonal normalization from full history)
    → storage.ts (append Collection to history.json)

Dashboard request → server.ts (Express, reads history.json)
    → /api/data, /api/latest, /api/corridors
    → public/index.html (Chart.js, dark/light theme)
```

## File Structure

```
~/claude-code-projects/uhaul/
├── package.json
├── tsconfig.json
├── config.json                  # Corridors, selectors, settings
├── src/
│   ├── collector.ts             # Playwright scraper (--headed/--headless)
│   ├── server.ts                # Express dashboard server
│   ├── types.ts                 # All TypeScript interfaces
│   ├── mpi.ts                   # MPI calculation + signal logic
│   ├── baselines.ts             # Corridor baselines + seasonal normalization
│   ├── storage.ts               # Read/append history.json
│   └── utils.ts                 # Delay, date formatting, logging
├── public/
│   └── index.html               # Dashboard (Chart.js, dark/light theme)
├── data/
│   └── history.json             # Accumulated pricing data (gitignored)
├── tests/
│   ├── collector.test.ts
│   ├── mpi.test.ts
│   ├── baselines.test.ts
│   └── storage.test.ts
├── docs/
│   ├── uhaul-migration-tracker-spec.md
│   ├── uhaul-dashboard-preview.html
│   └── plans/
│       └── 2026-03-18-uhaul-migration-tracker-design.md
├── .gitignore
└── CLAUDE.md
```

## Build Order

1. **Playwright recon** — headed browser, walk U-Haul flow, capture selectors into config.json
2. **Project scaffold** — package.json, tsconfig.json, config.json, directory structure
3. **types.ts** — all TypeScript interfaces (including baseline and seasonal fields)
4. **mpi.ts + mpi.test.ts** — MPI calculation, signal classification (TDD)
5. **baselines.ts + baselines.test.ts** — corridor baselines, seasonal normalization (TDD)
6. **storage.ts + storage.test.ts** — JSON read/append operations (TDD)
7. **collector.ts + collector.test.ts** — Playwright scraper, selectors from step 1
8. **server.ts** — Express API endpoints
9. **public/index.html** — Dashboard with Chart.js, dark/light theme
10. **E2E test** — full collection + dashboard verification
11. **CLAUDE.md** — project documentation
12. **Claude Code cron** — set up daily scheduled task

## What's NOT in V1

- Signal banner with aggregate status
- Sparklines in KPI cards
- Truck size breakdown detail cards
- Data backup/export (V2)
- Collection health dashboard (V2)
- Alert thresholds / webhooks (V2)
- Additional corridors or metros (Icebox)
- Moving company cross-reference (Icebox)

## Risks

| Risk | Mitigation |
|---|---|
| U-Haul DOM changes | Selectors externalized in config.json; recon step captures them; `--headed` flag for debugging |
| CAPTCHA | Detect and skip; log warning; continue with other routes |
| Seasonal/baseline code inactive early | Graceful degradation to flat thresholds; code is tested with synthetic data |
| history.json data loss | Atomic writes (tmp + rename); gitignored but V2 adds backup |
