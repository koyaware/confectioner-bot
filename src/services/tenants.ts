import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { encrypt, generateClaimCode, hash } from '../lib/crypto.js';
import { nanoid } from 'nanoid';
import { eq, isNull, gt, and } from 'drizzle-orm';
import { Result } from '../types.js';

export async function claimTenant(
  claimCode: string,
  telegramId: number,
  now: Date
): Promise<
  Result<{ tenantId: string; shopName: string }, 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_CLAIMED'>
> {
  const db = getDb();
  const codeHash = hash(`claim_${claimCode}`);

  const candidates = await db
    .select()
    .from(tenants)
    .where(eq(tenants.claimCodeHash, codeHash))
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  // Atomic claim: only one concurrent caller can flip an unclaimed, unexpired code.
  const claimed = db
    .update(tenants)
    .set({
      ownerTelegramId: telegramId,
      claimCodeHash: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        eq(tenants.id, candidate.id),
        eq(tenants.claimCodeHash, codeHash),
        isNull(tenants.ownerTelegramId),
        gt(tenants.claimExpiresAt, now)
      )
    )
    .run();

  if (claimed.changes > 0) {
    return { ok: true, value: { tenantId: candidate.id, shopName: candidate.shopName } };
  }

  const rows = await db.select().from(tenants).where(eq(tenants.id, candidate.id)).limit(1);
  const tenant = rows[0];
  if (!tenant || tenant.ownerTelegramId !== null) {
    return { ok: false, error: 'ALREADY_CLAIMED' };
  }
  return { ok: false, error: 'EXPIRED' };
}

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
