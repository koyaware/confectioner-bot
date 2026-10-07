import { getDb } from '../db/client.js';
import { tenants, orders } from '../db/schema.js';
import { addDays, toIsoDate, zonedTimeToUtc } from '../lib/time.js';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { createJob } from '../jobs/create.js';
import { isFeatureEnabled } from './feature-flags.js';
import { OrderStatus } from '../types.js';

export interface DigestOrder {
  id: string;
  number: number;
  status: string;
}

export interface DigestSummary {
  date: string;
  todayCount: number;
  tomorrowCount: number;
  awaitingDecisionCount: number;
  awaitingPaymentCount: number;
  today: DigestOrder[];
  tomorrow: DigestOrder[];
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
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      dueDate: orders.dueDate,
    })
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
  const today = rows
    .filter((r) => r.dueDate === dateIso)
    .map((r) => ({ id: r.id, number: r.number, status: r.status }));
  const tomorrowRows = rows
    .filter((r) => r.dueDate === tomorrow)
    .map((r) => ({ id: r.id, number: r.number, status: r.status }));
  const todayCount = today.length;
  const tomorrowCount = tomorrowRows.length;
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
    today,
    tomorrow: tomorrowRows,
  };
}

export async function ensureDailyDigestJobs(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const activeTenants = await db
    .select({ id: tenants.id, timezone: tenants.timezone, digestHour: tenants.digestHour })
    .from(tenants)
    .where(eq(tenants.status, 'active'));

  for (const t of activeTenants) {
    // Only today's digest: tomorrow's job is ensured when tomorrow arrives.
    // A missed runAt fires immediately on the next poll.
    // Tenants can switch the digest off per shop via the daily_digest flag.
    if (!(await isFeatureEnabled(t.id, 'daily_digest', true))) {
      continue;
    }
    const date = toIsoDate(now, t.timezone);
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

export function formatDigest(summary: DigestSummary): string {
  const lines = [
    `<b>Сводка на ${summary.date}</b>`,
    '',
    `Заказов на сегодня: ${summary.todayCount}`,
    ...summary.today.map((o) => `  • №${o.number} — ${o.status}`),
    `Заказов на завтра: ${summary.tomorrowCount}`,
    ...summary.tomorrow.map((o) => `  • №${o.number} — ${o.status}`),
    `Без решения: ${summary.awaitingDecisionCount}`,
    `Ждут оплаты: ${summary.awaitingPaymentCount}`,
  ];
  return lines.join('\n');
}
