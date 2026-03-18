# U-Haul Migration Tracker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Playwright-based scraper that collects daily U-Haul one-way truck rental pricing for 7 Bay Area migration corridors, computes a Migration Pressure Index, and serves a Chart.js dashboard with dark/light theme.

**Architecture:** Collector (Playwright) scrapes 14 routes → mpi.ts computes MPI → baselines.ts computes corridor-specific baselines and seasonal normalization → storage.ts appends to history.json → server.ts (Express) serves API + dashboard (public/index.html with Chart.js).

**Tech Stack:** TypeScript (strict), Playwright, Express, Chart.js (CDN), Vitest

**Reference docs:**
- Spec: `docs/uhaul-migration-tracker-spec.md`
- Design: `docs/plans/2026-03-18-uhaul-migration-tracker-design.md`
- Visual mock: `docs/uhaul-dashboard-preview.html`

---

## Task 0: Playwright Recon (Manual)

> This task is done manually in a headed browser before writing any code. The goal is to discover U-Haul's DOM selectors and validate that scraping is feasible.

**Step 1: Install Playwright globally if not already available**

Run:
```bash
npm init -y && npm install playwright && npx playwright install chromium
```

**Step 2: Open a headed browser and walk the U-Haul flow**

Create a temporary recon script `recon.ts`:
```typescript
import { chromium } from 'playwright';

async function recon() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto('https://www.uhaul.com/Truck-Rentals/');
  console.log('Page loaded. Inspect the DOM manually.');
  console.log('URL:', page.url());

  // Keep browser open for 5 minutes to inspect
  await page.waitForTimeout(300000);
  await browser.close();
}

recon();
```

Run: `npx tsx recon.ts`

**Step 3: Document selectors**

While the browser is open, use DevTools to identify:
- Pickup location input field -> selector
- Dropoff location input field -> selector
- Autocomplete dropdown items -> selector
- Date picker input -> selector
- Submit / "Get Rates" button -> selector
- Results container -> selector
- Individual truck cards -> selector
- Truck name within card -> selector
- Price within card -> selector

**Step 4: Test one full flow manually**

In the browser console or by modifying recon.ts:
1. Fill pickup: "San Francisco, CA"
2. Select autocomplete suggestion
3. Fill dropoff: "Sacramento, CA"
4. Select autocomplete suggestion
5. Set date 14 days from now
6. Click submit
7. Verify truck cards appear with prices

**Step 5: Record selectors**

Write discovered selectors down. These will go into `config.json` in Task 1.

**Step 6: Delete recon.ts**

