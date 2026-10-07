import { initDatabase, getSqliteDb } from '../src/db/client.js';

initDatabase('./data.db');
const sqliteDb = getSqliteDb();

console.log('Testing categories...');
const c1 = sqliteDb.prepare('SELECT COUNT(*) as c FROM categories WHERE tenant_id = ?').get('oEviWk1P3yE4c_zbgRCwg');
console.log('Categories:', c1.c);

const p1 = sqliteDb.prepare('SELECT COUNT(*) as c FROM products WHERE tenant_id = ?').get('oEviWk1P3yE4c_zbgRCwg');
console.log('Products:', p1.c);

const o1 = sqliteDb.prepare('SELECT COUNT(*) as c FROM product_options WHERE tenant_id = ?').get('oEviWk1P3yE4c_zbgRCwg');
console.log('Options:', o1.c);

const f1 = sqliteDb.prepare('SELECT COUNT(*) as c FROM faq_items WHERE tenant_id = ?').get('oEviWk1P3yE4c_zbgRCwg');
console.log('FAQs:', f1.c);
