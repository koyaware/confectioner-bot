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
    { title: '[CAKE] Торты', sortOrder: 1 },
    { title: '[BENTO] Бенто-торты', sortOrder: 2 },
    { title: '[CUPCAKE] Капкейки', sortOrder: 3 },
    { title: '[COOKIE] Макаруны', sortOrder: 4 },
    { title: '[JAR] Десерты в банках', sortOrder: 5 },
    { title: '[BOX] Наборы и коробки', sortOrder: 6 },
  ].map((c) => ({ id: nanoid(), tenantId, ...c }));

  await db.insert(tenants).values({
    id: tenantId,
    slug: DEMO_SLUG,
    botTokenEnc: encrypt('000000:demo-placeholder', appSecret),
    botId: 0,
    botUsername: 'demo_bot',
    shopName: 'SweetDreams Confectionery',
    greetingText:
      'Привет! Добро пожаловать в SweetDreams!\n\nЗдесь ты можешь посмотреть каталог, выбрать любимые десерты и оформить заказ за пару минут. Всё просто: каталог -> корзина -> оформление -> оплата.\n\nТорты на заказ\nБенто-торты с надписями\nКапкейки и макаруны\nДесерты в банках\n\nВыбирай раздел ниже',
    aboutText: 'SweetDreams -- это домашняя кондитерская, где каждый десерт сделан с любовью и из натуральных ингредиентов. Мы не используем маргарин, консерванты и сухие смеси. Только натуральное масло, натуральные ягоды, шоколад Callebaut и Valrhona, свежие яйца и молоко с местной фермы.\n\nСамовывоз: ул. Кондитерская, 15 (м. Площадь Славы)\nДоставка по городу от 300 руб.\nРаботаем: пн-вс 10:00-20:00',
    contactsText: 'Telegram: @sweetdreams_bot\n+7 (999) 123-45-67\nsweetdreams@email.com\nул. Кондитерская, 15',
    deliveryText: 'Доставка по городу:\n* До 5 км -- 300 руб.\n* 5-10 км -- 500 руб.\n* 10-15 км -- 700 руб.\n* Свыше 15 км -- по согласованию\n\nВремя доставки: 10:00-20:00\nКурьер свяжется за 30 мин до приезда',
    paymentText: 'Реквизиты для предоплаты (50%):\n\nКарта Сбербанк:\n2200 7000 1234 5678\nИванов И.И.\n\nКарта Тинькофф:\n2200 7000 8765 4321\nИванов И.И.\n\nПо номеру телефона (СБП):\n+7 (999) 123-45-67\n\nОстаток 50% оплачивается при получении наличными или переводом.',
    busyText: 'Сейчас очень много заказов, оформление временно закрыто.\n\nНо ты можешь написать мастера -- мы попробуем найти место!',
    createdAt: now,
  });

  await db.insert(categories).values(cats.map((c) => ({ ...c, isActive: true })));

  const [cakes, bento, cupcakes, macarons, jars, boxes] = cats;

  const productsList = [
    // Торты
    {
      id: nanoid(), tenantId, categoryId: cakes!.id,
      title: '[HONEY] Медовик классический',
      description: 'Классический медовый торт со сметанным кремом. Нежные коржи, пропитанные карамельным медом, нежнейший сметанный крем. Вес от 1 кг.',
      priceMinor: 180000, unit: 'кг', capacityUnits: 2, sortOrder: 1, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cakes!.id,
      title: '[CHOC] Шоколадный "Трюфель"',
      description: 'Насыщенный шоколадный бисквит, ганаш из бельгийского шоколада Valrhona 70%, шоколадный мусс. Без муки, без сахара в бисквите. Вес 1.2 кг.',
      priceMinor: 220000, unit: 'шт', capacityUnits: 3, sortOrder: 2, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cakes!.id,
      title: '[BERRY] Ягодный "Летний бриз"',
      description: 'Ванильный бисквит, мусс из белого шоколада, свежие ягоды (клубника, малина, черника), ягодное желе. Легкий, не сладкий. Вес 1.5 кг.',
      priceMinor: 250000, unit: 'шт', capacityUnits: 3, sortOrder: 3, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cakes!.id,
      title: '[NAP] "Наполеон" традиционный',
      description: 'Слоеное тесто, заварной крем с ванильным бином, карамелизированные яблоки между коржами. Классика жанра. Вес 1.8 кг.',
      priceMinor: 200000, unit: 'шт', capacityUnits: 2, sortOrder: 4, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cakes!.id,
      title: '[CARROT] Морковный торт с крем-чизом',
      description: 'Влажный морковный бисквит с орехами, корицей и изюмом, крем из сливочного сыра Philadelphia, апельсиновую цедру. Вес 1.3 кг.',
      priceMinor: 190000, unit: 'шт', capacityUnits: 2, sortOrder: 5, isActive: true,
    },

    // Бенто
    {
      id: nanoid(), tenantId, categoryId: bento!.id,
      title: '[FLORAL] Бенто-торт "Цветочный сад"',
      description: 'Мини-торт 12 см с вашим текстом или рисунком. Ванильный бисквит, клубничный конфитюр, крем-чиз. Идеально для подарка.',
      priceMinor: 140000, unit: 'шт', capacityUnits: 1, sortOrder: 1, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: bento!.id,
      title: '[CHOC2] Бенто "Шоколадная мечта"',
      description: 'Шоколадный бисквит, солевая карамель, шоколадный ганаш, крем из темного шоколада. Для истинных шокоголиков.',
      priceMinor: 150000, unit: 'шт', capacityUnits: 1, sortOrder: 2, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: bento!.id,
      title: '[BERRY2] Бенто "Ягодный флюр"',
      description: 'Пистациевый бисквит, мусс из белого шоколада, свежие ягоды, ягодное желе. Нежный вкус пистаций и ягод.',
      priceMinor: 160000, unit: 'шт', capacityUnits: 1, sortOrder: 3, isActive: true,
    },

    // Капкейки
    {
      id: nanoid(), tenantId, categoryId: cupcakes!.id,
      title: '[VANILLA] Капкейки "Ванильный рай" (6 шт)',
      description: 'Ванильные капкейки с кремом из белого шоколада и ванильного бина. Украшены съедобными цветами.',
      priceMinor: 90000, unit: 'набор', capacityUnits: 1, sortOrder: 1, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cupcakes!.id,
      title: '[CHOC3] Капкейки "Шоколадный бум" (6 шт)',
      description: 'Шоколадные капкейки с ликёрной наливкой, ганаш из темного шоколада, крем-чиз с какао.',
      priceMinor: 95000, unit: 'набор', capacityUnits: 1, sortOrder: 2, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cupcakes!.id,
      title: '[CARROT2] Капкейки "Морковный уют" (6 шт)',
      description: 'Морковные капкейки с орехами, крем-чиз с апельсиновой цедрой, посыпаны карамелизированными орехами.',
      priceMinor: 95000, unit: 'набор', capacityUnits: 1, sortOrder: 3, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: cupcakes!.id,
      title: '[LEMON] Капкейки "Лимонный пирог" (6 шт)',
      description: 'Лимонные капкейки с лимонным кардом, итальянская меринг, лимонная цедра. Освежающие и нежные.',
      priceMinor: 90000, unit: 'набор', capacityUnits: 1, sortOrder: 4, isActive: true,
    },

    // Макаруны
    {
      id: nanoid(), tenantId, categoryId: macarons!.id,
      title: '[ASSORT] Макаруны "Ассорти" (12 шт)',
      description: '12 макарун 6 вкусов: ваниль, шоколад, пистация, малина, лимон, соль-карамель. В подарочной коробке.',
      priceMinor: 120000, unit: 'коробка', capacityUnits: 1, sortOrder: 1, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: macarons!.id,
      title: '[CHOC4] Макаруны "Шоколадные" (12 шт)',
      description: 'Тёмный, молочный, белый шоколад, шоколад-апельсин, шоколад-мята, шоколад-соль. Для шокоголиков.',
      priceMinor: 130000, unit: 'коробка', capacityUnits: 1, sortOrder: 2, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: macarons!.id,
      title: '[FLORAL2] Макаруны "Цветочные" (12 шт)',
      description: 'Роза, лаванда, фиалка, сакура, гибискус, бузина. Нежные цветочные вкусы в элегантной коробке.',
      priceMinor: 140000, unit: 'коробка', capacityUnits: 1, sortOrder: 3, isActive: true,
    },

    // Десерты в банках
    {
      id: nanoid(), tenantId, categoryId: jars!.id,
      title: '[TIRAMISU] Тирамису в банке',
      description: 'Классическое тирамису: савоярди, эспрессо, маскарпоне, какао. В удобной стеклянной банке 250 мл.',
      priceMinor: 45000, unit: 'банка', capacityUnits: 1, sortOrder: 1, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: jars!.id,
      title: '[CHOC_MOUSSE] Шоколадный мусс в банке',
      description: 'Мусс из 70% шоколада, шоколадный бисквит, ганаш. Подаётся в банке 250 мл с ложечкой.',
      priceMinor: 48000, unit: 'банка', capacityUnits: 1, sortOrder: 2, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: jars!.id,
      title: '[CHEESECAKE] Чизкейк "Нью-Йорк" в банке',
      description: 'Классический чизкейк с креккеровой основой, ягодный соус. В банке 250 мл -- идеальная порция.',
      priceMinor: 50000, unit: 'банка', capacityUnits: 1, sortOrder: 3, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: jars!.id,
      title: '[BANANA] Банановый пудинг в банке',
      description: 'Ванильный пудинг, свежие бананы, ванильные печенье, взбитые сливки. Уютный десерт в банке 250 мл.',
      priceMinor: 42000, unit: 'банка', capacityUnits: 1, sortOrder: 4, isActive: true,
    },

    // Наборы
    {
      id: nanoid(), tenantId, categoryId: boxes!.id,
      title: '[GIFT1] Набор "Сладкая жизнь"',
      description: 'Подарочная коробка: 4 капкейка, 6 макарун, 2 банки десерта (на выбор), шоколадная плитка. В красивой упаковке.',
      priceMinor: 350000, unit: 'коробка', capacityUnits: 3, sortOrder: 1, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: boxes!.id,
      title: '[GIFT2] Набор "Шокоголик"',
      description: 'Шоколадный торт 0.5 кг, 6 шоколадных макарун, 4 капкейка "Шоколадный бум", горячий шоколад в термосе.',
      priceMinor: 420000, unit: 'коробка', capacityUnits: 4, sortOrder: 2, isActive: true,
    },
    {
      id: nanoid(), tenantId, categoryId: boxes!.id,
      title: '[GIFT3] Набор "Для неё"',
      description: 'Бенто-торт с надписью, 6 макарун "Цветочные", 4 капкейка "Ванильный рай", букет сушёных цветов.',
      priceMinor: 380000, unit: 'коробка', capacityUnits: 3, sortOrder: 3, isActive: true,
    },
  ];

  await db.insert(products).values(productsList);

  // Находим продукты для опций
  const productMap = new Map<string, string>();
  for (const p of productsList) {
    productMap.set(p.title, p.id);
  }

  const cake1 = productMap.get('[HONEY] Медовик классический')!;
  const cake2 = productMap.get('[CHOC] Шоколадный "Трюфель"')!;
  const cake3 = productMap.get('[BERRY] Ягодный "Летний бриз"')!;
  const cake4 = productMap.get('[NAP] "Наполеон" традиционный')!;
  const cake5 = productMap.get('[CARROT] Морковный торт с крем-чизом')!;
  const bento1 = productMap.get('[FLORAL] Бенто-торт "Цветочный сад"')!;
  const bento2 = productMap.get('[CHOC2] Бенто "Шоколадная мечта"')!;
  const cupcake1 = productMap.get('[VANILLA] Капкейки "Ванильный рай" (6 шт)')!;
  const macaron1 = productMap.get('[ASSORT] Макаруны "Ассорти" (12 шт)')!;
  const jar1 = productMap.get('[TIRAMISU] Тирамису в банке')!;
  const box1 = productMap.get('[GIFT1] Набор "Сладкая жизнь"')!;

  const options = [
    // Торты - вес
    { productId: cake1, groupTitle: '[SIZE] Вес', title: '1 кг', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake1, groupTitle: '[SIZE] Вес', title: '1.5 кг', priceDeltaMinor: 50000, sortOrder: 2 },
    { productId: cake1, groupTitle: '[SIZE] Вес', title: '2 кг', priceDeltaMinor: 90000, sortOrder: 3 },
    { productId: cake2, groupTitle: '[SIZE] Вес', title: '1.2 кг', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake2, groupTitle: '[SIZE] Вес', title: '1.8 кг', priceDeltaMinor: 80000, sortOrder: 2 },
    { productId: cake3, groupTitle: '[SIZE] Вес', title: '1.5 кг', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake3, groupTitle: '[SIZE] Вес', title: '2 кг', priceDeltaMinor: 70000, sortOrder: 2 },
    { productId: cake4, groupTitle: '[SIZE] Вес', title: '1.8 кг', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake4, groupTitle: '[SIZE] Вес', title: '2.5 кг', priceDeltaMinor: 60000, sortOrder: 2 },
    { productId: cake5, groupTitle: '[SIZE] Вес', title: '1.3 кг', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake5, groupTitle: '[SIZE] Вес', title: '2 кг', priceDeltaMinor: 50000, sortOrder: 2 },

    // Торты - начинка/дополнительно
    { productId: cake1, groupTitle: '[ADDON] Добавки', title: 'Без добавок', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake1, groupTitle: '[ADDON] Добавки', title: 'Свежие ягоды (+150 г)', priceDeltaMinor: 30000, sortOrder: 2 },
    { productId: cake2, groupTitle: '[CHOC] Шоколад', title: '70% Valrhona', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake2, groupTitle: '[CHOC] Шоколад', title: '85% одинарный сорт', priceDeltaMinor: 30000, sortOrder: 2 },
    { productId: cake3, groupTitle: '[BERRY] Ягоды', title: 'Клубника + малина', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake3, groupTitle: '[BERRY] Ягоды', title: 'Клубника + малина + черника', priceDeltaMinor: 20000, sortOrder: 2 },
    { productId: cake4, groupTitle: '[APPLE] Яблоки', title: 'Карамелизированные', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake4, groupTitle: '[APPLE] Яблоки', title: 'С карамелью и корицей', priceDeltaMinor: 15000, sortOrder: 2 },
    { productId: cake5, groupTitle: '[NUTS] Орехи', title: 'Грецкие орехи', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cake5, groupTitle: '[NUTS] Орехи', title: 'Пекан + кленовый сироп', priceDeltaMinor: 25000, sortOrder: 2 },

    // Бенто - надпись
    { productId: bento1, groupTitle: '[TEXT] Надпись на торте', title: 'Без надписи', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: bento1, groupTitle: '[TEXT] Надпись на торте', title: 'Текст до 20 символов', priceDeltaMinor: 0, sortOrder: 2 },
    { productId: bento1, groupTitle: '[TEXT] Надпись на торте', title: 'Рисунок/логотип', priceDeltaMinor: 50000, sortOrder: 3 },
    { productId: bento2, groupTitle: '[TEXT] Надпись на торте', title: 'Без надписи', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: bento2, groupTitle: '[TEXT] Надпись на торте', title: 'Текст до 20 символов', priceDeltaMinor: 0, sortOrder: 2 },

    // Капкейки - вкус крема
    { productId: cupcake1, groupTitle: '[CREAM] Крем', title: 'Белый шоколад + ваниль', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: cupcake1, groupTitle: '[CREAM] Крем', title: 'Крем-чиз + ягоды', priceDeltaMinor: 5000, sortOrder: 2 },

    // Макаруны - набор
    { productId: macaron1, groupTitle: '[COLOR] Цвета', title: 'Классические (пастель)', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: macaron1, groupTitle: '[COLOR] Цвета', title: 'Яркие (неон)', priceDeltaMinor: 5000, sortOrder: 2 },
    { productId: macaron1, groupTitle: '[COLOR] Цвета', title: 'На тему (свадьба, ДР)', priceDeltaMinor: 10000, sortOrder: 3 },

    // Десерты в банках - топпинг
    { productId: jar1, groupTitle: '[TOP] Топпинг', title: 'Какао порошок', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: jar1, groupTitle: '[TOP] Топпинг', title: 'Шоколадная крошка', priceDeltaMinor: 2000, sortOrder: 2 },

    // Наборы - упаковка
    { productId: box1, groupTitle: '[PACK] Упаковка', title: 'Крафт-коробка + лента', priceDeltaMinor: 0, sortOrder: 1 },
    { productId: box1, groupTitle: '[PACK] Упаковка', title: 'Деревянная коробка + сухоцветы', priceDeltaMinor: 20000, sortOrder: 2 },
  ];

  await db.insert(productOptions).values(
    options.map((o) => ({ id: nanoid(), tenantId, ...o }))
  );

  await db.insert(faqItems).values([
    {
      q: 'Сколько стоит торт?',
      a: 'Торты: от 1800 руб/кг (Медовик) до 2500 руб/шт (Ягодный). Бенто: от 1400 руб. Капкейки: 9000 руб/набор 6 шт. Макаруны: 12000 руб/коробка 12 шт. Десерты в банках: 4200-5000 руб. Наборы: 35000-42000 руб.',
    },
    {
      q: 'За сколько дней заказывать?',
      a: 'Минимум за 2 дня. В праздники (8 марта, 14 февраля, Новый год) -- за 5-7 дней. Бенто-торты можно заказать за 1 день (уточняйте доступность).',
    },
    {
      q: 'Есть доставка?',
      a: 'Да! По городу от 300 руб (до 5 км). 5-10 км -- 500 руб, 10-15 км -- 700 руб. Курьер свяжется за 30 мин. Самовывоз бесплатно (ул. Кондитерская, 15).',
    },
    {
      q: 'Как оплатить?',
      a: 'Предоплата 50% по карте/СБП при заказе, остаток 50% при получении (наличные или перевод). Реквизиты пришлём после подтверждения заказа.',
    },
    {
      q: 'Как сделать заказ?',
      a: '1. Откройте Каталог\n2. Выберите десерт, вес, добавки\n3. Добавьте в корзину\n4. Оформите заказ: дата, время, доставка/самовывоз, контакты\n5. Оплатите предоплату\n6. Заберите заказ или ждите курьера!',
    },
    {
      q: 'Где самовывоз?',
      a: 'ул. Кондитерская, 15 (м. Площадь Славы, выход 3). Пн-Вс 10:00-20:00. Забирайте заказ по номеру или имени.',
    },
    {
      q: 'Можно сделать торт без сахара/глютена/веганский?',
      a: 'Да! У нас есть веганские капкейки, безглютеновые брауни, торты на стевии. Уточните при заказе -- мастер предложит варианты.',
    },
    {
      q: 'Можно нарисовать на бенто-торте логотип/фото?',
      a: 'Да! Печатаем на съедобной бумаге любые изображения: фото, логотипы, рисунки. Доплата за печать -- 500 руб. Нужен файл хорошего качества.',
    },
    {
      q: 'Как хранить десерты?',
      a: 'Торты и капкейки -- в холодильнике до 3 дней. Макаруны -- до 7 дней. Десерты в банках -- до 5 дней. Не заморожайте! Перед подачей держите 15 мин при комнатной температуре.',
    },
  ].map((f, i) => ({ id: nanoid(), tenantId, question: f.q, answer: f.a, sortOrder: i + 1 }));

  return { tenantId, created: true };
}