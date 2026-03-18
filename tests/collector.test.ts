import { describe, it, expect } from 'vitest';
import { calculateMpi, selectReferencePrice } from '../src/mpi.js';
import type { TruckPrice } from '../src/types.js';

describe('collector helpers', () => {
  it('selectReferencePrice picks 15ft first', () => {
    const trucks: TruckPrice[] = [
      { name: "10' Truck", price: 99 },
      { name: "15' Truck", price: 199 },
      { name: "20' Truck", price: 299 },
      { name: "26' Truck", price: 449 },
    ];
    const ref = selectReferencePrice(trucks, [
      "15' Truck",
      "20' Truck",
      "10' Truck",
      "26' Truck",
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
