import { getDb } from './client.js';
import { tenants, categories, products, productOptions, faqItems } from './schema.js';
import { encrypt } from '../lib/crypto.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import tenantData from './seed-data/tenant.json' with { type: 'json' };
import categoriesData from './seed-data/categories.json' with { type: 'json' };
import productsData from './seed-data/products.json' with { type: 'json' };
import optionsData from './seed-data/options.json' with { type: 'json' };
import faqData from './seed-data/faq.json' with { type: 'json' };

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

  const cats = categoriesData.map((c) => ({ id: nanoid(), tenantId, ...c }));

  await db.insert(tenants).values({
    id: tenantId,
    slug: DEMO_SLUG,
    botTokenEnc: encrypt(tenantData.botTokenEnc, appSecret),
    botId: tenantData.botId,
    botUsername: tenantData.botUsername,
    shopName: tenantData.shopName,
    greetingText: tenantData.greetingText,
    aboutText: tenantData.aboutText,
    contactsText: tenantData.contactsText,
    deliveryText: tenantData.deliveryText,
    paymentText: tenantData.paymentText,
    busyText: tenantData.busyText,
    createdAt: now,
  });

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

  // Map product titles to IDs for options
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

  return { tenantId, created: true };
}