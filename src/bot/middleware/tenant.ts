import { MiddlewareFn } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { getDb } from '../../db/client.js';
import { tenants } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Tenant middleware - loads tenant info from DB
 */
export const tenantMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  const tenantId = ctx.tenant.id;
  const db = getDb();

  const results = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (results.length === 0) {
    console.error(`Tenant ${tenantId} not found in database`);
    return;
  }

  const tenant = results[0];
  if (!tenant) {
    console.error(`Tenant ${tenantId} is null in database`);
    return;
  }

  // Update context with tenant data
  ctx.tenant = {
    id: tenant.id,
    slug: tenant.slug,
    botUsername: tenant.botUsername,
    ownerTelegramId: tenant.ownerTelegramId,
    shopName: tenant.shopName,
    currency: tenant.currency,
    timezone: tenant.timezone,
    status: tenant.status,
    acceptOrders: tenant.acceptOrders,
    greetingText: tenant.greetingText,
    aboutText: tenant.aboutText,
    contactsText: tenant.contactsText,
    deliveryText: tenant.deliveryText,
    paymentText: tenant.paymentText,
    busyText: tenant.busyText,
    replySlaText: tenant.replySlaText,
    prepaymentPercent: tenant.prepaymentPercent,
    minLeadDays: tenant.minLeadDays,
    maxAdvanceDays: tenant.maxAdvanceDays,
    defaultDailyCapacity: tenant.defaultDailyCapacity,
    paymentDeadlineHours: tenant.paymentDeadlineHours,
    deliveryFeeMinor: tenant.deliveryFeeMinor,
    digestHour: tenant.digestHour,
  };

  await next();
};
