import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createTenantBot } from '../src/bot/factory.js';
import { FakePort } from '../src/telegram/fake-port.js';
import { orders, sessions, tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { addDays, toIsoDate } from '../src/domain/dates.js';

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
  await getDb()
    .update(tenants)
    .set({ defaultDailyCapacity: 1000 })
    .where(eq(tenants.id, tenantId));

  const port = new FakePort();
  const { bot } = createTenantBot('123:x', tenantId, 'demo', port);

  const durations: number[] = [];
  let expectedOrders = 0;

  for (let customer = 1; customer <= 300; customer++) {
    const userId = 100000 + customer;
    const stepDurations: number[] = [];

    const timeSteps = async () => {
      let start = performance.now();
      await bot.handleUpdate(cb(1, `c-${customer}-1`, userId, 10, 'cat:list'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      const edits = port.getCallsForMethod('editMessageText');
      const lastEdit = edits[edits.length - 1]!;
      const catMatch = JSON.stringify(lastEdit.args[3]).match(/cat:open:[A-Za-z0-9_-]+/);
      if (!catMatch) throw new Error('category button not found');
      await bot.handleUpdate(cb(2, `c-${customer}-2`, userId, 10, catMatch[0]));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      const edits2 = port.getCallsForMethod('editMessageText');
      const lastEdit2 = edits2[edits2.length - 1]!;
      const prdMatch = JSON.stringify(lastEdit2.args[3]).match(/prd:open:[A-Za-z0-9_-]+/);
      if (!prdMatch) throw new Error('product button not found');
      await bot.handleUpdate(cb(3, `c-${customer}-3`, userId, 10, prdMatch[0]));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      const edits3 = port.getCallsForMethod('editMessageText');
      const lastEdit3 = edits3[edits3.length - 1]!;
      const addMatch = JSON.stringify(lastEdit3.args[3]).match(/prd:add:[A-Za-z0-9_-]+/);
      if (!addMatch) throw new Error('add button not found');
      await bot.handleUpdate(cb(4, `c-${customer}-4`, userId, 10, addMatch[0]));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(cb(5, `c-${customer}-5`, userId, 10, 'cart:show'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(cb(6, `c-${customer}-6`, userId, 10, 'chk:start'));
      stepDurations.push(performance.now() - start);

      const freeDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5 + (customer % 30));
      start = performance.now();
      await bot.handleUpdate(cb(7, `c-${customer}-7`, userId, 10, `chk:date:${freeDate}`));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(msg(20 + customer * 10, userId, 'к 15:00'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(cb(8, `c-${customer}-8`, userId, 10, 'chk:ful:pickup'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(msg(21 + customer * 10, userId, 'Иван, +79991234567'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(msg(22 + customer * 10, userId, 'Без комментария'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      await bot.handleUpdate(cb(9, `c-${customer}-9`, userId, 10, 'chk:skip'));
      stepDurations.push(performance.now() - start);

      start = performance.now();
      const sent = port.getCallsForMethod('sendMessage');
      const confirm = sent[sent.length - 1]!;
      const submitMatch = JSON.stringify(confirm.args[2]).match(/chk:submit:[A-Za-z0-9_-]+/);
      if (!submitMatch) throw new Error('submit button not found');
      await bot.handleUpdate(cb(10, `c-${customer}-10`, userId, 10, submitMatch[0]));
      stepDurations.push(performance.now() - start);

      expectedOrders++;
    };

    await timeSteps();
    for (const d of stepDurations) durations.push(d);
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

  console.log(
    JSON.stringify(
      {
        customers: 300,
        orders: allOrders.length,
        expectedOrders,
        uniqueOrderIds: uniqueIds.size,
        uniqueIdempotencyKeys: uniqueIdem.size,
        byDueDate: byDue,
        sessions: allSessions.length,
        p95Ms: Math.round(p95),
        passedCapacityCheck: Object.values(byDue).every((v) => v <= 1000),
        passed,
      },
      null,
      2
    )
  );

  closeDatabase();
  process.exit(passed && p95 < 200 ? 0 : 1);
}

function cb(update_id: number, id: string, from: number, msgId: number, data: string) {
  return {
    update_id,
    callback_query: {
      id,
      from: { id: from, is_bot: false, first_name: 'C' },
      message: { message_id: msgId, date: 1, chat: { id: from, type: 'private' } },
      data,
    },
  } as never;
}

function msg(update_id: number, from: number, text: string) {
  return {
    update_id,
    message: {
      message_id: update_id,
      date: 1,
      chat: { id: from, type: 'private' },
      from: { id: from, is_bot: false, first_name: 'C' },
      text,
      entities: [],
    },
  } as never;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
