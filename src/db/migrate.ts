import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSqliteDb } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Applies all pending migrations
 */
export function migrate(): void {
  const db = getSqliteDb();

  // Create migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const migrationsDir = join(__dirname, 'migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedMigrations = db.prepare('SELECT name FROM __migrations').all() as { name: string }[];
  const appliedNames = new Set(appliedMigrations.map((m) => m.name));

  for (const file of migrationFiles) {
    if (appliedNames.has(file)) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // Execute migration in a transaction
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
    })();

    console.log(`Applied migration: ${file}`);
  }
}
