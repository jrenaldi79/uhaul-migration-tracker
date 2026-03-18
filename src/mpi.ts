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
