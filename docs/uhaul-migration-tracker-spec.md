# U-Haul Migration Price Tracker — Technical Specification

**Version:** 1.0
**Date:** March 17, 2026
**Author:** John Renaldi
**Status:** Ready for implementation
**Target:** Claude Code project at `~/claude-code-projects/uhaul`

---

## 1. Problem Statement

U-Haul dynamically prices one-way truck rentals based on directional demand. A truck from San Francisco to Sacramento costs significantly more than the reverse when more people are leaving SF than arriving. This price asymmetry is a real-time proxy for migration pressure — faster-moving than Census data (2-year lag), Redfin searches (quarterly), or U-Haul's own Growth Index (annual/semi-annual).

No public API exists. U-Haul retired static pricing pages and moved everything behind a JavaScript SPA reservation form. The only way to extract pricing is browser automation.

## 2. Solution Overview

A Playwright-based scraper that runs as a daily Claude Code scheduled task. It navigates U-Haul's reservation flow for 14 routes (7 corridors × 2 directions), extracts one-way truck rental pricing, computes a Migration Pressure Index (MPI) for each corridor, appends to a historical JSON data store, and regenerates a localhost dashboard.

### Architecture

```
┌─────────────────────────────────────┐
│  Claude Code Scheduled Task         │
│  (daily cron, e.g. 7:00 AM CT)     │
│                                     │
│  1. Spawns collector.ts             │
│  2. Opens dashboard in browser      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  collector.ts (Playwright)          │
│                                     │
│  For each of 14 routes:             │
│    → Navigate to U-Haul             │
│    → Fill pickup/dropoff/date       │
│    → Extract truck prices           │
│    → Retry on failure (3x)          │
│                                     │
│  Compute MPI per corridor           │
│  Append to data/history.json        │
│  Trigger dashboard rebuild          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  data/history.json                  │
│  (append-only, one entry per day)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Dashboard (Express + Chart.js)     │
│  http://localhost:3847              │
│                                     │
│  Reads history.json on each request │
│  Renders:                           │
│    - MPI trend lines (all corrs)    │
│    - Outbound vs Inbound bar chart  │
│    - KPI cards per corridor         │
│    - Route detail table             │
│    - Date range filter              │
└─────────────────────────────────────┘
```

## 3. Corridors and Routes

7 corridors, 14 routes total. Each corridor has an outbound (leaving Bay Area) and inbound (arriving Bay Area) leg.

| # | Corridor | Outbound Route | Inbound Route | Rationale |
|---|----------|---------------|---------------|-----------|
| 1 | SF–Sacramento | San Francisco, CA → Sacramento, CA | Sacramento, CA → San Francisco, CA | #1 Bay Area destination (Redfin Q4 2025) |
| 2 | SF–Austin | San Francisco, CA → Austin, TX | Austin, TX → San Francisco, CA | Historic tech exodus corridor |
| 3 | SF–Las Vegas | San Francisco, CA → Las Vegas, NV | Las Vegas, NV → San Francisco, CA | Top Sunbelt destination |
| 4 | SJ–Sacramento | San Jose, CA → Sacramento, CA | Sacramento, CA → San Jose, CA | South Bay to Central Valley |
| 5 | Oakland–Portland | Oakland, CA → Portland, OR | Portland, OR → Oakland, CA | Pacific NW corridor |
| 6 | SF–Seattle | San Francisco, CA → Seattle, WA | Seattle, WA → San Francisco, CA | Pacific NW tech corridor |
| 7 | SF–Denver | San Francisco, CA → Denver, CO | Denver, CO → San Francisco, CA | Mountain West corridor |

## 4. Data Collection

### 4.1 Scraping Strategy

U-Haul's truck rental flow is a multi-step JavaScript SPA. The scraper must:

1. Navigate to the equipment search page
2. Enter pickup city/state
3. Enter dropoff city/state
4. Select a pickup date (14 days from today — far enough to avoid "no availability" but close enough for demand-reflective pricing)
5. Submit the form
6. Wait for results to render
7. Extract truck names and one-way starting prices from the results page