Run: `rm recon.ts`

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: complete Playwright recon, selectors discovered"
```

> **BLOCKER:** Do not proceed to Task 1 until selectors are discovered and the scraping flow is validated. If U-Haul blocks scraping (CAPTCHA, etc.), stop and reassess.

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `config.json`
- Create: `.gitignore`
- Create: `src/` (directory)
- Create: `public/` (directory)
- Create: `data/` (directory)
- Create: `tests/` (directory)

**Step 1: Initialize project**

```bash
cd ~/claude-code-projects/uhaul
```

Remove the temporary package.json from recon if it exists:
```bash
rm -f package.json package-lock.json
rm -rf node_modules
```

**Step 2: Create package.json**

Create `package.json`:
```json
{
  "name": "uhaul-migration-tracker",
  "version": "1.0.0",
  "description": "U-Haul one-way pricing as real-time Bay Area migration proxy",
  "private": true,
  "type": "module",
  "scripts": {
    "collect": "tsx src/collector.ts",
    "collect:headed": "tsx src/collector.ts --headed",
    "serve": "tsx src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.21.0",
    "playwright": "^1.49.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 3: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create config.json**

Create `config.json` with all 7 corridors and the selectors discovered in Task 0:
```json
{
  "corridors": [
    {
      "name": "SF-Sacramento",
      "label": "SF ~ Sacramento",
      "outbound": { "from": "San Francisco, CA", "to": "Sacramento, CA" },
      "inbound": { "from": "Sacramento, CA", "to": "San Francisco, CA" }
    },
    {
      "name": "SF-Austin",
      "label": "SF ~ Austin",
      "outbound": { "from": "San Francisco, CA", "to": "Austin, TX" },
      "inbound": { "from": "Austin, TX", "to": "San Francisco, CA" }
    },
    {
      "name": "SF-LasVegas",
      "label": "SF ~ Las Vegas",
      "outbound": { "from": "San Francisco, CA", "to": "Las Vegas, NV" },
      "inbound": { "from": "Las Vegas, NV", "to": "San Francisco, CA" }
    },
    {
      "name": "SJ-Sacramento",
      "label": "SJ ~ Sacramento",
      "outbound": { "from": "San Jose, CA", "to": "Sacramento, CA" },
      "inbound": { "from": "Sacramento, CA", "to": "San Jose, CA" }
    },
    {
      "name": "Oakland-Portland",
      "label": "Oakland ~ Portland",
      "outbound": { "from": "Oakland, CA", "to": "Portland, OR" },
      "inbound": { "from": "Portland, OR", "to": "Oakland, CA" }
    },
    {
      "name": "SF-Seattle",
      "label": "SF ~ Seattle",
      "outbound": { "from": "San Francisco, CA", "to": "Seattle, WA" },
      "inbound": { "from": "Seattle, WA", "to": "San Francisco, CA" }
    },
    {
      "name": "SF-Denver",
      "label": "SF ~ Denver",
      "outbound": { "from": "San Francisco, CA", "to": "Denver, CO" },
      "inbound": { "from": "Denver, CO", "to": "San Francisco, CA" }
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
  "baselines": {
    "minDataPoints": 14,
    "seasonalMinDays": 365
  },
  "selectors": {
    "pickupInput": "DISCOVERED_IN_RECON",
    "dropoffInput": "DISCOVERED_IN_RECON",
    "autocompleteItem": "DISCOVERED_IN_RECON",
    "dateInput": "DISCOVERED_IN_RECON",
    "submitButton": "DISCOVERED_IN_RECON",
    "resultsContainer": "DISCOVERED_IN_RECON",
    "truckCard": "DISCOVERED_IN_RECON",
    "truckName": "DISCOVERED_IN_RECON",
    "truckPrice": "DISCOVERED_IN_RECON"
  }
}
```

> **Note:** Replace all `DISCOVERED_IN_RECON` values with the actual selectors found in Task 0. The label fields use `~` as placeholder for the bidirectional arrow character.

**Step 5: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
data/history.json
*.log
.DS_Store
```

**Step 6: Create directory structure**

```bash
mkdir -p src public data tests
```

**Step 7: Create empty data file**

Create `data/.gitkeep` (empty file).

**Step 8: Install dependencies**

Run: `npm install`

Expected: Clean install, no errors.

Run: `npx playwright install chromium`

Expected: Chromium browser downloaded.

**Step 9: Verify TypeScript compiles**

Create a minimal `src/types.ts` placeholder:
```typescript
// Placeholder - full types in Task 2
export {};
```

Run: `npx tsc --noEmit`

Expected: No errors.

**Step 10: Verify Vitest runs**

Create `tests/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('passes', () => {
    expect(true).toBe(true);
  });
});
```

Run: `npx vitest run`

Expected: 1 test passed.

**Step 11: Commit**

```bash
git init
git add package.json tsconfig.json config.json .gitignore src/types.ts tests/smoke.test.ts data/.gitkeep
git commit -m "chore: project scaffold with dependencies, config, and smoke test"
```

---

## Task 2: TypeScript Interfaces (types.ts)

**Files:**
- Modify: `src/types.ts`

**Step 1: Write all interfaces**

Replace `src/types.ts` with:
```typescript
// ===== Core Data Types =====

export interface TruckPrice {
  name: string;              // "15' Truck"
  price: number;             // 199 (dollars, no cents)
}

export interface RouteResult {
  from: string;              // "San Francisco, CA"
  to: string;                // "Sacramento, CA"
  corridor: string;          // "SF-Sacramento"
  direction: "outbound" | "inbound";
  lookupDate: string;        // YYYY-MM-DD (the move date used for the quote)
  trucks: TruckPrice[];
  referencePrice: number | null;
  referenceTruck: string;    // Which truck size was used as reference
  source: "playwright";
  error: string | null;
}

export interface BaselineData {
  mean: number | null;
  stdDev: number | null;
  dataPoints: number;
  active: boolean;           // true if >= minDataPoints
}

export interface CorridorSummary {
  name: string;              // "SF-Sacramento"
  label: string;             // "SF <-> Sacramento"
  outboundPrice: number | null;
  inboundPrice: number | null;
  mpi: number | null;
  signal: Signal;
  outboundTruck: string;
  inboundTruck: string;
  baseline: BaselineData;
  signalSource: "flat_threshold" | "corridor_baseline";
  seasonalFactor: number | null;
  normalizedMpi: number | null;
}

export interface Collection {
  date: string;              // "2026-03-17"
  timestamp: string;         // ISO 8601
  durationMs: number;
  routesAttempted: number;
  routesSucceeded: number;
  routes: RouteResult[];
  corridors: CorridorSummary[];
}

export interface HistoryFile {
  version: 1;
  collections: Collection[];
}

// ===== Signal Types =====

export type Signal = "outbound_pressure" | "inbound_pressure" | "balanced" | "no_data";

// ===== Config Types =====

export interface CorridorConfig {
  name: string;
  label: string;
  outbound: { from: string; to: string };
  inbound: { from: string; to: string };
}

export interface CollectionConfig {
  lookupDateOffsetDays: number;
  delayBetweenRoutesMs: [number, number];
  maxRetries: number;
  retryBackoffMs: number;
  timeoutMs: number;
  referenceTruckPreference: string[];
}

export interface DashboardConfig {
  port: number;
  autoOpen: boolean;
}

