import { getDb } from '../db/client.js';
import { customers, orders, funnelEvents } from '../db/schema.js';
import { and, eq, gte, sql, inArray, isNotNull } from 'drizzle-orm';

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

const REVENUE_STATUSES = ['confirmed', 'ready', 'completed'] as const;

export async function computeStats(tenantId: string, days: number, now: Date): Promise<Stats> {
  const db = getDb();
  const from = new Date(now.getTime() - days * 24 * 3600_000);

  const newCustomers = await db
    .select({ count: sql<number>`count(*)`, source: customers.source })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), gte(customers.firstSeenAt, from)))
    .groupBy(customers.source);

  const newCustomersTotal = newCustomers.reduce((s, r) => s + Number(r.count), 0);
  const newCustomersBySource = newCustomers
    .map((r) => ({ source: r.source ?? 'неизвестно', count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);

  const funnel = await db
    .select({ type: funnelEvents.type, count: sql<number>`count(*)` })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.tenantId, tenantId), gte(funnelEvents.at, from)))
    .groupBy(funnelEvents.type);

  // Current snapshot: all orders by status, so old active orders don't vanish.
  const ordersByStatus = await db
    .select({ status: orders.status, count: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.tenantId, tenantId))
    .groupBy(orders.status);

  // Revenue and decision time: orders decided inside the window.
  const decided = await db
    .select({
      total: orders.totalMinor,
      status: orders.status,
      createdAt: orders.createdAt,
      decidedAt: orders.decidedAt,
    })
    .from(orders)
    .where(
      and(eq(orders.tenantId, tenantId), isNotNull(orders.decidedAt), gte(orders.decidedAt, from))
    );
  const revenueRows = decided.filter((o) =>
    (REVENUE_STATUSES as readonly string[]).includes(o.status)
  );
  const revenueMinor = revenueRows.reduce((s, r) => s + r.total, 0);
  const confirmedOrders = revenueRows.length;
  const decidedDeltas = revenueRows
    .filter((o) => o.decidedAt !== null)
    .map((o) => (o.decidedAt!.getTime() - o.createdAt.getTime()) / 60000);
  const avgDecisionMinutes =
    decidedDeltas.length > 0
      ? Math.round(decidedDeltas.reduce((a, b) => a + b, 0) / decidedDeltas.length)
      : null;

  // Bot-only: catalog/faq views with no free_text at or after the view.
  // Single query, computed in memory.
  const events = await db
    .select({
      customerId: funnelEvents.customerId,
      type: funnelEvents.type,
      at: funnelEvents.at,
    })
    .from(funnelEvents)
    .where(
      and(
        eq(funnelEvents.tenantId, tenantId),
        gte(funnelEvents.at, from),
        inArray(funnelEvents.type, ['catalog_view', 'faq_view', 'free_text'])
      )
    );
  const freeTextAt = new Map<string, number[]>();
  const views: { customerId: string; at: number }[] = [];
  for (const e of events) {
    const at = new Date(e.at).getTime();
    if (e.type === 'free_text') {
      const arr = freeTextAt.get(e.customerId) ?? [];
      arr.push(at);
      freeTextAt.set(e.customerId, arr);
    } else {
      views.push({ customerId: e.customerId, at });
    }
  }
  let botOnlyInteractions = 0;
  for (const v of views) {
    const texts = freeTextAt.get(v.customerId) ?? [];
    if (!texts.some((t) => t >= v.at)) {
      botOnlyInteractions++;
    }
  }

  return {
    newCustomersTotal,
    newCustomersBySource,
    funnel: funnel.map((f) => ({ type: f.type, count: Number(f.count) })),
    ordersByStatus: ordersByStatus.map((o) => ({ status: o.status, count: Number(o.count) })),
    revenueMinor,
    confirmedOrders,
    avgDecisionMinutes,
    botOnlyInteractions,
  };
}