### 4.2 Playwright Flow (per route)

```
1. goto('https://www.uhaul.com/Truck-Rentals/')
   - or the /EquipmentSearch/ page if it pre-fills
2. Fill pickup location input with "{city}, {state}"
   - Wait for autocomplete dropdown
   - Select first matching suggestion
3. Fill dropoff location input with "{city}, {state}"
   - Wait for autocomplete dropdown
   - Select first matching suggestion
4. Fill pickup date (MM/DD/YYYY, 14 days from now)
5. Click "Get Rates" / "Search" button
6. Wait for results container to appear (networkidle or specific selector)
7. Extract all truck cards:
   - Truck name/size (e.g., "10' Truck", "15' Truck", "20' Truck", "26' Truck")
   - Starting one-way price (dollar amount)
8. Return structured data
```

### 4.3 Selectors (to be discovered during implementation)

These will need to be identified from the live DOM during initial development. Key elements to locate:

- Pickup location input field
- Dropoff location input field
- Autocomplete dropdown items
- Date picker input
- Submit / "Get Rates" button
- Results container
- Individual truck cards within results
- Truck name element within each card
- Price element within each card

**Implementation note:** Use `data-testid` attributes if available; fall back to `aria-label`, `placeholder`, or CSS class selectors. Avoid fragile XPath. Add a selector mapping config so selectors can be updated without code changes if U-Haul modifies their DOM.

### 4.4 Rate Limiting and Politeness

- Default to **headless** mode (runs unattended via Claude Code cron)
- Support a `--headed` CLI flag for debugging (e.g., `npx tsx src/collector.ts --headed`)
- Insert a 2–4 second random delay between route queries (not between page loads within a single route)
- Run routes sequentially, not in parallel (one browser context)
- Use a realistic user agent string
- Set viewport to 1280×800 (desktop)
- Accept cookies if prompted
- Total expected runtime: ~3–5 minutes for 14 routes

### 4.5 Error Handling

| Failure Mode | Behavior |
|---|---|
| Page doesn't load | Retry up to 3 times with 5s backoff |
| Autocomplete doesn't appear | Retry with alternate city format (e.g., "San Francisco" vs "San Francisco, CA") |
| No trucks available for date | Try date +7 days; if still none, log null for that route |
| Price element not found | Log null, don't fail entire run |
| Partial collection (< 10 of 14 routes) | Still save what was collected; mark incomplete |
| Full failure (0 routes) | Log error, don't write to history, exit non-zero |
| CAPTCHA detected | Log warning, skip route, continue with others |

### 4.6 Reference Price Selection

The **15ft truck** is the reference price for MPI calculation (most common household move size — 1-2 bedroom). If 15ft is unavailable for a route, fall back in order: 20ft → 10ft → 26ft. Log which truck size was used.

## 5. Data Schema

### 5.1 History File: `data/history.json`

Append-only. One entry per collection run.

