import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { initDatabase, closeDatabase } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { createTenant } from '../src/services/tenants.js';
import { Bot } from 'grammy';

import { z } from 'zod';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const argsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]{1,32}$/, 'slug must be 1-32 chars: a-z, 0-9, _ or -'),
  shopName: z.string().min(1).max(200),
  token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'token must look like 123456:ABC...'),
});

const parsed = argsSchema.safeParse({
  slug: arg('slug'),
  shopName: arg('name'),
  token: arg('token'),
});
if (!parsed.success) {
  console.error(
    'Usage: tsx scripts/tenant-create.ts --slug <slug> --name <shop name> --token <bot token>'
  );
  console.error(parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const { slug, shopName, token } = parsed.data;

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
