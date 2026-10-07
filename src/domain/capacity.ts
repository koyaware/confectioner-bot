export const OCCUPYING_STATUSES = [
  'new',
  'awaiting_payment',
  'payment_review',
  'confirmed',
  'ready',
  'completed',
] as const;

export function usedUnits(orders: { status: string; capacityUnits: number }[]): number {
  return orders
    .filter((o) => (OCCUPYING_STATUSES as readonly string[]).includes(o.status))
    .reduce((s, o) => s + o.capacityUnits, 0);
}

export function effectiveCapacity(
  defaultCapacity: number,
  override?: { capacity: number; isClosed: boolean }
): { capacity: number; closed: boolean } {
  if (override) {
    return { capacity: override.capacity, closed: override.isClosed };
  }
  return { capacity: defaultCapacity, closed: false };
}