```typescript
interface HistoryFile {
  version: 1;
  collections: Collection[];
}

interface Collection {
  date: string;              // "2026-03-17" (collection date)
  timestamp: string;         // ISO 8601 with timezone
  durationMs: number;        // Total collection time
  routesAttempted: number;   // Should be 14
  routesSucceeded: number;   // How many returned data
  routes: RouteResult[];
  corridors: CorridorSummary[];
}

interface RouteResult {
  from: string;              // "San Francisco, CA"
  to: string;                // "Sacramento, CA"
  corridor: string;          // "SF-Sacramento"
  direction: "outbound" | "inbound";
  lookupDate: string;        // The move date used for the quote (YYYY-MM-DD)
  trucks: TruckPrice[];      // All trucks returned
  referencePrice: number | null;   // 15ft price (or fallback)
  referenceTruck: string;    // Which truck size was used as reference
  source: "playwright";
  error: string | null;      // Error message if this route failed
}

interface TruckPrice {
  name: string;              // "15' Truck"
  price: number;             // 199 (dollars, no cents)
}

interface CorridorSummary {
  name: string;              // "SF-Sacramento"
  label: string;             // "SF ↔ Sacramento"
  outboundPrice: number | null;
  inboundPrice: number | null;
  mpi: number | null;        // outboundPrice / inboundPrice
  signal: "outbound_pressure" | "inbound_pressure" | "balanced" | "no_data";
  outboundTruck: string;     // Which truck size used for outbound reference
  inboundTruck: string;      // Which truck size used for inbound reference
  baseline: {
    mean: number | null;     // Rolling mean MPI (null if < 14 data points)
    stdDev: number | null;   // Standard deviation
    dataPoints: number;      // How many collections contributed
    active: boolean;         // true if >= 14 data points
  };
  signalSource: "flat_threshold" | "corridor_baseline";
  seasonalFactor: number | null;    // null if < 365 days of data
  normalizedMpi: number | null;     // MPI / seasonalFactor, null if not active
}
```

### 5.2 MPI Calculation

```
MPI = outbound_reference_price / inbound_reference_price
```

| MPI Range | Signal | Interpretation |
|---|---|---|
| > 3.0 | `outbound_pressure` | Heavy out-migration demand |
| 1.5–3.0 | `outbound_pressure` | Elevated out-migration |
| 0.67–1.5 | `balanced` | Normal / equilibrium |
| 0.33–0.67 | `inbound_pressure` | In-migration demand |
| < 0.33 | `inbound_pressure` | Heavy in-migration |
| null | `no_data` | One or both directions failed |

**Threshold note:** The 1.5x outbound pressure threshold is the initial default. Once sufficient data exists, corridor-specific baselines replace the flat threshold (see §5.4).

### 5.3 Corridor-Specific Baselines

Short-haul corridors (SF→Sacramento, ~90 miles) naturally price differently than long-haul corridors (SF→Austin, ~1,700 miles). A flat 1.5x threshold treats them identically, which produces false signals. The system computes per-corridor baselines once enough data exists.

**Baseline calculation:**
- Requires a minimum of 14 data points for a corridor before activating
- Baseline MPI = rolling mean of all collected MPI values for that corridor
- Standard deviation computed alongside the mean
- Signal thresholds become relative to the corridor's own baseline:
  - `outbound_pressure`: MPI > baseline + 1σ
  - `balanced`: baseline − 1σ ≤ MPI ≤ baseline + 1σ
  - `inbound_pressure`: MPI < baseline − 1σ
- If fewer than 14 data points exist, fall back to the flat thresholds (1.5 / 0.67)

**Storage:** Baselines are recomputed on each collection run from the full history — no separate baseline file needed. The `CorridorSummary` is extended:

```typescript
interface CorridorSummary {
  // ... existing fields ...
  baseline: {
    mean: number | null;       // Rolling mean MPI
    stdDev: number | null;     // Standard deviation
    dataPoints: number;        // How many collections contributed
    active: boolean;           // true if >= 14 data points
  };
  signalSource: "flat_threshold" | "corridor_baseline";
}
```

**Dashboard integration:** When corridor baselines are active, the MPI trend chart shows per-corridor threshold bands (mean ± 1σ) instead of the flat 1.5x/0.67x dashed lines. KPI cards display whether the signal is baseline-derived or flat-threshold.

### 5.4 Seasonal Normalization

Summer moving season (May–August) inflates all U-Haul prices, creating false outbound pressure signals if the MPI is compared against non-seasonal baselines. The system applies seasonal normalization once a full year of data exists.

**Normalization approach:**
- Requires 365+ days of data before activating (until then, raw MPI is used)
- Compute monthly MPI averages per corridor from the prior year
- Seasonal factor for month M = (monthly average MPI for M) / (annual average MPI)
- Normalized MPI = raw MPI / seasonal factor

