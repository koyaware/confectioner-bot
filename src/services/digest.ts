import { getDb } from '../db/client.js';
import { tenants, orders } from '../db/schema.js';
import { addDays, toIsoDate, zonedTimeToUtc } from '../lib/time.js';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { createJob } from '../jobs/create.js';
import { OrderStatus } from '../types.js';

export interface DigestSummary {
  date: string;
  todayCount: number;
  tomorrowCount: number;
  awaitingDecisionCount: number;
  awaitingPaymentCount: number;
}

const ACTIVE_STATUSES: OrderStatus[] = [
  'new',
  'awaiting_payment',
  'payment_review',
  'confirmed',
  'ready',
];

export async function computeDigest(tenantId: string, dateIso: string): Promise<DigestSummary> {
  const db = getDb();
  const rows = await db
    .select({ status: orders.status, dueDate: orders.dueDate })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        gte(orders.dueDate, dateIso),
        lte(orders.dueDate, addDays(dateIso, 1)),
        inArray(orders.status, [...ACTIVE_STATUSES])
      )
    );

  const tomorrow = addDays(dateIso, 1);
  const todayCount = rows.filter((r) => r.dueDate === dateIso).length;
  const tomorrowCount = rows.filter((r) => r.dueDate === tomorrow).length;
  const allActive = await db
    .select({ status: orders.status })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.status, [...ACTIVE_STATUSES])));

  const awaitingDecisionCount = allActive.filter((r) => r.status === 'new').length;
  const awaitingPaymentCount = allActive.filter(
    (r) => r.status === 'awaiting_payment' || r.status === 'payment_review'
  ).length;

  return {
    date: dateIso,
    todayCount,
    tomorrowCount,
    awaitingDecisionCount,
    awaitingPaymentCount,
  };
}

export async function ensureDailyDigestJobs(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const activeTenants = await db
    .select({ id: tenants.id, timezone: tenants.timezone, digestHour: tenants.digestHour })
    .from(tenants)
    .where(eq(tenants.status, 'active'));

  for (const t of activeTenants) {
    const todayIso = toIsoDate(now, t.timezone);
    const dates = [todayIso, addDays(todayIso, 1)];
    for (const date of dates) {
      const runAt = zonedTimeToUtc(date, `${String(t.digestHour).padStart(2, '0')}:00`, t.timezone);
      await createJob({
        type: 'owner.daily_digest',
        tenantId: t.id,
        payload: { tenantId: t.id, date },
        runAt,
        dedupeKey: `digest:${t.id}:${date}`,
      });
    }
  }
}

export function formatDigest(summary: DigestSummary): string {
  return [
    `<b>Сводка на ${summary.date}</b>`,
    '',
    `Заказов на сегодня: ${summary.todayCount}`,
    `Заказов на завтра: ${summary.tomorrowCount}`,
    `Без решения: ${summary.awaitingDecisionCount}`,
    `Ждут оплаты: ${summary.awaitingPaymentCount}`,
  ].join('\n');
}
