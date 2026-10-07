import { loadConfig } from '../src/config.js';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { createTenant } from '../src/services/tenants.js';
import { Bot } from 'grammy';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const slug = arg('slug');
const shopName = arg('name');
const token = arg('token');

if (!slug || !shopName || !token) {
  console.error('Usage: tsx scripts/tenant-create.ts --slug <slug> --name <shop name> --token <bot token>');
  process.exit(1);
}

const config = loadConfig();

const bot = new Bot(token);
let me;
try {
  me = await bot.api.getMe();
} catch {
  console.error('Failed to fetch bot info from Telegram. Check the token.');
  process.exit(1);
}

initDatabase(config.databasePath);
migrate();

const result = await createTenant({
  slug,
  shopName,
  botToken: token,
  botId: me.id,
  botUsername: me.username ?? '',
  appSecret: config.appSecret,
  now: new Date(),
});

if (!result.ok) {
  console.error(`Failed to create tenant: ${result.error}`);
  process.exit(1);
}

console.log(`Tenant "${result.value.slug}" created.`);
console.log(`Claim link: ${result.value.claimLink}`);
console.log(`Claim code expires at: ${result.value.claimExpiresAt.toISOString()}`);

closeDatabase();