**Storage:** Seasonal factors are recomputed on each collection run when sufficient data exists. Added to `CorridorSummary`:

```typescript
interface CorridorSummary {
  // ... existing fields ...
  seasonalFactor: number | null;    // null if < 365 days of data
  normalizedMpi: number | null;     // MPI / seasonalFactor, null if not active
}
```

**Dashboard integration:** When seasonal normalization is active, charts show a toggle between "Raw MPI" and "Seasonally Adjusted MPI". The default view switches to seasonally adjusted. A note in the footer indicates when seasonal normalization activated and how many months of data back it.

### 5.3 Config File: `config.json`

```json
{
  "corridors": [
    {
      "name": "SF-Sacramento",
      "label": "SF ↔ Sacramento",
      "outbound": { "from": "San Francisco, CA", "to": "Sacramento, CA" },
      "inbound": { "from": "Sacramento, CA", "to": "San Francisco, CA" }
    }
  ],
  "collection": {
    "lookupDateOffsetDays": 14,
    "delayBetweenRoutesMs": [2000, 4000],
    "maxRetries": 3,
    "retryBackoffMs": 5000,
    "timeoutMs": 30000,
    "referenceTruckPreference": ["15' Truck", "20' Truck", "10' Truck", "26' Truck"]
  },
  "dashboard": {
    "port": 3847,
    "autoOpen": true
  },
  "selectors": {
    "pickupInput": "",
    "dropoffInput": "",
    "autocompleteItem": "",
    "dateInput": "",
    "submitButton": "",
    "resultsContainer": "",
    "truckCard": "",
    "truckName": "",
    "truckPrice": ""
  }
}
```

The `selectors` block is intentionally empty — these must be discovered from the live DOM during initial development. Externalizing them here means U-Haul DOM changes can be fixed by editing config, not code.

## 6. Dashboard

### 6.1 Stack

- **Server:** Express.js (lightweight, serves static + API)
- **Frontend:** Single HTML page with Chart.js (loaded from CDN)
- **No build step.** The dashboard is a single `public/index.html` that fetches data from an Express API endpoint.

### 6.2 Theme System

The dashboard supports dark and light themes. The HTML mock (`docs/uhaul-dashboard-preview.html`) defines the dark theme as the reference design. Both themes share the same design language: JetBrains Mono + Instrument Serif typography, the red/teal/amber signal palette, subtle grid background, and card-based layout.

**Theme toggle:** A sun/moon icon button in the header bar. Persisted to `localStorage` so it survives page reloads. Respects `prefers-color-scheme` on first visit (no stored preference).

**Implementation:** CSS custom properties on `:root` with a `[data-theme="light"]` / `[data-theme="dark"]` attribute on `<html>`. All colors reference variables — no hardcoded hex in component styles.

**Dark theme** (from mock):
| Variable | Value |
|---|---|
| `--bg-deep` | `#0a0c10` |
| `--bg-surface` | `#12151c` |
| `--bg-elevated` | `#1a1e28` |
| `--bg-hover` | `#222838` |
| `--border` | `#2a3040` |
| `--border-subtle` | `#1e2230` |
| `--text-primary` | `#e8eaf0` |
| `--text-secondary` | `#8890a4` |
| `--text-muted` | `#555d74` |
| `--text-dim` | `#3a4158` |

**Light theme:**
| Variable | Value |
|---|---|
| `--bg-deep` | `#f4f5f7` |
| `--bg-surface` | `#ffffff` |
| `--bg-elevated` | `#f9fafb` |
| `--bg-hover` | `#f0f1f3` |
| `--border` | `#d8dce3` |
| `--border-subtle` | `#e8ebf0` |
| `--text-primary` | `#1a1e28` |
| `--text-secondary` | `#555d74` |
| `--text-muted` | `#8890a4` |
| `--text-dim` | `#b0b8c8` |

