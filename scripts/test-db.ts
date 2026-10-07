import { initDatabase, getSqliteDb } from '../src/db/client.js';
import { nanoid } from 'nanoid';

initDatabase('./data.db');
const sqliteDb = getSqliteDb();
const tenantId = 'oEviWk1P3yE4c_zbgRCwg';

const cats = sqliteDb.prepare('SELECT COUNT(*) as c FROM categories WHERE tenant_id = ?').get('oEviWk1P3yE4c_zbgRCwg');
console.log('Current categories:', cats.c);