export interface BaselinesConfig {
  minDataPoints: number;
  seasonalMinDays: number;
}

export interface SelectorsConfig {
  pickupInput: string;
  dropoffInput: string;
  autocompleteItem: string;
  dateInput: string;
  submitButton: string;
  resultsContainer: string;
  truckCard: string;
  truckName: string;
  truckPrice: string;
}

export interface AppConfig {
  corridors: CorridorConfig[];
  collection: CollectionConfig;
  dashboard: DashboardConfig;
  baselines: BaselinesConfig;
  selectors: SelectorsConfig;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add all TypeScript interfaces for data model, config, and baselines"
```

---

## Task 3: MPI Calculation (TDD)

**Files:**
- Create: `src/mpi.ts`
- Create: `tests/mpi.test.ts`

**Step 1: Write the failing tests**

Create `tests/mpi.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calculateMpi, classifySignal, selectReferencePrice } from '../src/mpi.js';

describe('calculateMpi', () => {
  it('calculates MPI correctly for normal prices', () => {
    expect(calculateMpi(299, 129)).toBeCloseTo(2.318, 2);
  });

  it('returns null when outbound price is null', () => {
    expect(calculateMpi(null, 129)).toBeNull();
  });

  it('returns null when inbound price is null', () => {
    expect(calculateMpi(299, null)).toBeNull();
  });

  it('returns null when inbound price is 0', () => {
    expect(calculateMpi(299, 0)).toBeNull();
  });

  it('returns 1.0 when both prices are equal', () => {
    expect(calculateMpi(200, 200)).toBe(1.0);
  });
});

describe('classifySignal', () => {
  it('returns outbound_pressure for MPI > 3.0', () => {
    expect(classifySignal(3.5)).toBe('outbound_pressure');
  });

  it('returns outbound_pressure for MPI between 1.5 and 3.0', () => {
    expect(classifySignal(2.0)).toBe('outbound_pressure');
  });

  it('returns outbound_pressure at exactly 1.5', () => {
    expect(classifySignal(1.5)).toBe('outbound_pressure');
  });

  it('returns balanced for MPI between 0.67 and 1.5', () => {
    expect(classifySignal(1.0)).toBe('balanced');
  });

  it('returns balanced at just below 1.5', () => {
    expect(classifySignal(1.49)).toBe('balanced');
  });

  it('returns inbound_pressure for MPI below 0.67', () => {
    expect(classifySignal(0.5)).toBe('inbound_pressure');
  });

  it('returns inbound_pressure at exactly 0.67', () => {
    expect(classifySignal(0.67)).toBe('inbound_pressure');
  });

  it('returns balanced at just above 0.67', () => {
    expect(classifySignal(0.68)).toBe('balanced');
  });

  it('returns no_data for null', () => {
    expect(classifySignal(null)).toBe('no_data');
  });
});

