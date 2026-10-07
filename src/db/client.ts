import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

let db: BetterSQLite3Database<typeof schema> | null = null;
let sqliteDb: Database.Database | null = null;

export function initDatabase(path: string): BetterSQLite3Database<typeof schema> {
  if (db) {
    throw new Error('Database already initialized');
  }

  // Open SQLite in WAL mode for better concurrency
  sqliteDb = new Database(path);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('busy_timeout = 5000');

  db = drizzle(sqliteDb, { schema });

  return db;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function getSqliteDb(): Database.Database {
  if (!sqliteDb) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return sqliteDb;
}

export function closeDatabase(): void {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    db = null;
  }
}

/**
 * Creates a backup of the database
 * Returns the backup as a Buffer
 */
export async function backupDatabase(destinationPath: string): Promise<void> {
  const source = getSqliteDb();
  await source.backup(destinationPath);
}
