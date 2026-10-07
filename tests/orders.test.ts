import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { initDatabase, closeDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { createOrder } from '../src/services/orders.js';
import { orders } from '../src/db/schema.js';
import { addDays, toIsoDate } from '../src/domain/dates.js';
import { eq } from 'drizzle-orm';
import { firstActiveOptionIds } from './helpers.js';

describe('createOrder', () => {
  const testDbPath = './test-orders.db';
  const appSecret = 's'.repeat(32);
  const now = new Date('2026-10-02T12:00:00Z');

  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(testDbPath + suffix)) unlinkSync(testDbPath + suffix);
    }
    process.env.APP_SECRET = appSecret;
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
  });

  async function setup() {
    const { tenantId } = await seedDemo(appSecret, now);
    const db = getDb();
    const products = await db.select().from((await import('../src/db/schema.js')).products);
    const { customers: customersTable } = await import('../src/db/schema.js');
    const { nanoid } = await import('nanoid');
    const customerId = nanoid();
    await db.insert(customersTable).values({
      id: customerId,
      tenantId,
      telegramId: 42,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return { tenantId, products, customerId };
  }

  function cartWith(productId: string, qty: number, optionIds: string[]) {
    return { cart: { lines: [{ lineId: 'l1', productId, qty, optionIds }] } };
  }

  it('rejects empty option selection on optioned products', async () => {
    const { tenantId, products, customerId } = await setup();
    const product = products[0]!;
    const dueDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5);

    const result = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(product.id, 1, []).cart,
      checkout: {
        checkoutId: 'chk-noopts',
        dueDate,
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });

    expect(result).toEqual({ ok: false, error: 'BAD_OPTIONS' });
  });

  it('rejects zero-price products', async () => {
    const { tenantId, products, customerId } = await setup();
    const db = getDb();
    const { products: pTable } = await import('../src/db/schema.js');
    await db
      .update(pTable)
      .set({ priceMinor: 0 })
      .where(eq(pTable.id, products[0]!.id));

    const result = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(products[0]!.id, 1, await firstActiveOptionIds(products[0]!.id)).cart,
      checkout: {
        checkoutId: 'chk-free',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });

    expect(result).toEqual({ ok: false, error: 'BAD_QTY' });
  });

  it('rejects delivery orders without address', async () => {
    const { tenantId, products, customerId } = await setup();
    const product = products[0]!;
    const dueDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5);

    const result = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(product.id, 1, await firstActiveOptionIds(product.id)).cart,
      checkout: {
        checkoutId: 'chk-noaddr',
        dueDate,
        fulfillment: 'delivery',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });

    expect(result).toEqual({ ok: false, error: 'BAD_ADDRESS' });
  });

  it('creates order with computed totals and snapshot fields', async () => {
    const { tenantId, products, customerId } = await setup();
    const product = products[0]!;
    const dueDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5);

    const result = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(product.id, 2, await firstActiveOptionIds(product.id)).cart,
      checkout: {
        checkoutId: 'chk-1',
        dueDate,
        fulfillment: 'delivery',
        address: 'ул. Пушкина, 1',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.number).toBe(1);
    expect(result.value.itemsTotalMinor).toBe(product.priceMinor * 2);
    expect(result.value.totalMinor).toBe(product.priceMinor * 2 + 0); // deliveryFee 0 in seed
    expect(result.value.prepaymentMinor).toBe(Math.ceil(result.value.totalMinor * 0.5));
    expect(result.value.capacityUnits).toBe(product.capacityUnits * 2);
    expect(result.value.status).toBe('new');
  });

  it('is idempotent by checkoutId', async () => {
    const { tenantId, products, customerId } = await setup();
    const product = products[0]!;
    const dueDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5);
    const input = {
      tenantId,
      customerId,
      cart: cartWith(product.id, 1, await firstActiveOptionIds(product.id)).cart,
      checkout: {
        checkoutId: 'chk-2',
        dueDate,
        fulfillment: 'pickup' as const,
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    };

    const first = await createOrder(input);
    const second = await createOrder(input);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.id).toBe(first.value.id);
    }
    expect(await getDb().select().from(orders)).toHaveLength(1);
  });

  it('rejects second submit to the last slot (parallel race) — only one succeeds', async () => {
    const { tenantId, customerId } = await setup();
    // fill capacity: 5 orders of 1 unit each
    const product = (await getDb().query.products.findMany())[3]!; // макаруны capacity 1
    const dueDate = addDays(toIsoDate(now, 'Europe/Moscow'), 5);

    for (let i = 0; i < 5; i++) {
      const r = await createOrder({
        tenantId,
        customerId,
        cart: cartWith(product.id, 1, await firstActiveOptionIds(product.id)).cart,
        checkout: {
          checkoutId: `fill-${i}`,
          dueDate,
          fulfillment: 'pickup',
          contactName: 'Иван',
          contactPhone: '+7999',
          referenceFileIds: [],
        },
        now,
      });
      expect(r.ok).toBe(true);
    }

    // now the date is full: any new order fails
    const overflow = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(product.id, 1, await firstActiveOptionIds(product.id)).cart,
      checkout: {
        checkoutId: 'overflow',
        dueDate,
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    expect(overflow).toEqual({ ok: false, error: 'CAPACITY_EXCEEDED' });
  });

  it('rejects when acceptOrders is false', async () => {
    const { tenantId, products, customerId } = await setup();
    const db = getDb();
    const { tenants } = await import('../src/db/schema.js');
    await db.update(tenants).set({ acceptOrders: false }).where(eq(tenants.id, tenantId));

    const result = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(products[0]!.id, 1, await firstActiveOptionIds(products[0]!.id)).cart,
      checkout: {
        checkoutId: 'chk-busy',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    expect(result).toEqual({ ok: false, error: 'TENANT_BUSY' });
  });

  it('rejects an inactive product', async () => {
    const { tenantId, products, customerId } = await setup();
    const db = getDb();
    const { products: pTable } = await import('../src/db/schema.js');
    await db.update(pTable).set({ isActive: false }).where(eq(pTable.id, products[0]!.id));

    const result = await createOrder({
      tenantId,
      customerId,
      cart: cartWith(products[0]!.id, 1, await firstActiveOptionIds(products[0]!.id)).cart,
      checkout: {
        checkoutId: 'chk-inactive',
        dueDate: addDays(toIsoDate(now, 'Europe/Moscow'), 5),
        fulfillment: 'pickup',
        contactName: 'Иван',
        contactPhone: '+7999',
        referenceFileIds: [],
      },
      now,
    });
    expect(result).toEqual({ ok: false, error: 'PRODUCT_INACTIVE' });
  });
});
