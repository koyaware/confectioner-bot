import { initDatabase, getSqliteDb } from '../src/db/client.js';
import { nanoid } from 'nanoid';

initDatabase('./data.db');
const sqliteDb = getSqliteDb();
const tenantId = 'oEviWk1P3yE4c_zbgRCwg';

console.log('Testing basic query...');
const cats = sqliteDb.prepare('SELECT COUNT(*) as c FROM categories WHERE tenant_id = ?').get(tenantId);
console.log('Categories:', cats.c);

console.log('Testing insert...');
try {
  sqliteDb.prepare('INSERT INTO categories (id, tenant_id, title, sort_order, is_active) VALUES (?, ?, ?, ?, ?)').run('test-id', tenantId, 'Test Category', 99, 1);
  console.log('Insert worked!');
  const verify = sqliteDb.prepare('SELECT * FROM categories WHERE id = ?').get('test-id');
  console.log('Verify:', verify);
} catch (e) {
  console.error('Insert failed:', e.message);
}
