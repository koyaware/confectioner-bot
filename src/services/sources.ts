import { getDb } from '../db/client.js';
import { sources } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

export async function listSources(tenantId: string) {
  const db = getDb();
  return db.select().from(sources).where(eq(sources.tenantId, tenantId));
}

export function suggestCode(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base || `src_${Math.random().toString(36).slice(2, 8)}`;
}

export async function addSource(tenantId: string, label: string, code?: string) {
  const db = getDb();
  const c0 = (code ?? suggestCode(label)).slice(0, 32);
  const c = c0.startsWith('claim_') ? `s-${c0}` : c0;
  const exists = await db
    .select()
    .from(sources)
    .where(and(eq(sources.tenantId, tenantId), eq(sources.code, c)))
    .limit(1);
  const finalCode = exists.length > 0 ? `${c}-${Math.random().toString(36).slice(2, 5)}` : c;
  if (finalCode.length > 32) {
    return { ok: false as const, error: 'CODE_TOO_LONG' as const };
  }
  await db.insert(sources).values({ tenantId, code: finalCode, label, createdAt: new Date() });
  return { ok: true as const, code: finalCode };
}

export async function deleteSource(tenantId: string, code: string) {
  const db = getDb();
  await db.delete(sources).where(and(eq(sources.tenantId, tenantId), eq(sources.code, code)));
}
