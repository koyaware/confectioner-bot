import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { getDb } from '../../db/client.js';
import { funnelEvents, customers } from '../../db/schema.js';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';

/**
 * Funnel tracking middleware
 */
export const funnelMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  // Track start command
  if (ctx.message?.text?.startsWith('/start')) {
    await trackFunnelEvent(ctx, 'start');
  }

  await next();
};

async function trackFunnelEvent(
  ctx: BotContextWithSession,
  type: 'start' | 'catalog_view' | 'product_view' | 'cart_add' | 'checkout_start' | 'order_submit' | 'faq_view' | 'free_text'
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

    // Extract source from start parameter
    const startParam = ctx.message?.text?.split(' ')[1];
    const source = startParam && !startParam.startsWith('claim_') ? startParam : null;

    await db.insert(customers).values({
      id: customerId,
      tenantId,
      telegramId,
      username: ctx.from.username || null,
      firstName: ctx.from.first_name || null,
      phone: null,
      source,
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
    source: ctx.message?.text?.split(' ')[1] || null,
    at: new Date(),
  });
}
