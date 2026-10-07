export type Minor = number;

export function priceLine(unitMinor: Minor, optionDeltas: Minor[], qty: number): Minor {
  if (!Number.isInteger(qty) || qty <= 0) return 0;
  const unit = unitMinor + optionDeltas.reduce((s, d) => s + d, 0);
  if (unit <= 0) return 0;
  return unit * qty;
}

export function priceOrder(
  lines: Minor[],
  deliveryFee: Minor,
  prepaymentPercent: number
): { items: Minor; total: Minor; prepayment: Minor } {
  const items = lines.reduce((s, l) => s + l, 0);
  const total = items + deliveryFee;
  const prepayment = Math.min(Math.max(Math.ceil((total * prepaymentPercent) / 100), 0), total);
  return { items, total, prepayment };
}

export function requiredLeadDays(
  cartProductLeadDays: (number | null)[],
  tenantMinLead: number
): number {
  const values = cartProductLeadDays.map((d) => d ?? tenantMinLead);
  const cartMax = values.length > 0 ? Math.max(...values) : 0;
  return Math.max(cartMax, tenantMinLead);
}
