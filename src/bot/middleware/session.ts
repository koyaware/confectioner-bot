import { MiddlewareFn } from 'grammy';
import { getDb } from '../../db/client.js';
import { sessions } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { BotContextWithSession } from '../context.js';
import { z } from 'zod';
import { SessionState } from '../../types.js';

const sessionDataSchema = z.object({
  cart: z.object({
    lines: z.array(
      z.object({
        lineId: z.string(),
        productId: z.string(),
        qty: z.number(),
        optionIds: z.array(z.string()),
      })
    ),
  }),
  checkout: z.any().optional(),
  ownerDraft: z.any().optional(),
  paymentOrderId: z.string().optional(),
  lastAutoReplyAt: z.number().optional(),
  antispam: z
    .object({
      windowStart: z.number(),
      count: z.number(),
    })
    .optional(),
});

/**
 * Session middleware - loads and saves session from DB
 */
export const sessionMiddleware: MiddlewareFn<BotContextWithSession> = async (ctx, next) => {
  if (!ctx.from) {
    return next();
  }

  const tenantId = ctx.tenant.id;
  const telegramId = ctx.from.id;
  const db = getDb();

  // Load session from DB
  const results = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.telegramId, telegramId)))
    .limit(1);

  const row = results[0];
  if (row && typeof row.data === 'string') {
    try {
      ctx.session = sessionDataSchema.parse(JSON.parse(row.data));
      ctx.sessionState = row.state as SessionState;
    } catch {
      ctx.session = { cart: { lines: [] } };
      ctx.sessionState = 'idle';
    }
  } else {
    ctx.session = { cart: { lines: [] } };
    ctx.sessionState = 'idle';
  }

  await next();

  // Save session back to DB
  const sessionData = JSON.stringify(ctx.session);
  const now = new Date();

  await db
    .insert(sessions)
    .values({
      tenantId,
      telegramId,
      state: ctx.sessionState,
      data: sessionData,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sessions.tenantId, sessions.telegramId],
      set: {
        state: ctx.sessionState,
        data: sessionData,
        updatedAt: now,
      },
    });
};
