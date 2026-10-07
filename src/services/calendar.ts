import { getDb } from '../db/client.js';
import { capacityOverrides } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export async function getCapacityForDate(
  tenantId: string,
  date: string
): Promise<{ capacity: number | null; isClosed: boolean; isOverride: boolean }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(capacityOverrides)
    .where(and(eq(capacityOverrides.tenantId, tenantId), eq(capacityOverrides.date, date)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { capacity: null, isClosed: false, isOverride: false };
  }
  return { capacity: row.capacity, isClosed: row.isClosed, isOverride: true };
}

export async function setCapacityForDate(
  tenantId: string,
  date: string,
  capacity: number,
  isClosed: boolean
): Promise<void> {
  const db = getDb();
  await db
    .insert(capacityOverrides)
    .values({ tenantId, date, capacity, isClosed })
    .onConflictDoUpdate({
      target: [capacityOverrides.tenantId, capacityOverrides.date],
      set: { capacity, isClosed },
    });
}
