import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { initDatabase, getDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedDemo } from '../src/db/seed.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt } from '../src/lib/crypto.js';
import { nanoid } from 'nanoid';

async function main() {
  const config = loadConfig();
  initDatabase(config.databasePath);
  migrate();

  const db = getDb();
  const now = new Date();

  // Check if anna-cakes already exists
  const existing = await db.select().from(tenants).where(eq(tenants.slug, 'anna-cakes')).limit(1);
  if (existing.length > 0) {
    console.log('anna-cakes tenant already exists:', existing[0].id);
    return;
  }

  const tenantId = nanoid();
  const appSecret = config.appSecret;

  // Use a placeholder token - USER MUST REPLACE WITH REAL TOKEN FROM @BOTFATHER
  const placeholderToken = '123456789:PLACEHOLDER_REPLACE_WITH_REAL_TOKEN_FROM_BOTFATHER';
  const encryptedToken = encrypt(placeholderToken, appSecret);

  await db.insert(tenants).values({
    id: tenantId,
    slug: 'anna-cakes',
    botTokenEnc: encryptedToken,
    botId: 0, // Will be set when bot starts
    botUsername: 'anna_cakes_bot', // Change to your bot's username
    shopName: '🍰 Anna\'s Cakes',
    greetingText:
      '👋 Welcome to Anna\'s Cakes! 🍰\n\nBrowse our catalog, pick your favorites, and place an order in minutes. Simple: catalog → cart → checkout → pay.\n\n🎂 Custom cakes\n🍰 Bento cakes with messages\n🧁 Cupcakes & macarons\n🍯 Jar desserts\n\nChoose a section below 👇',
    aboutText: '🏠 Anna\'s Cakes — home bakery where every dessert is made with love using natural ingredients. No margarine, preservatives, or dry mixes. Only real butter, fresh berries, Callebaut & Valrhona chocolate, farm-fresh eggs and milk.\n\n📍 Pickup: 15 Baker St (Victory Square metro)\n🚚 Delivery from $3\n⏰ Open: Mon–Sun 10:00–20:00',
    contactsText: '📱 Telegram: @anna_cakes_bot\n📞 +1 (999) 123-45-67\n📧 annascakes@email.com\n📍 15 Baker St',
    deliveryText: '🚚 City delivery:\n• Under 5 km — $3\n• 5–10 km — $5\n• 10–15 km — $7\n• Over 15 km — by agreement\n\n⏰ Delivery hours: 10:00–20:00\n📦 Courier calls 30 min before arrival',
    paymentText: '💳 50% deposit:\n\n🏦 Bank Card:\n2200 7000 1234 5678\nAnna I.\n\n📱 Phone (instant):\n+1 (999) 123-45-67\n\n⚠️ Remaining 50% paid on delivery (cash or transfer).',
    busyText: '😔 Too many orders right now, checkout is paused.\n\nBut you can message the baker — we will try to squeeze you in! ✍️',
    createdAt: new Date(),
  });

  const categoriesData = require('../src/db/seed-data/categories.json');
const productsData = require('../src/db/seed-data/products.json');
const optionsData = require('../src/db/seed-data/options.json');
const faqData = require('../src/db/seed-data/faq.json');

  const cats = categoriesData.map((c) => ({ id: nanoid(), tenantId, ...c }));
  await db.insert(categories).values(cats.map((c) => ({ ...c, isActive: true })));

  const [cakes, bento, cupcakes, macarons, jars, boxes] = cats;

  const productsList = productsData.map((p) => {
    let categoryId: string;
    const tk = p.titleKey;
    if (tk.startsWith('cake')) categoryId = cakes!.id;
    else if (tk.startsWith('bento')) categoryId = bento!.id;
    else if (tk.startsWith('cupcake')) categoryId = cupcakes!.id;
    else if (tk.startsWith('macaron')) categoryId = macarons!.id;
    else if (tk.startsWith('jar')) categoryId = jars!.id;
    else if (tk.startsWith('box')) categoryId = boxes!.id;
    else categoryId = cakes!.id;

    const { titleKey: _titleKey, ...rest } = p;
    return { id: nanoid(), tenantId, categoryId, ...rest };
  });

  await db.insert(products).values(productsList);

  const productMap = new Map<string, string>();
  for (const p of productsList) {
    productMap.set(p.title, p.id);
  }

  const cake1 = productMap.get('🍯 Classic Medovik')!;
  const cake2 = productMap.get('🍫 Chocolate "Truffle"')!;
  const cake3 = productMap.get('🍓 Berry "Summer Breeze"')!;
  const cake4 = productMap.get('🥛 Classic "Napoleon"')!;
  const cake5 = productMap.get('🥕 Carrot Cake with Cream Cheese')!;
  const bento1 = productMap.get('🎨 Bento "Flower Garden"')!;
  const bento2 = productMap.get('🍫 Bento "Chocolate Dream"')!;
  const cupcake1 = productMap.get('🧁 Cupcakes "Vanilla Bliss" (6 pcs)')!;
  const macaron1 = productMap.get('🌈 Macarons "Assorted" (12 pcs)')!;
  const jar1 = productMap.get('🍓 Tiramisu in a Jar')!;
  const box1 = productMap.get('🎁 Gift Box "Sweet Life"')!;

  const options = optionsData.map((o) => {
    let productId: string;
    switch (o.productTitleKey) {
      case 'cake1': productId = cake1; break;
      case 'cake2': productId = cake2; break;
      case 'cake3': productId = cake3; break;
      case 'cake4': productId = cake4; break;
      case 'cake5': productId = cake5; break;
      case 'bento1': productId = bento1; break;
      case 'bento2': productId = bento2; break;
      case 'cupcake1': productId = cupcake1; break;
      case 'macaron1': productId = macaron1; break;
      case 'jar1': productId = jar1; break;
      case 'box1': productId = box1; break;
      default: productId = cake1;
    }
    return { id: nanoid(), tenantId, productId, groupTitle: o.groupTitle, title: o.title, priceDeltaMinor: o.priceDeltaMinor, sortOrder: o.sortOrder };
  });

  await db.insert(productOptions).values(options);

  await db.insert(faqItems).values(
    faqData.map((f, i) => ({ id: nanoid(), tenantId, question: f.q, answer: f.a, sortOrder: i + 1 }))
  );

  console.log('✅ anna-cakes tenant created with full test data!');
  console.log('Tenant ID:', tenantId);
  console.log('');
  console.log('⚠️  IMPORTANT: Update the bot token!');
  console.log('1. Get a real token from @BotFather');
  console.log('2. Run this SQL to update:');
  console.log(`   UPDATE tenants SET bot_token_enc = '<encrypted_token>' WHERE slug = 'anna-cakes';`);
  console.log('   (Use the encrypt function from lib/crypto.ts with your APP_SECRET)');
  console.log('');
  console.log('Then run: npm run dev');
}

main().catch(console.error);