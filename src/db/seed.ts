import { getDb } from './client.js';
import { tenants, categories, products, productOptions, faqItems } from './schema.js';
import { encrypt } from '../lib/crypto.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

export const DEMO_SLUG = 'demo';

export async function seedDemo(
  appSecret: string,
  now: Date
): Promise<{ tenantId: string; created: boolean }> {
  const db = getDb();

  const existing = await db.select().from(tenants).where(eq(tenants.slug, DEMO_SLUG)).limit(1);
  if (existing.length > 0) {
    return { tenantId: existing[0]!.id, created: false };
  }

  const tenantId = nanoid();

  const cats = [
    { title: 'Торты', sortOrder: 1 },
    { title: 'Бенто', sortOrder: 2 },
    { title: 'Капкейки', sortOrder: 3 },
    { title: 'Макаруны', sortOrder: 4 },
  ].map((c) => ({ id: nanoid(), tenantId, ...c }));

  await db.insert(tenants).values({
    id: tenantId,
    slug: DEMO_SLUG,
    botTokenEnc: encrypt('000000:demo-placeholder', appSecret),
    botId: 0,
    botUsername: 'demo_bot',
    shopName: 'Демо-кондитерская',
    greetingText:
      'Привет! Я бот демо-магазина. Здесь вы можете посмотреть каталог и оформить заказ.',
    aboutText: 'Демо-магазин для тестового запуска бота.',
    contactsText: 'Telegram: @demo',
    deliveryText: 'Доставка по городу, от 300 ₽.',
    paymentText: 'Реквизиты для предоплаты: карта 0000 0000 0000 0000.',
    busyText: 'Сейчас много заказов, оформление временно закрыто. Напишите мастеру.',
    createdAt: now,
  });

  await db.insert(categories).values(cats.map((c) => ({ ...c, isActive: true })));

  const [cakes, bento, cupcakes, macarons] = cats;

  const prdCake = {
    id: nanoid(),
    tenantId,
    categoryId: cakes!.id,
    title: 'Торт "Медовик"',
    description: 'Классический медовый торт со сметанным кремом, вес от 1 кг.',
    priceMinor: 150000,
    unit: 'шт',
    capacityUnits: 2,
    sortOrder: 1,
    isActive: true,
  };
  const prdBento = {
    id: nanoid(),
    tenantId,
    categoryId: bento!.id,
    title: 'Торт-бенто',
    description: 'Мини-торт 12 см с надписью, вес около 400 г.',
    priceMinor: 120000,
    unit: 'шт',
    sortOrder: 1,
    isActive: true,
  };
  const prdCupcakes = {
    id: nanoid(),
    tenantId,
    categoryId: cupcakes!.id,
    title: 'Капкейки (набор 6 шт)',
    description: 'Классические капкейки с крем-чизом.',
    priceMinor: 90000,
    unit: 'набор',
    sortOrder: 1,
    isActive: true,
  };
  const prdMacarons = {
    id: nanoid(),
    tenantId,
    categoryId: macarons!.id,
    title: 'Макаруны (набор 6 шт)',
    description: 'Ассорти вкусов на выбор.',
    priceMinor: 84000,
    unit: 'набор',
    sortOrder: 1,
    isActive: true,
  };

  await db.insert(products).values([prdCake, prdBento, prdCupcakes, prdMacarons]);

  await db.insert(productOptions).values([
    {
      id: nanoid(),
      productId: prdCake.id,
      groupTitle: 'Вес',
      title: '1 кг',
      priceDeltaMinor: 0,
      sortOrder: 1,
    },
    {
      id: nanoid(),
      productId: prdCake.id,
      groupTitle: 'Вес',
      title: '2 кг',
      priceDeltaMinor: 150000,
      sortOrder: 2,
    },
    {
      id: nanoid(),
      productId: prdBento.id,
      groupTitle: 'Начинка',
      title: 'Малина-фисташка',
      priceDeltaMinor: 0,
      sortOrder: 1,
    },
    {
      id: nanoid(),
      productId: prdBento.id,
      groupTitle: 'Начинка',
      title: 'Шоколад-вишня',
      priceDeltaMinor: 20000,
      sortOrder: 2,
    },
  ]);

  await db.insert(faqItems).values(
    [
      {
        q: 'Сколько стоит торт?',
        a: 'Цены есть в каталоге. Медовик от 1500 ₽ за кг, бенто от 1200 ₽.',
      },
      { q: 'За сколько дней заказывать?', a: 'Минимум за 2 дня. В праздники лучше раньше.' },
      { q: 'Есть доставка?', a: 'Да, по городу. Стоимость доставки показывается при оформлении.' },
      {
        q: 'Как оплатить?',
        a: 'Предоплата 50% по реквизитам, остаток при получении. Чек присылаете в бота.',
      },
      {
        q: 'Как сделать заказ?',
        a: 'Откройте каталог, добавьте товар в корзину и оформите заказ.',
      },
      { q: 'Где самовывоз?', a: 'Адрес пришлём после подтверждения заказа.' },
    ].map((f, i) => ({ id: nanoid(), tenantId, question: f.q, answer: f.a, sortOrder: i + 1 }))
  );

  return { tenantId, created: true };
}
