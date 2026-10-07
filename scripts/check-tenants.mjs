import { initDatabase, getDb } from '../src/db/client.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

initDatabase('./data.db');
const db = getDb();
const ts = await db.select().from(tenants);
console.log('Tenants:', ts.map(t => ({ slug: t.slug, shopName: t.shopName, botUsername: t.botUsername, botId: t.botId, ownerTelegramId: t.ownerTelegramId })));
