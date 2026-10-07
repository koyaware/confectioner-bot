import { initDatabase, getDb } from '../src/db/client.js';
import { tenants, categories, products, productOptions, faqItems } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt } from '../src/lib/crypto.js';
import { nanoid } from 'nanoid';
import categoriesData from '../src/db/seed-data/categories.json';
import productsData from '../src/db/seed-data/products.json';
import optionsData from '../src/db/seed-data/options.json';
import faqData from '../src/db/seed-data/faq.json';

async function main() {
  initDatabase('./data.db');
  const db = getDb();
  const appSecret = process.env.APP_SECRET || 'kVGQcTSRVrPbpqOHYoYwrC9NuAslluvbTEADo3ylKiQ=';
  const now = new Date();

  // Update tenant with full data
  const tenantId = 'oEviWk1P3yE4c_zbgRCwg';
  const placeholderToken = '123456789:PLACEHOLDER_REPLACE_WITH_REAL_TOKEN_FROM_BOTFATHER';
  const encryptedToken = encrypt(placeholderToken, appSecret);

  await db.update(tenants).set({
    botTokenEnc: encryptedToken,
    botId: 8827774497,
    botUsername: 'anna_cakes_bot',
    shopName: "🍰 Anna's Cakes",
    greetingText:
      '👋 Welcome to Anna\'s Cakes! 🍰\n\nBrowse our catalog, pick your favorites, and place an order in minutes. Simple: catalog → cart → checkout → pay.\n\n🎂 Custom cakes\n🍰 Bento cakes with messages\n🧁 Cupcakes & macarons\n🍯 Jar desserts\n\nChoose a section below 👇',
    aboutText: '🏠 Anna\'s Cakes — home bakery where every dessert is made with love using natural ingredients. No margarine, preservatives, or dry mixes. Only real butter, fresh berries, Callebaut & Valrhona chocolate, farm-fresh eggs and milk.\n\n📍 Pickup: 15 Baker St (Victory Square metro)\n🚚 Delivery from $3\n⏰ Open: Mon–Sun 10:00–20:00',
    contactsText: '📱 Telegram: @anna_cakes_bot\n📞 +1 (999) 123-45-67\n📧 annascakes@email.com\n📍 15 Baker St',
    deliveryText: '🚚 City delivery:\n• Under 5 km — $3\n• 5–10 km — $5\n• 10–15 km — $7\n• Over 15 km — by agreement\n\n⏰ Delivery hours: 10:00–20:00\n📦 Courier calls 30 min before arrival',
    paymentText: '💳 50% deposit:\n\n🏦 Bank Card:\n2200 7000 1234 5678\nAnna I.\n\n📱 Phone (instant):\n+1 (999) 123-45-67\n\n⚠️ Remaining 50% paid on delivery (cash or transfer).',
    busyText: '😔 Too many orders right now, checkout is paused.\n\nBut you can message the baker — we will try to squeeze you in! ✍️',
    updatedAt: now,
  }).where(eq(tenants.id, 'oEviWk1P3yE4c_zbgRCwg'));

  console.log('✅ Tenant updated!');

  // Check current data
  const cats = await db.select().from(categories);
  console.log('Categories:', cats.length);
  const prods = await db.select().from(products);
  console.log('Products:', prods.length);
  const opts = await db.select().from(productOptions);
  console.log('Options:', opts.length);
  const faqs = await db.select().from(faqItems);
  console.log('FAQs:', faqs.length);

  // Update categories if needed (should be 6)
  if (cats.length === 6) {
    console.log('✅ Data looks complete!');
  }
}

main().catch(console.error);