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
    expect(selectReferencePrice(trucks, preference)).toEqual({ price: 199, truck: "15' Truck" });
  });
  it('falls back to 20ft when 15ft unavailable', () => {
    const trucks = [
      { name: "10' Truck", price: 99 },
      { name: "20' Truck", price: 299 },
    ];
    expect(selectReferencePrice(trucks, preference)).toEqual({ price: 299, truck: "20' Truck" });
  });
  it('falls back through preference order', () => {
    const trucks = [{ name: "26' Truck", price: 449 }];
    expect(selectReferencePrice(trucks, preference)).toEqual({ price: 449, truck: "26' Truck" });
  });
  it('returns null price and empty truck for empty array', () => {
    expect(selectReferencePrice([], preference)).toEqual({ price: null, truck: '' });
  });
});