**Signal colors are shared across both themes** — they're designed to work on both dark and light backgrounds:
- `--accent-red`: `#ff4d4f` (outbound pressure)
- `--accent-teal`: `#2dd4a8` (inbound pressure)
- `--accent-amber`: `#f0a030` (balanced)
- `--accent-blue`: `#4d94ff` (info/neutral)

The dim variants (`--accent-red-dim`, etc.) adjust opacity per theme: `22` (hex alpha) for dark, `15` for light, to maintain contrast.

**Chart.js theming:** Chart grid lines, tick labels, tooltip backgrounds, and legend text colors must update when the theme toggles. Use a `renderCharts()` function that reads current CSS variables and re-renders.

### 6.3 Express Server (`server.ts`)


```
GET /                → serves public/index.html
GET /api/data        → returns full history.json contents
GET /api/latest      → returns most recent collection only
GET /api/corridors   → returns corridor time series (optimized for charting)
GET /health          → { status: "ok", lastCollection: "2026-03-17", dataPoints: 42 }
```

The server reads `data/history.json` on each API request (no caching; file is small). Start with `npm run serve` or auto-started by the scheduled task.

### 6.4 Dashboard UI

**Header bar:**
- Title: "U-Haul Migration Tracker — Bay Area"
- Subtitle: "Migration Pressure Index = Outbound Price / Inbound Price"
- Meta: data point count, date range

**Filter row:**
- Date range picker (start/end)
- Corridor multi-select (filter which corridors appear in charts)

**KPI cards (one per corridor):**
- Corridor name
- Current MPI (large number, e.g., "2.34x")
- Day-over-day change (e.g., "+0.12 vs prior")
- Outbound / inbound prices (e.g., "$299 out / $129 in")
- Signal badge: color-coded (red = outbound pressure, gray = balanced, green = inbound)

**Chart 1: MPI Trend Lines**
- X-axis: date
- Y-axis: MPI ratio
- One line per corridor (color-coded)
- Horizontal dashed line at 1.5x (outbound threshold)
- Horizontal dashed line at 1.0x (equilibrium)
- Tooltip shows exact MPI and prices on hover
- Chart.js line chart with tension: 0.3

**Chart 2: Latest Outbound vs Inbound Pricing**
- Grouped bar chart
- One group per corridor
- Red bars = outbound price, green bars = inbound price
- Chart.js bar chart

**Chart 3: MPI Heatmap / Sparklines (stretch goal)**
- Small multiples or sparklines showing 7-day and 30-day MPI trend per corridor
- Visual at-a-glance for which corridors are heating up

**Data table:**
- All routes from latest collection
- Columns: Route, Direction, Reference Price, All Truck Sizes, MPI, Signal
- Sortable by any column

**Footer:**
- Data source attribution
- Last collection timestamp
- Reference truck explanation

### 6.5 Dashboard Behavior

- On page load, fetches `/api/data` and renders everything client-side
- Date range filter re-renders charts and KPI cards (no server round-trip)
- Corridor filter shows/hides lines on Chart 1 and groups on Chart 2
- Auto-refreshes every 60 seconds (in case a collection just ran)

## 7. Scheduled Task

### 7.1 Claude Code Task Configuration

```
Task ID: uhaul-migration-collect
Schedule: daily at 7:00 AM CT (0 7 * * *)
```

### 7.2 Task Prompt

```
Run the U-Haul migration price collector:

1. cd ~/claude-code-projects/uhaul
2. Run: npx tsx src/collector.ts
3. If the collector exits 0, report the summary (routes collected, biggest MPI changes)
4. If the collector exits non-zero, report the error
5. After collection, ensure the dashboard server is running:
   - Check if port 3847 is in use
   - If not, run: npx tsx src/server.ts &
6. Open the dashboard: open http://localhost:3847
```

### 7.3 Manual Run

```bash
cd ~/claude-code-projects/uhaul
npx tsx src/collector.ts        # collect data
npx tsx src/server.ts           # start dashboard (if not running)
open http://localhost:3847      # view dashboard
```

