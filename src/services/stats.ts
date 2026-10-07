import { getDb } from '../db/client.js';
import { customers, orders, funnelEvents } from '../db/schema.js';
import { and, eq, gte, sql, inArray } from 'drizzle-orm';

export interface Stats {
  newCustomersTotal: number;
  newCustomersBySource: { source: string; count: number }[];
  funnel: { type: string; count: number }[];
  ordersByStatus: { status: string; count: number }[];
  revenueMinor: number;
  confirmedOrders: number;
  avgDecisionMinutes: number | null;
  botOnlyInteractions: number;
}

export async function computeStats(tenantId: string, days: number, now: Date): Promise<Stats> {
  const db = getDb();
  const from = new Date(now.getTime() - days * 24 * 3600_000);

  const newCustomers = await db
    .select({ count: sql<number>`count(*)`, source: customers.source })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), gte(customers.firstSeenAt, from)))
    .groupBy(customers.source);

  const newCustomersTotal = newCustomers.reduce((s, r) => s + r.count, 0);
  const newCustomersBySource = newCustomers
    .map((r) => ({ source: r.source ?? 'неизвестно', count: r.count }))
    .sort((a, b) => b.count - a.count);

  const funnel = await db
    .select({ type: funnelEvents.type, count: sql<number>`count(*)` })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.tenantId, tenantId), gte(funnelEvents.at, from)))
    .groupBy(funnelEvents.type);

  const ordersByStatus = await db
    .select({ status: orders.status, count: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, from)))
    .groupBy(orders.status);

  const confirmed = await db
    .select({ total: orders.totalMinor })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        gte(orders.createdAt, from),
        inArray(orders.status, ['confirmed', 'ready', 'completed'])
      )
    );
  const revenueMinor = confirmed.reduce((s, r) => s + r.total, 0);
  const confirmedOrders = confirmed.length;

  const decided = await db
    .select({ createdAt: orders.createdAt, decidedAt: orders.decidedAt })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, from)));
  const decidedDeltas = decided
    .filter((o) => o.decidedAt !== null)
    .map((o) => (o.decidedAt!.getTime() - o.createdAt.getTime()) / 60000);
  const avgDecisionMinutes =
    decidedDeltas.length > 0
      ? Math.round(decidedDeltas.reduce((a, b) => a + b, 0) / decidedDeltas.length)
      : null;

  // Customers who viewed catalog/faq without any free_text in the period
  const views = await db
    .selectDistinct({ customerId: funnelEvents.customerId })
    .from(funnelEvents)
    .where(
      and(
        eq(funnelEvents.tenantId, tenantId),
        gte(funnelEvents.at, from),
        inArray(funnelEvents.type, ['catalog_view', 'faq_view'])
      )
    );
  const freed = new Set<string>();
  for (const v of views) {
    const had = await db
      .select({ id: funnelEvents.id })
      .from(funnelEvents)
      .where(
        and(
          eq(funnelEvents.tenantId, tenantId),
          eq(funnelEvents.customerId, v.customerId),
          gte(funnelEvents.at, from),
          inArray(funnelEvents.type, ['free_text'])
        )
      )
      .limit(1);
    if (had.length === 0) {
      freed.add(v.customerId);
    }
  }
  // count of catalog_view+faq_view events from those customers
  let botOnlyInteractions = 0;
  for (const id of freed) {
    const rows = await db
      .select({ type: funnelEvents.type })
      .from(funnelEvents)
      .where(
        and(
          eq(funnelEvents.tenantId, tenantId),
          eq(funnelEvents.customerId, id),
          gte(funnelEvents.at, from),
          inArray(funnelEvents.type, ['catalog_view', 'faq_view'])
        )
      );
    botOnlyInteractions += rows.length;
  }

  return {
    newCustomersTotal,
    newCustomersBySource,
    funnel: funnel.map((f) => ({ type: f.type, count: f.count })),
    ordersByStatus: ordersByStatus.map((o) => ({ status: o.status, count: o.count })),
    revenueMinor,
    confirmedOrders,
    avgDecisionMinutes,
    botOnlyInteractions,
  };
}
