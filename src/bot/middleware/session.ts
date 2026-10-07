import { MiddlewareFn } from 'grammy';
import { getDb } from '../../db/client.js';
import { sessions } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { BotContextWithSession } from '../context.js';
import { z } from 'zod';
import { SessionData, SessionState } from '../../types.js';

const checkoutSchema = z.object({
  checkoutId: z.string().min(1).max(64),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dueTimeText: z.string().max(200).optional(),
  fulfillment: z.enum(['pickup', 'delivery']).optional(),
  address: z.string().max(500).optional(),
  contactName: z.string().max(200).optional(),
  contactPhone: z.string().max(100).optional(),
  comment: z.string().max(1000).optional(),
  referenceFileIds: z
    .array(
      z.object({
        fileId: z.string().min(1).max(200),
        fileType: z.enum(['photo', 'document']),
      })
    )
    .max(10),
});

const ownerDraftSchema = z.object({
  kind: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64).optional(),
  extra: z.record(z.string()).optional(),
});

const sessionStateSchema = z.enum([
  'idle',
  'checkout.date',
  'checkout.time',
  'checkout.fulfillment',
  'checkout.address',
  'checkout.contact',
  'checkout.comment',
  'checkout.photos',
  'checkout.confirm',
  'payment.await_receipt',
  'relay.compose',
  'owner.edit_field',
  'owner.reply_to_customer',
]);

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
  checkout: checkoutSchema.optional(),
  ownerDraft: ownerDraftSchema.optional(),
  paymentOrderId: z.string().optional(),
  lastAutoReplyAt: z.number().optional(),
  antispam: z
    .object({
      windowStart: z.number(),
      count: z.number(),
    })
    .optional(),
  selections: z.record(z.array(z.string())).optional(),
});

function parseStoredSession(raw: unknown): { session: SessionData; state: SessionState } | null {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const session = sessionDataSchema.safeParse(value);
  if (!session.success) return null;
  return { session: session.data, state: 'idle' };
}

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
  if (row) {
    const stored = parseStoredSession(row.data);
    const state = sessionStateSchema.safeParse(row.state);
    if (stored && state.success) {
      ctx.session = stored.session;
      ctx.sessionState = state.data;
    } else {
      ctx.session = { cart: { lines: [] } };
      ctx.sessionState = 'idle';
    }
  } else {
    ctx.session = { cart: { lines: [] } };
    ctx.sessionState = 'idle';
  }

  await next();

  // Save session back to DB. The sessions.data column uses Drizzle json mode,
  // so pass the object itself; Drizzle serializes exactly once.
  const now = new Date();

  await db
    .insert(sessions)
    .values({
      tenantId,
      telegramId,
      state: ctx.sessionState,
      data: ctx.session,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sessions.tenantId, sessions.telegramId],
      set: {
        state: ctx.sessionState,
        data: ctx.session,
        updatedAt: now,
      },
    });
};
