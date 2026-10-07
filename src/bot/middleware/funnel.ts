import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { getDb } from '../../db/client.js';
import { funnelEvents, customers } from '../../db/schema.js';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';

const SOURCE_RE = /^[a-z0-9_-]{1,32}$/;

function extractSource(ctx: BotContextWithSession): string | null {
  const param = ctx.message?.text?.split(' ')[1];
  if (!param || param.startsWith('claim_')) return null;
  return SOURCE_RE.test(param) ? param : null;
}

/**
 * Funnel tracking middleware
 */
export const funnelMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  // Track start command (owner claim links are not funnel traffic)
  const param = ctx.message?.text?.split(' ')[1];
  if (ctx.message?.text?.startsWith('/start') && !(param && param.startsWith('claim_'))) {
    await trackFunnelEvent(ctx, 'start');
  }

  await next();
};

export async function trackFunnelEvent(
  ctx: BotContextWithSession,
  type:
    | 'start'
    | 'catalog_view'
    | 'product_view'
    | 'cart_add'
    | 'checkout_start'
    | 'order_submit'
    | 'faq_view'
    | 'free_text'
): Promise<void> {
  if (!ctx.from) return;

  const tenantId = ctx.tenant.id;
  const telegramId = ctx.from.id;
  const db = getDb();

  // Get or create customer
  let customerId: string | undefined;
  const customerResults = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.telegramId, telegramId)))
    .limit(1);

  if (customerResults.length > 0 && customerResults[0]) {
    customerId = customerResults[0].id;
  } else {
    // Create customer
    customerId = nanoid();
    const now = new Date();

    await db.insert(customers).values({
      id: customerId,
      tenantId,
      telegramId,
      username: ctx.from.username || null,
      firstName: ctx.from.first_name || null,
      phone: null,
      source: extractSource(ctx),
      isBlocked: false,
      botBlocked: false,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }

  if (!customerId) return;

  // Record funnel event
  await db.insert(funnelEvents).values({
    tenantId,
    customerId,
    type,
    source: extractSource(ctx),
    at: new Date(),
  });
}
