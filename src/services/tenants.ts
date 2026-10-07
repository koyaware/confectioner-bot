import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { encrypt, generateClaimCode, hash } from '../lib/crypto.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { Result } from '../types.js';

const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateTenantInput {
  slug: string;
  shopName: string;
  botToken: string;
  botId: number;
  botUsername: string;
  appSecret: string;
  now: Date;
}

export interface CreatedTenant {
  id: string;
  slug: string;
  botUsername: string;
  claimCode: string;
  claimLink: string;
  claimExpiresAt: Date;
}

export async function createTenant(
  input: CreateTenantInput
): Promise<Result<CreatedTenant, 'SLUG_TAKEN' | 'BOT_ID_TAKEN'>> {
  const db = getDb();

  const existingSlug = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, input.slug))
    .limit(1);
  if (existingSlug.length > 0) {
    return { ok: false, error: 'SLUG_TAKEN' };
  }

  const existingBot = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.botId, input.botId))
    .limit(1);
  if (existingBot.length > 0) {
    return { ok: false, error: 'BOT_ID_TAKEN' };
  }

  const claimCode = generateClaimCode();
  const claimExpiresAt = new Date(input.now.getTime() + CLAIM_TTL_MS);
  const id = nanoid();

  await db.insert(tenants).values({
    id,
    slug: input.slug,
    botTokenEnc: encrypt(input.botToken, input.appSecret),
    botId: input.botId,
    botUsername: input.botUsername,
    ownerTelegramId: null,
    claimCodeHash: hash(`claim_${claimCode}`),
    claimExpiresAt,
    shopName: input.shopName,
    createdAt: input.now,
  });

  return {
    ok: true,
    value: {
      id,
      slug: input.slug,
      botUsername: input.botUsername,
      claimCode,
      claimLink: `https://t.me/${input.botUsername}?start=claim_${claimCode}`,
      claimExpiresAt,
    },
  };
}
