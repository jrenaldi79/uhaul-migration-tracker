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
