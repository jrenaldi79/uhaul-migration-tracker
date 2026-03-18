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
    const mpiValues = Array.from({ length: 14 }, (_, i) => i + 1);
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(true);
    expect(result.mean).toBeCloseTo(7.5, 4);
    expect(result.stdDev).toBeCloseTo(4.0311, 2);
    expect(result.dataPoints).toBe(14);
  });

  it('filters out null MPI values', () => {
    const mpiValues: (number | null)[] = [...Array(14).fill(2.0), null, null];
    const result = computeBaseline(mpiValues, 14);
    expect(result.active).toBe(true);
    expect(result.dataPoints).toBe(14);
    expect(result.mean).toBeCloseTo(2.0, 4);
  });

  it('returns inactive when nulls reduce count below threshold', () => {
    const mpiValues: (number | null)[] = [...Array(10).fill(2.0), null, null, null, null];
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
    const monthlyAverages = new Map<number, number>([[1, 2.0], [2, 2.1], [3, 2.2]]);
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
    const monthlyAverages = new Map<number, number>([[1, 2.0], [2, 2.1]]);
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
