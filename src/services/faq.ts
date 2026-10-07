import { getDb } from '../db/client.js';
import { faqItems } from '../db/schema.js';
import { and, eq, asc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export async function listFaq(tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(faqItems)
    .where(eq(faqItems.tenantId, tenantId))
    .orderBy(asc(faqItems.sortOrder));
}

export async function getFaq(tenantId: string, faqId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(faqItems)
    .where(and(eq(faqItems.id, faqId), eq(faqItems.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createFaq(tenantId: string, question: string, answer: string) {
  const db = getDb();
  const rows = await db
    .select({ max: sql<number | null>`max(${faqItems.sortOrder})` })
    .from(faqItems)
    .where(eq(faqItems.tenantId, tenantId));
  const sortOrder = (rows[0]?.max ?? -1) + 1;
  const id = nanoid();
  await db.insert(faqItems).values({ id, tenantId, question, answer, sortOrder });
  return { id };
}

export async function updateFaq(
  tenantId: string,
  faqId: string,
  patch: { question?: string; answer?: string }
) {
  const db = getDb();
  await db
    .update(faqItems)
    .set(patch)
    .where(and(eq(faqItems.id, faqId), eq(faqItems.tenantId, tenantId)));
}

export async function deleteFaq(tenantId: string, faqId: string) {
  const db = getDb();
  await db.delete(faqItems).where(and(eq(faqItems.id, faqId), eq(faqItems.tenantId, tenantId)));
}
