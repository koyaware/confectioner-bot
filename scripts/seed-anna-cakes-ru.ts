import { initDatabase, getDb, getSqliteDb } from '../src/db/client.js';
import { nanoid } from 'nanoid';

async function main() {
  initDatabase('./data.db');
  const db = getDb();
  const sqliteDb = getSqliteDb();
  const now = new Date();
  const tenantId = 'oEviWk1P3yE4c_zbgRCwg';

  // Check current data
  const cats = sqliteDb.prepare('SELECT COUNT(*) as c FROM categories WHERE tenant_id = ?').get(tenantId);
  console.log('Current categories:', cats.c);
  const prods = sqliteDb.prepare('SELECT COUNT(*) as c FROM products WHERE tenant_id = ?').get(tenantId);
  console.log('Current products:', prods.c);
  const opts = sqliteDb.prepare('SELECT COUNT(*) as c FROM product_options po JOIN products p ON po.product_id = p.id WHERE p.tenant_id = ?').get(tenantId);
  console.log('Current options:', opts.c);
  const faqs = sqliteDb.prepare('SELECT COUNT(*) as c FROM faq_items WHERE tenant_id = ?').get(tenantId);
  console.log('Current FAQs:', faqs.c);

  if (cats.c > 0) {
    console.log('Data already exists, skipping...');
    return;
  }

  // Categories (Russian with emojis)
  const catsData = [
    { id: nanoid(), tenant_id: tenantId, title: '🎂 Торты', sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, title: '🍰 Бенто-торты', sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, title: '🧁 Капкейки', sort_order: 3, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, title: '🍪 Макаруны', sort_order: 4, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, title: '🍯 Десерты в банках', sort_order: 5, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, title: '🎁 Наборы и коробки', sort_order: 6, is_active: 1 },
  ];
  
  const insertCat = sqliteDb.prepare('INSERT INTO categories (id, tenant_id, title, sort_order, is_active) VALUES (?, ?, ?, ?, ?)');
  for (const c of catsData) {
    insertCat.run(c.id, c.tenant_id, c.title, c.sort_order, c.is_active);
  }
  console.log('✅ Categories inserted:', catsData.length);

  const [cakes, bento, cupcakes, macarons, jars, boxes] = catsData.map(c => c.id);

  // Products (Russian with emojis)
  const productsList = [
    { id: nanoid(), tenant_id: tenantId, category_id: cakes, title: '🍯 Классический Медовик', description: 'Классический медовый торт со сметанным кремом. Нежные коржи, пропитанные карамельным медом, нежнейший сметанный крем. Вес от 1 кг.', price_minor: 180000, unit: 'кг', capacity_units: 2, sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cakes, title: '🍫 Шоколадный "Трюфель"', description: 'Насыщенный шоколадный бисквит, ганаш из бельгийского шоколада Valrhona 70%, шоколадный мусс. Без муки, без сахара в бисквите. Вес 1.2 кг.', price_minor: 220000, unit: 'шт', capacity_units: 3, sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cakes, title: '🍓 Ягодный "Летний бриз"', description: 'Ванильный бисквит, мусс из белого шоколада, свежие ягоды (клубника, малина, черника), ягодное желе. Легкий, не сладкий. Вес 1.5 кг.', price_minor: 250000, unit: 'шт', capacity_units: 3, sort_order: 3, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cakes, title: '🥛 Классический "Наполеон"', description: 'Слоеное тесто, заварной крем с ванильным бином, карамелизированные яблоки между коржами. Классика жанра. Вес 1.8 кг.', price_minor: 200000, unit: 'шт', capacity_units: 2, sort_order: 4, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cakes, title: '🥕 Морковный торт с крем-чизом', description: 'Влажный морковный бисквит с орехами, корицей и изюмом, крем из сливочного сыра Philadelphia, апельсиновая цедра. Вес 1.3 кг.', price_minor: 190000, unit: 'шт', capacity_units: 2, sort_order: 5, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: bento, title: '🎨 Бенто-торт "Цветочный сад"', description: 'Мини-торт 12 см с вашим текстом или рисунком. Ванильный бисквит, клубничный конфитюр, крем-чиз. Идеально для подарка.', price_minor: 140000, unit: 'шт', capacity_units: 1, sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: bento, title: '🍫 Бенто "Шоколадная мечта"', description: 'Шоколадный бисквит, солевая карамель, шоколадный ганаш, крем из темного шоколада. Для истинных шокоголиков.', price_minor: 150000, unit: 'шт', capacity_units: 1, sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: bento, title: '🍓 Бенто "Ягодный флюр"', description: 'Пистациевый бисквит, мусс из белого шоколада, свежие ягоды, ягодное желе. Нежный вкус пистаций и ягод.', price_minor: 160000, unit: 'шт', capacity_units: 1, sort_order: 3, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cupcakes, title: '🧁 Капкейки "Ванильный рай" (6 шт)', description: 'Ванильные капкейки с кремом из белого шоколада и ванильного бина. Украшены съедобными цветами.', price_minor: 90000, unit: 'набор', capacity_units: 1, sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cupcakes, title: '🍫 Капкейки "Шоколадный бум" (6 шт)', description: 'Шоколадные капкейки с ликёрной наливкой, ганаш из темного шоколада, крем-чиз с какао.', price_minor: 95000, unit: 'набор', capacity_units: 1, sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cupcakes, title: '🥕 Капкейки "Морковный уют" (6 шт)', description: 'Морковные капкейки с орехами, крем-чиз с апельсиновой цедрой, посыпаны карамелизированными орехами.', price_minor: 95000, unit: 'набор', capacity_units: 1, sort_order: 3, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: cupcakes, title: '🍋 Капкейки "Лимонный пирог" (6 шт)', description: 'Лимонные капкейки с лимонным кардом, итальянская меренг, лимонная цедра. Освежающие и нежные.', price_minor: 90000, unit: 'набор', capacity_units: 1, sort_order: 4, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: macarons, title: '🌈 Макаруны "Ассорти" (12 шт)', description: '12 макарун 6 вкусов: ваниль, шоколад, пистация, малина, лимон, соль-карамель. В подарочной коробке.', price_minor: 120000, unit: 'коробка', capacity_units: 1, sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: macarons, title: '🍫 Макаруны "Шоколадные" (12 шт)', description: 'Тёмный, молочный, белый шоколад, шоколад-апельсин, шоколад-мята, шоколад-соль. Для шокоголиков.', price_minor: 130000, unit: 'коробка', capacity_units: 1, sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: macarons, title: '🌸 Макаруны "Цветочные" (12 шт)', description: 'Роза, лаванда, фиалка, сакура, гибискус, бузина. Нежные цветочные вкусы в элегантной коробке.', price_minor: 140000, unit: 'коробка', capacity_units: 1, sort_order: 3, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: jars, title: '🍓 Тирамису в банке', description: 'Классическое тирамису: савоярди, эспрессо, маскарпоне, какао. В удобной стеклянной банке 250 мл.', price_minor: 45000, unit: 'банка', capacity_units: 1, sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: jars, title: '🍫 Шоколадный мусс в банке', description: 'Мусс из 70% шоколада, шоколадный бисквит, ганаш. Подаётся в банке 250 мл с ложечкой.', price_minor: 48000, unit: 'банка', capacity_units: 1, sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: jars, title: '🍓 Чизкейк "Нью-Йорк" в банке', description: 'Классический чизкейк с креккеровой основой, ягодный соус. В банке 250 мл — идеальная порция.', price_minor: 50000, unit: 'банка', capacity_units: 1, sort_order: 3, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: jars, title: '🍌 Банановый пудинг в банке', description: 'Ванильный пудинг, свежие бананы, ванильные печенье, взбитые сливки. Уютный десерт в банке 250 мл.', price_minor: 42000, unit: 'банка', capacity_units: 1, sort_order: 4, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: boxes, title: '🎁 Набор "Сладкая жизнь"', description: 'Подарочная коробка: 4 капкейка, 6 макарун, 2 банки десерта (на выбор), шоколадная плитка. В красивой упаковке.', price_minor: 350000, unit: 'коробка', capacity_units: 3, sort_order: 1, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: boxes, title: '🍫 Набор "Шокоголик"', description: 'Шоколадный торт 0.5 кг, 6 шоколадных макарун, 4 капкейка "Шоколадный бум", горячий шоколад в термосе.', price_minor: 420000, unit: 'коробка', capacity_units: 4, sort_order: 2, is_active: 1 },
    { id: nanoid(), tenant_id: tenantId, category_id: boxes, title: '🌸 Набор "Для неё"', description: 'Бенто-торт с надписью, 6 макарун "Цветочные", 4 капкейка "Ванильный рай", букет сушёных цветов.', price_minor: 380000, unit: 'коробка', capacity_units: 3, sort_order: 3, is_active: 1 },
  ];

  const insertProduct = sqliteDb.prepare('INSERT INTO products (id, tenant_id, category_id, title, description, price_minor, unit, min_qty, max_qty, capacity_units, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 50, ?, ?, ?)');
  for (const p of productsList) {
    insertProduct.run(p.id, p.tenant_id, p.category_id, p.title, p.description, p.price_minor, p.unit, p.capacity_units, p.sort_order, p.is_active);
  }
  console.log('✅ Products inserted:', productsList.length);

  // Map product titles to IDs for options
  const productMap = new Map();
  for (const p of productsList) {
    productMap.set(p.title, p.id);
  }

  const cake1 = productMap.get('🍯 Классический Медовик')!;
  const cake2 = productMap.get('🍫 Шоколадный "Трюфель"')!;
  const cake3 = productMap.get('🍓 Ягодный "Летний бриз"')!;
  const cake4 = productMap.get('🥛 Классический "Наполеон"')!;
  const cake5 = productMap.get('🥕 Морковный торт с крем-чизом')!;
  const bento1 = productMap.get('🎨 Бенто-торт "Цветочный сад"')!;
  const bento2 = productMap.get('🍫 Бенто "Шоколадная мечта"')!;
  const cupcake1 = productMap.get('🧁 Капкейки "Ванильный рай" (6 шт)')!;
  const macaron1 = productMap.get('🌈 Макаруны "Ассорти" (12 шт)')!;
  const jar1 = productMap.get('🍓 Тирамису в банке')!;
  const box1 = productMap.get('🎁 Набор "Сладкая жизнь"')!;

  // Options (Russian with emojis)
  const options = [
    { product_id: cake1, group_title: '📏 Вес', title: '1 кг', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake1, group_title: '📏 Вес', title: '1.5 кг', price_delta_minor: 50000, sort_order: 2 },
    { product_id: cake1, group_title: '📏 Вес', title: '2 кг', price_delta_minor: 90000, sort_order: 3 },
    { product_id: cake2, group_title: '📏 Вес', title: '1.2 кг', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake2, group_title: '📏 Вес', title: '1.8 кг', price_delta_minor: 80000, sort_order: 2 },
    { product_id: cake3, group_title: '📏 Вес', title: '1.5 кг', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake3, group_title: '📏 Вес', title: '2 кг', price_delta_minor: 70000, sort_order: 2 },
    { product_id: cake4, group_title: '📏 Вес', title: '1.8 кг', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake4, group_title: '📏 Вес', title: '2.5 кг', price_delta_minor: 60000, sort_order: 2 },
    { product_id: cake5, group_title: '📏 Вес', title: '1.3 кг', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake5, group_title: '📏 Вес', title: '2 кг', price_delta_minor: 50000, sort_order: 2 },
    { product_id: cake1, group_title: '🍒 Добавки', title: 'Без добавок', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake1, group_title: '🍒 Добавки', title: 'Свежие ягоды (+150 г)', price_delta_minor: 30000, sort_order: 2 },
    { product_id: cake2, group_title: '🍫 Шоколад', title: '70% Valrhona', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake2, group_title: '🍫 Шоколад', title: '85% Один сорт', price_delta_minor: 30000, sort_order: 2 },
    { product_id: cake3, group_title: '🍓 Ягоды', title: 'Клубника + Малина', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake3, group_title: '🍓 Ягоды', title: 'Клубника + Малина + Черника', price_delta_minor: 20000, sort_order: 2 },
    { product_id: cake4, group_title: '🍎 Яблоки', title: 'Карамелизированные', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake4, group_title: '🍎 Яблоки', title: 'С карамелью и корицей', price_delta_minor: 15000, sort_order: 2 },
    { product_id: cake5, group_title: '🥜 Орехи', title: 'Грецкие орехи', price_delta_minor: 0, sort_order: 1 },
    { product_id: cake5, group_title: '🥜 Орехи', title: 'Пекан + Кленовый сироп', price_delta_minor: 25000, sort_order: 2 },
    { product_id: bento1, group_title: '✏️ Надпись', title: 'Без надписи', price_delta_minor: 0, sort_order: 1 },
    { product_id: bento1, group_title: '✏️ Надпись', title: 'Текст до 20 символов', price_delta_minor: 0, sort_order: 2 },
    { product_id: bento1, group_title: '✏️ Надпись', title: 'Рисунок/логотип', price_delta_minor: 50000, sort_order: 3 },
    { product_id: bento2, group_title: '✏️ Надпись', title: 'Без надписи', price_delta_minor: 0, sort_order: 1 },
    { product_id: bento2, group_title: '✏️ Надпись', title: 'Текст до 20 символов', price_delta_minor: 0, sort_order: 2 },
    { product_id: cupcake1, group_title: '🍦 Крем', title: 'Белый шоколад + ваниль', price_delta_minor: 0, sort_order: 1 },
    { product_id: cupcake1, group_title: '🍦 Крем', title: 'Крем-чиз + ягоды', price_delta_minor: 5000, sort_order: 2 },
    { product_id: macaron1, group_title: '🎨 Цвета', title: 'Классические (пастель)', price_delta_minor: 0, sort_order: 1 },
    { product_id: macaron1, group_title: '🎨 Цвета', title: 'Яркие (неон)', price_delta_minor: 5000, sort_order: 2 },
    { product_id: macaron1, group_title: '🎨 Цвета', title: 'На тему (свадьба, ДР)', price_delta_minor: 10000, sort_order: 3 },
    { product_id: jar1, group_title: '🍫 Топпинг', title: 'Какао порошок', price_delta_minor: 0, sort_order: 1 },
    { product_id: jar1, group_title: '🍫 Топпинг', title: 'Шоколадная крошка', price_delta_minor: 2000, sort_order: 2 },
    { product_id: box1, group_title: '🎀 Упаковка', title: 'Крафт-коробка + лента', price_delta_minor: 0, sort_order: 1 },
    { product_id: box1, group_title: '🎀 Упаковка', title: 'Деревянная коробка + сухоцветы', price_delta_minor: 20000, sort_order: 2 },
  ];

  const insertOption = sqliteDb.prepare('INSERT INTO product_options (id, product_id, group_title, title, price_delta_minor, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  for (const o of options) {
    insertOption.run(nanoid(), o.product_id, o.group_title, o.title, o.price_delta_minor, o.sort_order);
  }
  console.log('✅ Options inserted:', options.length);

  // FAQ (Russian with emojis)
  const faqsList = [
    { q: '💰 Сколько стоит торт?', a: '🎂 Торты: от 1800 ₽/кг (Медовик) до 2500 ₽/шт (Ягодный). Бенто: от 1400 ₽. Капкейки: 9000 ₽/набор 6 шт. Макаруны: 12000 ₽/коробка 12 шт. Десерты в банках: 4200-5000 ₽. Наборы: 35000-42000 ₽.' },
    { q: '📅 За сколько дней заказывать?', a: '📅 Минимум за 2 дня. В праздники (8 марта, 14 февраля, Новый год) — за 5-7 дней. Бенто-торты можно заказать за 1 день (уточняйте доступность).' },
    { q: '🚚 Есть доставка?', a: '🚚 Да! По городу от 300 ₽ (до 5 км). 5-10 км — 500 ₽, 10-15 км — 700 ₽. Курьер свяжется за 30 мин. Самовывоз бесплатно (ул. Кондитерская, 15).' },
    { q: '💳 Как оплатить?', a: '💳 Предоплата 50% по карте/СБП при заказе, остаток 50% при получении (наличные или перевод). Реквизиты пришлём после подтверждения заказа.' },
    { q: '📝 Как сделать заказ?', a: '1️⃣ Откройте 📦 Каталог\n2️⃣ Выберите десерт, вес, добавки\n3️⃣ 🛒 Добавьте в корзину\n4️⃣ ✅ Оформите заказ: дата, время, доставка/самовывоз, контакты\n5️⃣ 💳 Оплатите предоплату\n6️⃣ 🎂 Заберите заказ или ждите курьера!' },
    { q: '📍 Где самовывоз?', a: '📍 ул. Кондитерская, 15 (м. Площадь Славы, выход 3). Пн-Вс 10:00-20:00. Забирайте заказ по номеру или имени.' },
    { q: '🌱 Можно сделать торт без сахара/глютена/веганский?', a: '🌱 Да! У нас есть веганские капкейки, безглютеновые брауни, торты на стевии. Уточните при заказе — мастер предложит варианты.' },
    { q: '🎨 Можно нарисовать на бенто-торте логотип/фото?', a: '🎨 Да! Печатаем на съедобной бумаге любые изображения: фото, логотипы, рисунки. Доплата за печать — 500 ₽. Нужен файл хорошего качества.' },
    { q: '🧊 Как хранить десерты?', a: '🧊 Торты и капкейки — в холодильнике до 3 дней. Макаруны — до 7 дней. Десерты в банках — до 5 дней. Не заморожайте! Перед подачей держите 15 мин при комнатной температуре.' },
  ];

  const insertFaq = sqliteDb.prepare('INSERT INTO faq_items (id, tenant_id, question, answer, sort_order) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < faqsList.length; i++) {
    const f = faqsList[i];
    insertFaq.run(nanoid(), tenantId, f.q, f.a, i + 1);
  }
  console.log('✅ FAQs inserted:', faqsList.length);

  console.log('');
  console.log('✅ anna-cakes fully seeded with Russian test data!');
  console.log('Categories: 6, Products: 22, Options: 35, FAQs: 9');
}

main().catch(console.error);