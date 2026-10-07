import { getDb } from '../db/client.js';
import { categories, products, productOptions } from '../db/schema.js';
import { and, eq, asc } from 'drizzle-orm';

export async function listActiveCategories(tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.isActive, true)))
    .orderBy(asc(categories.sortOrder));
}

export async function getCategoryIfActive(tenantId: string, categoryId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId)))
    .limit(1);
  const category = rows[0];
  return category && category.isActive ? category : null;
}

export async function getCategoryById(tenantId: string, categoryId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCategoriesAll(tenantId: string) {
  const db = getDb();
  return db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .orderBy(asc(categories.sortOrder));
}

export async function listProductsAll(tenantId: string, categoryId: string) {
  const db = getDb();
  return db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, categoryId)))
    .orderBy(asc(products.sortOrder));
}

export async function getProductById(tenantId: string, productId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listProducts(tenantId: string, categoryId: string) {
  const db = getDb();
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.categoryId, categoryId),
        eq(products.isActive, true)
      )
    )
    .orderBy(asc(products.sortOrder));
}

export async function getProductIfOwned(tenantId: string, productId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  const product = rows[0];
  return product && product.isActive ? product : null;
}

export async function listProductOptions(productId: string) {
  const db = getDb();
  return db
    .select()
    .from(productOptions)
    .where(and(eq(productOptions.productId, productId), eq(productOptions.isActive, true)))
    .orderBy(asc(productOptions.sortOrder));
}
