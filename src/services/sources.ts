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
  const raw = (code ?? suggestCode(label)).slice(0, 32);
  const base = raw.startsWith('claim_') ? `s-${raw}`.slice(0, 32) : raw;

  const taken = async (c: string): Promise<boolean> => {
    const rows = await db
      .select()
      .from(sources)
      .where(and(eq(sources.tenantId, tenantId), eq(sources.code, c)))
      .limit(1);
    return rows.length > 0;
  };

  if (!(await taken(base))) {
    await db.insert(sources).values({ tenantId, code: base, label, createdAt: new Date() });
    return { ok: true as const, code: base };
  }

  for (let i = 0; i < 5; i++) {
    const suffix = Math.random().toString(36).slice(2, 5);
    const candidate = `${base.slice(0, 32 - suffix.length - 1)}-${suffix}`;
    if (!(await taken(candidate))) {
      await db.insert(sources).values({ tenantId, code: candidate, label, createdAt: new Date() });
      return { ok: true as const, code: candidate };
    }
  }
  return { ok: false as const, error: 'CODE_TOO_LONG' as const };
}

export async function deleteSource(tenantId: string, code: string) {
  const db = getDb();
  await db.delete(sources).where(and(eq(sources.tenantId, tenantId), eq(sources.code, code)));
}
