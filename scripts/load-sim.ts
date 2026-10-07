import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { orders, sessions, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';

let updateSeq = 100000;

function cb(id: string, from: number, msgId: number, data: string) {
  return {
    update_id: updateSeq++,
    callback_query: {
      id,
      from: { id: from, is_bot: false, first_name: 'C' },
      message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
      data,
    },
  } as never;
}

function msg(from: number, text: string) {
  const id = updateSeq++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 1,
      chat: { id: from, type: 'private' },
      from: { id: from, is_bot: false, first_name: 'C' },
      text,
      entities: [],
    },
  } as never;
}

async function main() {
  const testDbPath = './load-sim.db';
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
  }

  process.env.APP_SECRET = process.env.APP_SECRET || 's'.repeat(32);
  process.env.SUPERADMIN_TELEGRAM_ID = process.env.SUPERADMIN_TELEGRAM_ID || '1';

  initDatabase(testDbPath);
  migrate();

  const now = new Date();
  const { tenantId } = await seedDemo(process.env.APP_SECRET, now);
  await getDb().update(tenants).set({ defaultDailyCapacity: 1000 }).where(eq(tenants.id, tenantId));

  const port = new FakePort();
  const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

  const durations: number[] = [];
  let expectedOrders = 0;
  let customerSeq = 0;

  function lastEditFor(userId: number, method: string): { args: unknown[] } {
    const calls = port.getCallsForMethod(method).filter((c) => (c.args[0] as number) === userId);
    const last = calls[calls.length - 1];
    if (!last) throw new Error(`no ${method} for user ${userId}`);
    return last;
  }

  async function runCustomerFlow(): Promise<void> {
    const n = ++customerSeq;
    const userId = 200000 + n;
    const tag = `u${n}`;

    const timed = async <T>(fn: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        durations.push(performance.now() - start);
      }
    };

    await timed(() => bot.handleUpdate(cb(`${tag}-1`, userId, 10, 'cat:list')));
    const catMatch = JSON.stringify(lastEditFor(userId, 'editMessageText').args[3]).match(
      /cat:open:[A-Za-z0-9_-]+/
    );
    if (!catMatch) throw new Error('category button not found');
    await timed(() => bot.handleUpdate(cb(`${tag}-2`, userId, 10, catMatch[0])));

    const prdMatch = JSON.stringify(lastEditFor(userId, 'editMessageText').args[3]).match(
      /prd:open:[A-Za-z0-9_-]+/
    );
    if (!prdMatch) throw new Error('product button not found');
    await timed(() => bot.handleUpdate(cb(`${tag}-3`, userId, 10, prdMatch[0])));

    const addMatch = JSON.stringify(lastEditFor(userId, 'editMessageText').args[3]).match(
      /prd:add:[A-Za-z0-9_-]+/
    );
    if (!addMatch) throw new Error('add button not found');
    await timed(() => bot.handleUpdate(cb(`${tag}-4`, userId, 10, addMatch[0])));

    await timed(() => bot.handleUpdate(cb(`${tag}-5`, userId, 10, 'cart:show')));
    await timed(() => bot.handleUpdate(cb(`${tag}-6`, userId, 10, 'chk:start')));

    const freeDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5 + (n % 30));
    await timed(() => bot.handleUpdate(cb(`${tag}-7`, userId, 10, `chk:date:${freeDate}`)));

    await timed(() => bot.handleUpdate(msg(userId, 'к 15:00')));
    await timed(() => bot.handleUpdate(cb(`${tag}-8`, userId, 10, 'chk:ful:pickup')));
    await timed(() => bot.handleUpdate(msg(userId, 'Иван, +79991234567')));
    await timed(() => bot.handleUpdate(msg(userId, 'Без комментария')));
    await timed(() => bot.handleUpdate(cb(`${tag}-9`, userId, 10, 'chk:skip')));

    const confirm = lastEditFor(userId, 'editMessageText');
    const submitMatch = JSON.stringify(confirm.args[3]).match(/chk:submit:[A-Za-z0-9_-]+/);
    if (!submitMatch) throw new Error('submit button not found');
    await timed(() => bot.handleUpdate(cb(`${tag}-10`, userId, 10, submitMatch[0])));

    expectedOrders++;
  }

  // Waves of truly concurrent customers: 10, then 50, then 100.
  for (const waveSize of [10, 50, 100]) {
    const waveStart = performance.now();
    await Promise.all(Array.from({ length: waveSize }, () => runCustomerFlow()));
    const waveMs = Math.round(performance.now() - waveStart);
    console.log(`wave ${waveSize}: ${waveMs}ms`);
  }

  const allOrders = await getDb().select().from(orders);
  const uniqueIds = new Set(allOrders.map((o) => o.id));
  const uniqueIdem = new Set(allOrders.map((o) => o.idempotencyKey));

  const byDue: Record<string, number> = {};
  for (const o of allOrders) {
    byDue[o.dueDate] = (byDue[o.dueDate] || 0) + 1;
  }
  const allSessions = await getDb().select().from(sessions);

  const passed =
    allOrders.length === expectedOrders &&
    uniqueIds.size === allOrders.length &&
    uniqueIdem.size === allOrders.length;

  const durationsSorted = [...durations].sort((a, b) => a - b);
  const p95 = durationsSorted[Math.floor(durationsSorted.length * 0.95)] ?? 0;

  // Last-slot race: 10 concurrent creations on a capacity-1 date, exactly one wins.
  const { createOrder } = await import('../src/services/orders.js');
  const { setCapacityForDate } = await import('../src/services/calendar.js');
  const { customers } = await import('../src/db/schema.js');
  const { products } = await import('../src/db/schema.js');
  const raceDate = addDays(toIsoDate(now, 'Europe/Moscow'), 45);
  await setCapacityForDate(tenantId, raceDate, 1, false);
  const db = getDb();
  await db.insert(customers).values({
    id: 'race-cust',
    tenantId,
    telegramId: 999999,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  const raceProducts = await db.select().from(products);
  const raceProduct = raceProducts.find((p) => p.capacityUnits === 1)!;
  const { productOptions } = await import('../src/db/schema.js');
  const raceOpts = await db
    .select()
    .from(productOptions)
    .where(eq(productOptions.productId, raceProduct.id));
  const seenGroups = new Set<string>();
  const raceOptionIds: string[] = [];
  for (const o of raceOpts) {
    if (o.isActive && !seenGroups.has(o.groupTitle)) {
      seenGroups.add(o.groupTitle);
      raceOptionIds.push(o.id);
    }
  }
  const raceResults = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      createOrder({
        tenantId,
        customerId: 'race-cust',
        cart: {
          lines: [{ lineId: `r${i}`, productId: raceProduct.id, qty: 1, optionIds: raceOptionIds }],
        },
        checkout: {
          checkoutId: `race-${i}`,
          dueDate: raceDate,
          fulfillment: 'pickup',
          contactName: 'Race',
          contactPhone: '+7000',
          referenceFileIds: [],
        },
        now,
      })
    )
  );
  const raceWins = raceResults.filter((r) => r.ok).length;

  console.log(
    JSON.stringify(
      {
        customers: expectedOrders,
        orders: allOrders.length,
        expectedOrders,
        uniqueOrderIds: uniqueIds.size,
        uniqueIdempotencyKeys: uniqueIdem.size,
        byDueDate: byDue,
        sessions: allSessions.length,
        p95Ms: Math.round(p95),
        passedCapacityCheck: Object.values(byDue).every((v) => v <= 1000),
        raceWins,
        passed: passed && raceWins === 1,
      },
      null,
      2
    )
  );

  closeDatabase();
  process.exit(passed && raceWins === 1 && p95 < 200 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
