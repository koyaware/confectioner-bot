import { getSqliteDb, backupDatabase } from '../db/client.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import Database from 'better-sqlite3';

export interface DeleteTenantOptions {
  force?: boolean;
}

export interface DeleteTenantResult {
  deleted: boolean;
  slug: string;
  reason?: string;
}

export async function deleteTenantBySlug(
  slug: string,
  options: DeleteTenantOptions = {}
): Promise<DeleteTenantResult> {
  const db = getSqliteDb();

  const tenant = db
    .prepare('SELECT id, slug, status, shop_name as shopName FROM tenants WHERE slug = ?')
    .get(slug) as { id: string; slug: string; status: string; shopName: string } | undefined;

  if (!tenant) {
    return { deleted: false, slug, reason: 'TENANT_NOT_FOUND' };
  }

  if (tenant.status === 'active' && !options.force) {
    return { deleted: false, slug, reason: 'ACTIVE_TENANT_REQUIRES_FORCE' };
  }

  const dir = join(process.cwd(), 'backups');
  await mkdir(dir, { recursive: true });
  const backupPath = join(dir, `pre-delete-${tenant.slug}-${Date.now()}.db`);
  await backupDatabase(backupPath);

  const integrityDb = new Database(backupPath, { readonly: true });
  try {
    const row = integrityDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (row.integrity_check !== 'ok') {
      throw new Error(`Backup integrity check failed for ${backupPath}`);
    }
  } finally {
    integrityDb.close();
  }

  const run = db.transaction(() => {
    db.prepare(
      'DELETE FROM order_attachments WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = ?)'
    ).run(tenant.id);
    db.prepare(
      'DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = ?)'
    ).run(tenant.id);
    db.prepare(
      'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = ?)'
    ).run(tenant.id);
    db.prepare('DELETE FROM orders WHERE tenant_id = ?').run(tenant.id);

    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM relay_messages WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM sources WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM capacity_overrides WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM funnel_events WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM sessions WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM jobs WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM faq_items WHERE tenant_id = ?').run(tenant.id);

    db.prepare(
      'DELETE FROM product_options WHERE product_id IN (SELECT id FROM products WHERE tenant_id = ?)'
    ).run(tenant.id);
    db.prepare('DELETE FROM products WHERE tenant_id = ?').run(tenant.id);
    db.prepare('DELETE FROM categories WHERE tenant_id = ?').run(tenant.id);

    db.prepare('DELETE FROM tenants WHERE id = ?').run(tenant.id);
  });

  run();

  // Sanity: the tenant row must be gone.
  const check = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
  if (check) {
    throw new Error(`Tenant ${slug} was not deleted`);
  }

  return { deleted: true, slug };
}
