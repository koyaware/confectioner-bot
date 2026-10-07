import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { customers, funnelEvents, categories, sessions } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('catalog flow', () => {
  const testDbPath = './test-flow.db';
  const appSecret = 's'.repeat(32);

  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    process.env.APP_SECRET = appSecret;
    process.env.SUPERADMIN_TELEGRAM_ID = '1';
    initDatabase(testDbPath);
    migrate();
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    delete process.env.APP_SECRET;
    delete process.env.SUPERADMIN_TELEGRAM_ID;
  });

  function messageUpdate(text: string, tgId = 42) {
    return {
      update_id: 1,
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgId, type: 'private' as const },
        from: { id: tgId, is_bot: false, first_name: 'Test' },
        text,
        entities: text.startsWith('/')
          ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }]
          : [],
      },
    };
  }

  function callbackUpdate(data: string, tgId = 42) {
    return {
      update_id: 2,
      callback_query: {
        id: 'cbq1',
        from: { id: tgId, is_bot: false, first_name: 'Test' },
        message: {
          message_id: 11,
          date: Math.floor(Date.now() / 1000),
          chat: { id: tgId, type: 'private' as const },
        },
        data,
      },
    };
  }

  it('walks from /start to product card', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:fake', tenantId, 'demo', port);

    await bot.handleUpdate(messageUpdate('/start'));

    const sendCalls = port.getCallsForMethod('sendMessage');
    expect(sendCalls).toHaveLength(1);
    const greetingText = sendCalls[0]!.args[1] as string;
    expect(greetingText).toContain('SweetDreams');

    await bot.handleUpdate(callbackUpdate('cat:list'));
    let answers = port.getCallsForMethod('answerCallback');
    expect(answers).toHaveLength(1);
    const edits = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits).toHaveLength(1);
    const buttons = JSON.stringify(edits[0]!.args[3]);
    expect(buttons).toContain('🎂 Cakes');
    expect(buttons).toContain('cat:open:');

    const db = getDb();
    const cats = await db.select().from(categories).where(eq(categories.tenantId, tenantId));
    const firstCat = cats[0]!;

    await bot.handleUpdate(callbackUpdate(`cat:open:${firstCat.id}`));
    const edits2 = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits2).toHaveLength(2);
    expect(JSON.stringify(edits2[1]!.args[3])).toContain('prd:open:');

    const productsCall = edits2[1]!;
    const keyboardJson = JSON.stringify(productsCall.args[3]);
    const match = keyboardJson.match(/prd:open:([A-Za-z0-9_-]+)/);
    expect(match).toBeTruthy();
    const productId = match![1];

    await bot.handleUpdate(callbackUpdate(`prd:open:${productId}`));
    answers = port.getCallsForMethod('answerCallback');
    expect(answers).toHaveLength(3);
    const edits3 = port.getCallsForMethod('editMessageTextOrSend');
    expect(edits3).toHaveLength(3);
    const cardText = edits3[2]!.args[2] as string;
    expect(cardText).toContain('Цена:');
    expect(JSON.stringify(edits3[2]!.args[3])).toContain(`cat:open:${firstCat.id}`);

    const cust = await db.select().from(customers);
    expect(cust).toHaveLength(1);

    const events = await db.select().from(funnelEvents);
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(['catalog_view', 'product_view', 'start']);
  });

  it('records source from start parameter', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:fake', tenantId, 'demo', port);

    await bot.handleUpdate(messageUpdate('/start insta_reel1'));

    const db = getDb();
    const cust = await db.select().from(customers);
    expect(cust[0]!.source).toBe('insta_reel1');
  });

  it('/start resets session state to idle', async () => {
    const { tenantId } = await seedDemo(appSecret, new Date());
    const port = new FakePort();
    const { bot } = createTenantBot('123:fake', tenantId, 'demo', port);

    // simulate an in-progress checkout state in DB
    await getDb()
      .insert(sessions)
      .values({
        tenantId,
        telegramId: 42,
        state: 'checkout.date',
        data: JSON.stringify({ cart: { lines: [] } }),
        updatedAt: new Date(),
      });

    await bot.handleUpdate(messageUpdate('/start'));

    const db = getDb();
    const row = await db.select().from(sessions);
    expect(row[0]!.state).toBe('idle');
  });
});
