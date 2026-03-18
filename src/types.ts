// ===== Core Data Types =====

export interface TruckPrice {
  name: string;              // "15' Truck"
  price: number;             // 199 (dollars, no cents)
}

export interface RouteResult {
  from: string;              // "San Francisco, CA"
  to: string;                // "Sacramento, CA"
  corridor: string;          // "SF-Sacramento"
  direction: 'outbound' | 'inbound';
  lookupDate: string;        // YYYY-MM-DD (the move date used for the quote)
  trucks: TruckPrice[];
  referencePrice: number | null;
  referenceTruck: string;    // Which truck size was used as reference
  source: 'playwright';
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
  label: string;             // "SF ↔ Sacramento"
  outboundPrice: number | null;
  inboundPrice: number | null;
  mpi: number | null;
  signal: Signal;
  outboundTruck: string;
  inboundTruck: string;
  baseline: BaselineData;
  signalSource: 'flat_threshold' | 'corridor_baseline';
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

export type Signal =
  | 'outbound_pressure'
  | 'inbound_pressure'
  | 'balanced'
  | 'no_data';

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