describe('selectReferencePrice', () => {
  const preference = ["15' Truck", "20' Truck", "10' Truck", "26' Truck"];

  it('selects 15ft truck when available', () => {
    const trucks = [
      { name: "10' Truck", price: 99 },
      { name: "15' Truck", price: 199 },
      { name: "20' Truck", price: 299 },
    ];
    expect(selectReferencePrice(trucks, preference)).toEqual({
      price: 199,
      truck: "15' Truck",
    });
  });

  it('falls back to 20ft when 15ft unavailable', () => {
    const trucks = [
      { name: "10' Truck", price: 99 },
      { name: "20' Truck", price: 299 },
    ];
    expect(selectReferencePrice(trucks, preference)).toEqual({
      price: 299,
      truck: "20' Truck",
    });
  });

  it('falls back through preference order', () => {
    const trucks = [{ name: "26' Truck", price: 449 }];
    expect(selectReferencePrice(trucks, preference)).toEqual({
      price: 449,
      truck: "26' Truck",
    });
  });

  it('returns null price and empty truck for empty array', () => {
    expect(selectReferencePrice([], preference)).toEqual({
      price: null,
      truck: '',
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mpi.test.ts`

Expected: FAIL -- `mpi.ts` doesn't exist / functions not exported.

**Step 3: Write minimal implementation**

Create `src/mpi.ts`:
```typescript
import type { TruckPrice, Signal } from './types.js';

export function calculateMpi(
  outboundPrice: number | null,
  inboundPrice: number | null,
): number | null {
  if (outboundPrice === null || inboundPrice === null || inboundPrice === 0) {
    return null;
  }
  return outboundPrice / inboundPrice;
}

export function classifySignal(mpi: number | null): Signal {
  if (mpi === null) return 'no_data';
  if (mpi >= 1.5) return 'outbound_pressure';
  if (mpi <= 0.67) return 'inbound_pressure';
  return 'balanced';
}

export function selectReferencePrice(
  trucks: TruckPrice[],
  preference: string[],
): { price: number | null; truck: string } {
  for (const preferred of preference) {
    const match = trucks.find((t) => t.name === preferred);
    if (match) {
      return { price: match.price, truck: match.name };
    }
  }
  return { price: null, truck: '' };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mpi.test.ts`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/mpi.ts tests/mpi.test.ts
git commit -m "feat: MPI calculation with signal classification and reference price selection"
```

---

## Task 4: Corridor Baselines & Seasonal Normalization (TDD)

**Files:**
- Create: `src/baselines.ts`
- Create: `tests/baselines.test.ts`

**Step 1: Write the failing tests**

Create `tests/baselines.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  computeBaseline,
  classifySignalWithBaseline,
  computeSeasonalFactor,
  computeNormalizedMpi,
} from '../src/baselines.js';

describe('computeBaseline', () => {
  it('returns inactive baseline when fewer than 14 data points', () => {
    const mpiValues = [1.5, 2.0, 1.8, 2.1, 1.9];
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(false);
    expect(result.mean).toBeNull();
    expect(result.stdDev).toBeNull();
    expect(result.dataPoints).toBe(5);
  });

  it('returns active baseline at exactly 14 data points', () => {
    const mpiValues = Array(14).fill(2.0);
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(true);
    expect(result.mean).toBeCloseTo(2.0, 4);
    expect(result.stdDev).toBeCloseTo(0.0, 4);
    expect(result.dataPoints).toBe(14);
  });

  it('computes correct mean and stdDev from known series', () => {
    // Values: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
    // Mean = 7.5, Population StdDev = sqrt((14^2-1)/12) ~ 4.0311
    const mpiValues = Array.from({ length: 14 }, (_, i) => i + 1);
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(true);
    expect(result.mean).toBeCloseTo(7.5, 4);
    expect(result.stdDev).toBeCloseTo(4.0311, 2);
    expect(result.dataPoints).toBe(14);
  });

  it('filters out null MPI values', () => {
    const mpiValues: (number | null)[] = [
      ...Array(14).fill(2.0),
      null,
      null,
    ];
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(true);
    expect(result.dataPoints).toBe(14);
    expect(result.mean).toBeCloseTo(2.0, 4);
  });

  it('returns inactive when nulls reduce count below threshold', () => {
    const mpiValues: (number | null)[] = [
      ...Array(10).fill(2.0),
      null, null, null, null,
    ];
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(false);
    expect(result.dataPoints).toBe(10);
  });
});

describe('classifySignalWithBaseline', () => {
  it('returns outbound_pressure when MPI > mean + stdDev', () => {
    const baseline = { mean: 2.0, stdDev: 0.3, dataPoints: 20, active: true };
    expect(classifySignalWithBaseline(2.5, baseline)).toBe('outbound_pressure');
  });

  it('returns balanced when MPI is within mean +/- stdDev', () => {
    const baseline = { mean: 2.0, stdDev: 0.3, dataPoints: 20, active: true };
    expect(classifySignalWithBaseline(2.0, baseline)).toBe('balanced');
  });

  it('returns inbound_pressure when MPI < mean - stdDev', () => {
    const baseline = { mean: 2.0, stdDev: 0.3, dataPoints: 20, active: true };
    expect(classifySignalWithBaseline(1.5, baseline)).toBe('inbound_pressure');
  });

  it('returns balanced at exactly mean + stdDev boundary', () => {
    const baseline = { mean: 2.0, stdDev: 0.3, dataPoints: 20, active: true };
    expect(classifySignalWithBaseline(2.3, baseline)).toBe('balanced');
  });

  it('returns balanced at exactly mean - stdDev boundary', () => {
    const baseline = { mean: 2.0, stdDev: 0.3, dataPoints: 20, active: true };
    expect(classifySignalWithBaseline(1.7, baseline)).toBe('balanced');
  });

  it('returns no_data for null MPI', () => {
    const baseline = { mean: 2.0, stdDev: 0.3, dataPoints: 20, active: true };
    expect(classifySignalWithBaseline(null, baseline)).toBe('no_data');
  });
});

describe('computeSeasonalFactor', () => {
  it('returns null when fewer than 365 days of data', () => {
    const monthlyAverages = new Map<number, number>([
      [1, 2.0], [2, 2.1], [3, 2.2],
    ]);
    expect(computeSeasonalFactor(3, 100, monthlyAverages)).toBeNull();
  });

  it('computes correct seasonal factor from 12 months of data', () => {
    const monthlyAverages = new Map<number, number>([
      [1, 1.5], [2, 1.6], [3, 1.8], [4, 2.0], [5, 2.5], [6, 3.0],
      [7, 2.8], [8, 2.6], [9, 2.0], [10, 1.7], [11, 1.5], [12, 1.5],
    ]);
    const annualAvg = Array.from(monthlyAverages.values()).reduce((a, b) => a + b, 0) / 12;
    const result = computeSeasonalFactor(6, 400, monthlyAverages);
    expect(result).toBeCloseTo(3.0 / annualAvg, 4);
  });

  it('returns null for a month with no data', () => {
    const monthlyAverages = new Map<number, number>([
      [1, 2.0], [2, 2.1],
    ]);
    expect(computeSeasonalFactor(3, 400, monthlyAverages)).toBeNull();
  });
});

describe('computeNormalizedMpi', () => {
  it('returns normalized MPI when seasonal factor exists', () => {
    expect(computeNormalizedMpi(3.0, 1.5)).toBeCloseTo(2.0, 4);
  });

  it('returns null when seasonal factor is null', () => {
    expect(computeNormalizedMpi(3.0, null)).toBeNull();
  });

  it('returns null when MPI is null', () => {
    expect(computeNormalizedMpi(null, 1.5)).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/baselines.test.ts`

Expected: FAIL -- `baselines.ts` doesn't exist.

**Step 3: Write minimal implementation**

Create `src/baselines.ts`:
```typescript
import type { BaselineData, Signal } from './types.js';

export function computeBaseline(
  mpiValues: (number | null)[],
  minDataPoints: number,
): BaselineData {
  const valid = mpiValues.filter((v): v is number => v !== null);
  const count = valid.length;

  if (count < minDataPoints) {
    return { mean: null, stdDev: null, dataPoints: count, active: false };
  }

  const mean = valid.reduce((sum, v) => sum + v, 0) / count;

  const variance = valid.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);

  return { mean, stdDev, dataPoints: count, active: true };
}

export function classifySignalWithBaseline(
  mpi: number | null,
  baseline: BaselineData,
): Signal {
  if (mpi === null || baseline.mean === null || baseline.stdDev === null) {
    return 'no_data';
  }

  const upper = baseline.mean + baseline.stdDev;
  const lower = baseline.mean - baseline.stdDev;

  if (mpi > upper) return 'outbound_pressure';
  if (mpi < lower) return 'inbound_pressure';
  return 'balanced';
}

export function computeSeasonalFactor(
  currentMonth: number,
  totalDaysOfData: number,
  monthlyAverages: Map<number, number>,
): number | null {
  if (totalDaysOfData < 365) return null;

  const currentMonthAvg = monthlyAverages.get(currentMonth);
  if (currentMonthAvg === undefined) return null;

  const allAverages = Array.from(monthlyAverages.values());
  if (allAverages.length === 0) return null;

  const annualAvg = allAverages.reduce((sum, v) => sum + v, 0) / allAverages.length;
  if (annualAvg === 0) return null;

  return currentMonthAvg / annualAvg;
}

export function computeNormalizedMpi(
  mpi: number | null,
  seasonalFactor: number | null,
): number | null {
  if (mpi === null || seasonalFactor === null) return null;
  return mpi / seasonalFactor;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/baselines.test.ts`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/baselines.ts tests/baselines.test.ts
git commit -m "feat: corridor-specific baselines and seasonal normalization"
```

---

## Task 5: Storage Layer (TDD)

**Files:**
- Create: `src/storage.ts`
- Create: `tests/storage.test.ts`

**Step 1: Write the failing tests**

Create `tests/storage.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readHistory, appendCollection } from '../src/storage.js';
import type { Collection, HistoryFile } from '../src/types.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '../data/test-storage');
const TEST_FILE = join(TEST_DIR, 'history.json');

function makeCollection(date: string): Collection {
  return {
    date,
    timestamp: date + 'T07:00:00Z',
    durationMs: 180000,
    routesAttempted: 14,
    routesSucceeded: 14,
    routes: [],
    corridors: [],
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readHistory', () => {
  it('creates history file if it does not exist', () => {
    const result = readHistory(TEST_FILE);
    expect(result.version).toBe(1);
    expect(result.collections).toEqual([]);
  });

  it('reads back valid history', () => {
    const data: HistoryFile = {
      version: 1,
      collections: [makeCollection('2026-03-17')],
    };
    writeFileSync(TEST_FILE, JSON.stringify(data));
    const result = readHistory(TEST_FILE);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].date).toBe('2026-03-17');
  });

  it('handles empty file gracefully', () => {
    writeFileSync(TEST_FILE, '');
    const result = readHistory(TEST_FILE);
    expect(result.version).toBe(1);
    expect(result.collections).toEqual([]);
  });

  it('handles malformed JSON gracefully with backup', () => {
    writeFileSync(TEST_FILE, '{broken json!!!');
    const result = readHistory(TEST_FILE);
    expect(result.version).toBe(1);
    expect(result.collections).toEqual([]);
    expect(existsSync(TEST_FILE + '.backup')).toBe(true);
  });
});

describe('appendCollection', () => {
  it('appends to empty history', () => {
    const collection = makeCollection('2026-03-17');
    appendCollection(TEST_FILE, collection);
    const result = readHistory(TEST_FILE);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].date).toBe('2026-03-17');
  });

  it('appends without corrupting existing data', () => {
    const c1 = makeCollection('2026-03-17');
    const c2 = makeCollection('2026-03-18');
    appendCollection(TEST_FILE, c1);
    appendCollection(TEST_FILE, c2);
    const result = readHistory(TEST_FILE);
    expect(result.collections).toHaveLength(2);
    expect(result.collections[0].date).toBe('2026-03-17');
    expect(result.collections[1].date).toBe('2026-03-18');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/storage.test.ts`

Expected: FAIL -- `storage.ts` doesn't exist.

**Step 3: Write minimal implementation**

Create `src/storage.ts`:
```typescript
import type { Collection, HistoryFile } from './types.js';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { dirname } from 'node:path';

function emptyHistory(): HistoryFile {
  return { version: 1, collections: [] };
}

export function readHistory(filePath: string): HistoryFile {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    return emptyHistory();
  }

  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) return emptyHistory();

  try {
    const data = JSON.parse(raw) as HistoryFile;
    if (data.version === 1 && Array.isArray(data.collections)) {
      return data;
    }
    return emptyHistory();
  } catch {
    // Malformed JSON -- backup and recreate
    copyFileSync(filePath, filePath + '.backup');
    return emptyHistory();
  }
}

export function appendCollection(
  filePath: string,
  collection: Collection,
): void {
  const history = readHistory(filePath);
  history.collections.push(collection);

  // Atomic write: write to tmp, then rename
  const tmpPath = filePath + '.tmp';
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(history, null, 2));
  renameSync(tmpPath, filePath);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/storage.test.ts`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/storage.ts tests/storage.test.ts
git commit -m "feat: append-only JSON storage with atomic writes and corruption recovery"
```

---

## Task 6: Utility Functions

**Files:**
- Create: `src/utils.ts`

**Step 1: Write utility functions**

Create `src/utils.ts`:
```typescript
export function randomDelay(range: [number, number]): Promise<void> {
  const [min, max] = range;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getLookupDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatDate(d);
}

export function log(context: string, message: string): void {
  const ts = new Date().toISOString();
  console.log('[' + ts + '] [' + context + '] ' + message);
}

export function logError(context: string, message: string): void {
  const ts = new Date().toISOString();
  console.error('[' + ts + '] [' + context + '] ERROR: ' + message);
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

**Step 3: Commit**

```bash
git add src/utils.ts
git commit -m "feat: utility functions for delays, date formatting, and logging"
```

---

## Task 7: Collector (Playwright Scraper)

**Files:**
- Create: `src/collector.ts`
- Create: `tests/collector.test.ts`

> This is the hardest task. The selectors come from Task 0 recon. The collector uses all previously built modules.

**Step 1: Write the collector**

Create `src/collector.ts`. This file:
- Launches Playwright (headless by default, `--headed` flag for debug)
- Iterates over all 14 routes from config.json
- For each route: navigates to U-Haul, fills pickup/dropoff/date, submits, extracts truck prices
- Uses `page.locator()` API (not page.$$) for DOM queries
- Retries up to `maxRetries` times with backoff
- Selects reference price per the preference order
- Computes MPI and baselines from historical data
- Appends Collection to history.json via storage.ts
- Exits 0 on success (at least 1 route), exits 1 on total failure

Key implementation details:
- Use `page.locator(selector).all()` to get all truck cards, then `.locator(childSelector)` to extract name/price from each card
- Parse prices by stripping non-numeric characters and using `parseInt`
- Random delay between routes using `utils.randomDelay()`
- CAPTCHA detection: check for common CAPTCHA indicators (recaptcha iframe, specific text) and skip the route if detected
- The `computeMonthlyAverages` helper needs the full history with dates to group MPI by month for seasonal factors. For the initial implementation, iterate over all historical collections and group corridor MPI values by the month of their collection date.

**Step 2: Write integration test**

Create `tests/collector.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calculateMpi, selectReferencePrice } from '../src/mpi.js';
import type { TruckPrice } from '../src/types.js';

// Unit tests for collector helper logic.
// Full integration tests (real browser) are run manually via:
//   npx tsx src/collector.ts --headed

describe('collector helpers', () => {
  it('selectReferencePrice picks 15ft first', () => {
    const trucks: TruckPrice[] = [
      { name: "10' Truck", price: 99 },
      { name: "15' Truck", price: 199 },
      { name: "20' Truck", price: 299 },
      { name: "26' Truck", price: 449 },
    ];
    const ref = selectReferencePrice(trucks, [
      "15' Truck", "20' Truck", "10' Truck", "26' Truck",
    ]);
    expect(ref.price).toBe(199);
    expect(ref.truck).toBe("15' Truck");
  });

  it('MPI computation end-to-end with reference prices', () => {
    const outbound: TruckPrice[] = [{ name: "15' Truck", price: 299 }];
    const inbound: TruckPrice[] = [{ name: "15' Truck", price: 129 }];
    const pref = ["15' Truck"];
    const outRef = selectReferencePrice(outbound, pref);
    const inRef = selectReferencePrice(inbound, pref);
    const mpi = calculateMpi(outRef.price, inRef.price);
    expect(mpi).toBeCloseTo(2.318, 2);
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run`

Expected: All tests PASS (mpi, baselines, storage, collector helpers, smoke).

**Step 4: Commit**

```bash
git add src/collector.ts tests/collector.test.ts
git commit -m "feat: Playwright collector with retry logic, baseline integration, and headed/headless modes"
```

---

## Task 8: Express Dashboard Server

**Files:**
- Create: `src/server.ts`

**Step 1: Write the server**

Create `src/server.ts`:
```typescript
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHistory } from './storage.js';
import type { AppConfig } from './types.js';
import { log } from './utils.js';

const ROOT = join(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, 'config.json');
const DATA_PATH = join(ROOT, 'data', 'history.json');
const PUBLIC_PATH = join(ROOT, 'public');

const config: AppConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const app = express();

app.use(express.static(PUBLIC_PATH));

// Full history
app.get('/api/data', (_req, res) => {
  const history = readHistory(DATA_PATH);
  res.json(history);
});

// Most recent collection
app.get('/api/latest', (_req, res) => {
  const history = readHistory(DATA_PATH);
  const latest = history.collections[history.collections.length - 1] ?? null;
  res.json(latest);
});

// Corridor time series (optimized for charting)
app.get('/api/corridors', (_req, res) => {
  const history = readHistory(DATA_PATH);
  const corridorNames = config.corridors.map((c) => c.name);

  const series: Record<string, { date: string; mpi: number | null; normalizedMpi: number | null }[]> = {};
  for (const name of corridorNames) {
    series[name] = [];
  }

  for (const collection of history.collections) {
    for (const corridor of collection.corridors) {
      if (series[corridor.name]) {
        series[corridor.name].push({
          date: collection.date,
          mpi: corridor.mpi,
          normalizedMpi: corridor.normalizedMpi,
        });
      }
    }
  }

  res.json(series);
});

// Health check
app.get('/health', (_req, res) => {
  const history = readHistory(DATA_PATH);
  const latest = history.collections[history.collections.length - 1];
  res.json({
    status: 'ok',
    lastCollection: latest?.date ?? null,
    dataPoints: history.collections.length,
  });
});

const port = config.dashboard.port;
app.listen(port, () => {
  log('server', 'Dashboard running at http://localhost:' + port);
});
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: Express dashboard server with API endpoints and health check"
```

---

## Task 9: Dashboard HTML (Chart.js + Dark/Light Theme)

**Files:**
- Create: `public/index.html`

> This is a large single-file dashboard. Reference the mock at `docs/uhaul-dashboard-preview.html` for the dark theme design language, but implement only the spec features (section 6.4): header, filter row, KPI cards, MPI trend chart, outbound/inbound bar chart, data table, footer. Add dark/light theme toggle per section 6.2.

**Step 1: Create the dashboard HTML**

Create `public/index.html`. This file implements:

1. **CSS variables** for dark/light themes (all values from spec section 6.2)
   - Dark theme as default on `[data-theme="dark"]`
   - Light theme on `[data-theme="light"]`
   - Signal colors shared: `--accent-red: #ff4d4f`, `--accent-teal: #2dd4a8`, `--accent-amber: #f0a030`, `--accent-blue: #4d94ff`
   - Dim variants: hex alpha `22` for dark, `15` for light

2. **Theme toggle** - sun/moon SVG icon button in header
   - On click: toggle `data-theme` attribute on `<html>`
   - Persist to `localStorage('theme')`
   - On first visit (no stored pref): check `window.matchMedia('(prefers-color-scheme: dark)')`
   - Call `renderCharts()` after toggle to update Chart.js colors

3. **Header bar**
   - Title: "U-Haul Migration Tracker - Bay Area" (Instrument Serif, italic)
   - Subtitle: "Migration Pressure Index = Outbound Price / Inbound Price" (JetBrains Mono, uppercase, small)
   - Right side: last collected timestamp, data point count, date range
   - Theme toggle button

4. **Filter row**
   - Date range: two `<input type="date">` fields
   - Corridor multi-select: checkbox list of corridor names, all checked by default
   - Filters re-render charts and KPI cards client-side (no server call)

5. **KPI cards** (7-column grid, one per corridor)
   - Corridor name (uppercase, small)
   - MPI value (large, color-coded: red=outbound, amber=balanced, teal=inbound)
   - Day-over-day change (arrow + delta vs prior collection)
   - Outbound/inbound prices (colored: red out, teal in)
   - Signal badge text
   - Signal source indicator ("baseline" or "flat" in small text)

6. **Chart 1: MPI Trend Lines** (Chart.js line chart)
   - One line per corridor, color-coded per CORRIDOR_COLORS map
   - Horizontal dashed lines at 1.5x (red, dim) and 1.0x (white, dim) and 0.67x (teal, dim)
   - When baselines are active: show per-corridor threshold bands instead
   - Tension: 0.35, pointRadius: 0, pointHoverRadius: 5
   - Legend at bottom, tooltip with MPI and prices
   - 7D/30D/ALL filter buttons

7. **Chart 2: Outbound vs Inbound Pricing** (Chart.js grouped bar chart)
   - One group per corridor
   - Red bars = outbound, teal bars = inbound
   - Dollar amounts on Y axis

8. **Data table**
   - Columns: Corridor, Direction, 15ft Price, MPI, Delta Prior, Signal
   - Rows grouped by corridor (outbound + inbound pairs)
   - Sortable by clicking column headers
   - Color-coded signal pills

9. **Footer**
   - Left: "U-Haul one-way pricing - 15ft truck reference"
   - Right: "Auto-refreshes every 60s - Port 3847 - v1.0"

10. **Auto-refresh**: `setInterval(fetchAndRender, 60000)`

11. **`renderCharts()` function**: reads CSS custom properties from `getComputedStyle(document.documentElement)` and passes them as Chart.js config (grid color, tick color, tooltip bg, legend color). Called on initial load and after theme toggle.

12. **CDN imports**: Chart.js 4.x, chartjs-adapter-date-fns 3.x, Google Fonts (JetBrains Mono + Instrument Serif)

**Step 2: Test manually**

Run: `npx tsx src/server.ts`

Open: `http://localhost:3847`

Expected: Dashboard loads. If no data exists yet, show empty states gracefully (no JS errors, "No data collected yet" messages). Theme toggle switches between dark/light.

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: Chart.js dashboard with dark/light theme, KPI cards, MPI trend, price comparison, and data table"
```

---

## Task 10: E2E Verification

**Step 1: Run the collector against one route manually**

Run: `npx tsx src/collector.ts --headed`

Expected: Browser opens, navigates to U-Haul, scrapes routes, saves to `data/history.json`.

If this fails, debug selectors in `config.json` using the headed browser.

**Step 2: Verify data was saved**

Run: `cat data/history.json | head -50`

Expected: Valid JSON with at least one collection entry.

**Step 3: Start the dashboard and verify**

Run: `npx tsx src/server.ts`

Open: `http://localhost:3847`

Expected:
- KPI cards show real prices and MPI values
- MPI trend chart shows at least one data point
- Bar chart shows outbound vs inbound prices
- Data table shows all routes
- Theme toggle switches between dark/light
- Signal source shows "flat" (fewer than 14 data points)

**Step 4: Verify all tests pass**

Run: `npx vitest run`

Expected: All tests PASS (mpi, baselines, storage, collector helpers).

**Step 5: Commit**

```bash
git add -A
git commit -m "test: E2E verification complete, all tests passing"
```

---

## Task 11: Clean Up Smoke Test & Write CLAUDE.md

**Files:**
- Delete: `tests/smoke.test.ts`
- Create: `CLAUDE.md`

**Step 1: Remove smoke test**

```bash
rm tests/smoke.test.ts
```

**Step 2: Create CLAUDE.md**

Create `CLAUDE.md` with the content from spec section 10, including:
- What This Is
- Tech Stack
- Key Commands (`npm run collect`, `npm run collect:headed`, `npm run serve`, `npm test`)
- Architecture (all source files and their roles)
- Key Concept: MPI with flat thresholds, corridor baselines, and seasonal normalization
- Config (config.json for corridors, selectors, settings)
- Data (history.json is append-only and gitignored)
- Testing (vitest, what's covered)
- Style (strict mode, no classes, prefer functions, error isolation, structured logging)

**Step 3: Verify tests still pass**

Run: `npx vitest run`

Expected: All tests PASS (smoke test removed, others remain).

**Step 4: Commit**

```bash
git add CLAUDE.md
git rm tests/smoke.test.ts
git commit -m "docs: add CLAUDE.md project guide, remove smoke test"
```

---

## Task 12: Claude Code Cron Setup

**Step 1: Set up the scheduled task**

Using Claude Code's cron feature, create a scheduled task:

```
Task ID: uhaul-migration-collect
Schedule: 0 7 * * * (daily at 7:00 AM CT)
```

Prompt for the cron task:
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

**Step 2: Verify cron is registered**

Check that the cron task appears in Claude Code's task list.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: set up Claude Code daily cron for data collection"
```

---

## Summary

| Task | Description | Dependencies | Complexity |
|------|-------------|-------------|------------|
| 0 | Playwright recon | None | Medium (exploratory) |
| 1 | Project scaffold | Task 0 | Low |
| 2 | TypeScript interfaces | Task 1 | Low |
| 3 | MPI calculation (TDD) | Task 2 | Low |
| 4 | Baselines & seasonal (TDD) | Task 2 | Medium |
| 5 | Storage layer (TDD) | Task 2 | Low |
| 6 | Utility functions | Task 1 | Low |
| 7 | Playwright collector | Tasks 3, 4, 5, 6 | High |
| 8 | Express server | Task 5 | Low |
| 9 | Dashboard HTML | Task 8 | Medium |
| 10 | E2E verification | Tasks 7, 9 | Medium |
| 11 | CLAUDE.md + cleanup | Task 10 | Low |
| 12 | Cron setup | Task 11 | Low |

**Parallelizable:** Tasks 3, 4, 5, and 6 can all be built in parallel after Task 2.
