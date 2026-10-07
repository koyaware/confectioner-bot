import { loadConfig } from '../src/config.js';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { deleteTenantBySlug } from '../src/services/tenant-delete.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const slug = arg('slug');
const force = process.argv.includes('--force');

if (!slug) {
  console.error('Usage: tsx scripts/tenant-delete.ts --slug <slug> [--force]');
  process.exit(1);
}

const config = loadConfig();
initDatabase(config.databasePath);
migrate();

const result = await deleteTenantBySlug(slug, { force });
if (!result.deleted) {
  console.error(`Cannot delete tenant: ${result.reason}`);
  closeDatabase();
  process.exit(1);
}

console.log(`Tenant ${slug} deleted.`);
closeDatabase();