## 8. File Structure

```
~/claude-code-projects/uhaul/
├── package.json
├── tsconfig.json
├── config.json                  # Corridors, selectors, settings
├── src/
│   ├── collector.ts             # Main Playwright scraper
│   ├── server.ts                # Express dashboard server
│   ├── types.ts                 # TypeScript interfaces (from §5)
│   ├── mpi.ts                   # MPI calculation + signal logic
│   ├── baselines.ts             # Corridor-specific baseline + seasonal normalization
│   ├── storage.ts               # Read/append history.json
│   └── utils.ts                 # Delay, date formatting, logging
├── public/
│   └── index.html               # Dashboard (Chart.js, single file)
├── data/
│   └── history.json             # Accumulated pricing data (gitignored)
├── tests/
│   ├── collector.test.ts        # Playwright scraper tests
│   ├── mpi.test.ts              # MPI calculation tests
│   └── storage.test.ts          # Storage read/write tests
├── .gitignore
└── CLAUDE.md                    # Project instructions for Claude Code
```

## 9. Dependencies

```json
{
  "dependencies": {
    "express": "^4.21.0",
    "playwright": "^1.49.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "vitest": "^2.1.0"
  }
}
```

**No other dependencies.** Chart.js loaded from CDN in the HTML. Keep the dependency tree minimal.

## 10. CLAUDE.md (for Claude Code)

```markdown
# U-Haul Migration Price Tracker

## What This Is
Playwright-based scraper that collects daily one-way U-Haul truck rental
pricing for Bay Area migration corridors. Price asymmetry between outbound
and inbound routes is a real-time proxy for migration demand.

## Tech Stack
TypeScript, Playwright, Express, Chart.js (CDN). No build step for frontend.

## Key Commands
- `npx tsx src/collector.ts` — Run data collection (takes ~3-5 min)
- `npx tsx src/server.ts` — Start dashboard on localhost:3847
- `npx vitest` — Run tests

## Architecture
- collector.ts: Playwright browser automation → scrapes U-Haul reservation flow
- storage.ts: Append-only JSON data store (data/history.json)
- mpi.ts: Computes Migration Pressure Index (outbound_price / inbound_price)
- baselines.ts: Corridor-specific baselines (mean ± 1σ) + seasonal normalization
- server.ts: Express server with /api/data endpoint, serves public/index.html
- public/index.html: Single-file Chart.js dashboard

## Key Concept: Migration Pressure Index (MPI)
MPI = outbound_reference_price / inbound_reference_price
- Flat thresholds (< 14 data points): MPI > 1.5 = outbound, 0.67-1.5 = balanced, < 0.67 = inbound
- Corridor baselines (≥ 14 data points): signal based on mean ± 1σ per corridor
- Seasonal normalization (≥ 365 days): adjusts MPI for monthly pricing patterns
Reference truck: 15ft (most common household move size)

## Config
All corridors, selectors, and settings in config.json. If U-Haul changes
their DOM, update selectors in config.json — not in code.

## Data
data/history.json is append-only and gitignored. Each collection adds one
entry with all 14 route results and 7 corridor MPI summaries.

## Testing
Use vitest. Tests for MPI calculation, storage operations, and
Playwright scraper (mock responses for unit tests; real browser for e2e).

## Style
- TypeScript strict mode
- No classes, prefer functions
- Error handling: never crash the whole run for one failed route
- Logging: prefix with timestamp and route name
```

## 11. Test Plan

### 11.1 Unit Tests

**mpi.test.ts:**
- Calculates MPI correctly for normal prices (e.g., 299/129 = 2.318)
- Returns null when either price is null
- Returns null when inbound price is 0
- Classifies signal correctly at each threshold boundary (1.5, 0.67)
- Edge case: both prices equal → MPI 1.0, signal "balanced"

