import { initDatabase, getSqliteDb } from '../src/db/client.js';

initDatabase('./data.db');
const sqliteDb = getSqliteDb();

console.log('Testing products with raw SQL...');
const p1 = sqliteDb.prepare("SELECT COUNT(*) as c FROM products WHERE tenant_id = ?").get('oEviWk1P3yE4c_zbgRCwg');
console.log('Products:', p1.c);

console.log('Testing with different quote style...');
const p2 = sqliteDb.prepare('SELECT COUNT(*) as c FROM products WHERE tenant_id = ?').get("oEviWk1P3yE4c_zbgRCwg");
console.log('Products (double quotes):', p2.c);

console.log('Testing with template literal...');
const tenantId = 'oEviWk1P3yE4c_zbgRCwg';
const p3 = sqliteDb.prepare(\`SELECT COUNT(*) as c FROM products WHERE tenant_id = ?\`).get(tenantId);
console.log('Products (template):', p3.c);
