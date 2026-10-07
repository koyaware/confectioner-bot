import { initDatabase, getDb } from '../src/db/client.js';
import { tenants, categories, products, productOptions, faqItems } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  initDatabase('./data.db');
  const db = getDb();
  const t = await db.select().from(tenants).where(eq(tenants.slug, 'anna-cakes'));
  const cats = await db.select().from(categories);
  const prods = await db.select().from(products);
  const opts = await db.select().from(productOptions);
  const faqs = await db.select().from(faqItems);
  console.log('Tenant:', t[0]);
  console.log('Categories:', cats.length);
  console.log('Products:', prods.length);
  console.log('Options:', opts.length);
  console.log('FAQs:', faqs.length);
}

main().catch(console.error);