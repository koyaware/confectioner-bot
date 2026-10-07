import { initDatabase, getDb } from '../src/db/client.js';
import { tenants } from '../src/db/schema.js';

async function main() {
  initDatabase('./data.db');
  const db = getDb();
  const ts = await db.select().from(tenants);
  console.log('Tenants:', JSON.stringify(ts.map(t => ({ 
    slug: t.slug, 
    shopName: t.shopName, 
    botUsername: t.botUsername, 
    botId: t.botId, 
    ownerTelegramId: t.ownerTelegramId 
  })), null, 2));
}

main().catch(console.error);