**baselines.test.ts:**
- Returns inactive baseline with null mean/stdDev when < 14 data points
- Computes correct mean and stdDev from known MPI series
- Signal uses flat thresholds when baseline inactive
- Signal uses corridor-specific mean ± 1σ when baseline active
- Boundary: exactly 14 data points activates baseline
- Seasonal factor returns null when < 365 days of data
- Computes correct seasonal factor from 12 months of known data
- Normalized MPI = raw MPI / seasonal factor
- Seasonal normalization gracefully handles months with no data (interpolate or skip)

**storage.test.ts:**
- Creates history.json if it doesn't exist
- Appends collection without corrupting existing data
- Reads back what was written
- Handles empty file gracefully
- Handles malformed JSON gracefully (backup + recreate)

### 11.2 Integration Tests

**collector.test.ts:**
- Scrapes at least one real route (SF→Sacramento) and returns valid data
- Handles timeout gracefully (returns error, doesn't crash)
- Respects retry logic
- Generates valid Collection object with all required fields

### 11.3 E2E Test

- Full collection run (all 14 routes)
- Verify history.json was appended
- Verify dashboard serves and shows data
- Run manually before scheduling; should complete in < 5 minutes

## 12. Implementation Sequence

Build in this order:

1. **Project scaffold:** package.json, tsconfig.json, config.json, directory structure
2. **types.ts:** All TypeScript interfaces (including baseline and seasonal fields)
3. **mpi.ts + mpi.test.ts:** MPI calculation (pure logic, easy to test first)
4. **baselines.ts + baselines.test.ts:** Corridor-specific baselines and seasonal normalization
   - Baseline: rolling mean/stdDev, signal classification via mean ± 1σ
   - Seasonal: monthly factor computation, normalized MPI
   - Both degrade gracefully when insufficient data exists
5. **storage.ts + storage.test.ts:** JSON read/append operations
6. **collector.ts:** Playwright scraper — this is the hardest part
   - Start with one route (SF→Sacramento) to discover selectors
   - Fill in config.json selectors based on what you find in the DOM
   - Then generalize to all 14 routes
   - Integrate baseline computation into post-collection pipeline
7. **server.ts:** Express API
8. **public/index.html:** Dashboard (baseline threshold bands + seasonal toggle when active)
9. **E2E test:** Full collection + dashboard verification
10. **CLAUDE.md:** Project documentation

## 13. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| U-Haul changes DOM structure | High (over months) | Collection breaks | Selectors externalized in config.json; scheduled task reports failures |
| U-Haul adds CAPTCHA | Medium | Blocks scraping | Detect and skip; fall back to fewer routes; consider residential proxy |
| No trucks available for chosen date | Low | Null prices | Try alternate dates (+7, +21 days) |
| Rate limiting / IP blocking | Low | Blocks all routes | 2-4s delays between routes; single sequential browser; rotate UA if needed |
| Playwright install issues | Low | Can't run | `npx playwright install chromium` in setup |
| Data file corruption | Low | Lose history | Atomic writes (write to .tmp, rename); backup before append |

## 14. Future Enhancements (V2)

- **Data backup & export:** CSV export button on the dashboard. Periodic backup of history.json to a second location (e.g., cloud storage or a separate directory). history.json is append-only and gitignored — it's the entire value of the project and currently has zero redundancy.
- **Collection health dashboard:** Success rate per route over time, which routes fail most often, scraper uptime metrics. Surfaces DOM changes early before all data goes stale.
- **Alert thresholds:** Slack webhook or Discord notification when any corridor MPI crosses a configurable threshold (e.g., baseline + 2σ). Simpler than email infrastructure for a personal project.

## 15. Icebox

- **Additional Bay Area corridors:** SF→Phoenix, SF→Boise, SF→Reno — known exodus destinations. Add before expanding to new metros.
- **Additional metros:** LA, NYC, Chicago as comparison points (separate product, different framing)
- **Moving company cross-reference:** Budget, Penske pricing for same routes (high maintenance, marginal signal improvement)
- **Weekly email/Slack digest:** Summary of MPI trends on a schedule
