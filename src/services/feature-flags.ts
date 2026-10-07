import { getDb } from '../db/client.js';
import { featureFlags } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { Result } from '../types.js';

export interface FeatureFlag {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getFeatureFlag(
  tenantId: string,
  name: string
): Promise<Result<{ enabled: boolean }, 'NOT_FOUND'>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.name, name)))
    .limit(1);
  const flag = rows[0];
  if (!flag) {
    return { ok: false, error: 'NOT_FOUND' as const };
  }
  return { ok: true, value: { enabled: flag.enabled } };
}

/**
 * Feature check with a default for tenants that never set the flag.
 * New flags roll out as `defaultValue` without touching every tenant row.
 */
export async function isFeatureEnabled(
  tenantId: string,
  name: string,
  defaultValue: boolean
): Promise<boolean> {
  const result = await getFeatureFlag(tenantId, name);
  if (!result.ok) return defaultValue;
  return result.value.enabled;
}

export async function listFeatureFlags(tenantId: string) {
  const db = getDb();
  return db.select().from(featureFlags).where(eq(featureFlags.tenantId, tenantId));
}

export async function setFeatureFlag(
  tenantId: string,
  name: string,
  enabled: boolean,
  description?: string
): Promise<Result<{ name: string; enabled: boolean }, 'NOT_FOUND'>> {
  const db = getDb();
  const existing = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.name, name)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(featureFlags)
      .set({ enabled, description: description ?? null, updatedAt: new Date() })
      .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.name, name)));
  } else {
    await db.insert(featureFlags).values({
      id: nanoid(),
      tenantId,
      name,
      enabled,
      description: description ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return { ok: true, value: { name, enabled } };
}

export async function deleteFeatureFlag(
  tenantId: string,
  name: string
): Promise<Result<void, 'NOT_FOUND'>> {
  const db = getDb();
  const result = await db
    .delete(featureFlags)
    .where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.name, name)));
  if (result.changes === 0) {
    return { ok: false, error: 'NOT_FOUND' as const };
  }
  return { ok: true, value: undefined };
}
