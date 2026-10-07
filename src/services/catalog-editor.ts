import { getDb } from '../db/client.js';
import { categories, products, productOptions } from '../db/schema.js';
import { and, eq, asc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { Result } from '../types.js';

export async function createCategory(tenantId: string, title: string): Promise<{ id: string }> {
  const db = getDb();
  const rows = await db
    .select({ max: sql<number | null>`max(${categories.sortOrder})` })
    .from(categories)
    .where(eq(categories.tenantId, tenantId));
  const sortOrder = (rows[0]?.max ?? -1) + 1;
  const id = nanoid();
  await db.insert(categories).values({ id, tenantId, title, sortOrder, isActive: true });
  return { id };
}

export async function updateCategoryTitle(tenantId: string, categoryId: string, title: string) {
  const db = getDb();
  await db
    .update(categories)
    .set({ title })
    .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId)));
}

export async function setCategoryActive(tenantId: string, categoryId: string, isActive: boolean) {
  const db = getDb();
  await db
    .update(categories)
    .set({ isActive })
    .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId)));
}

export async function moveCategory(
  tenantId: string,
  categoryId: string,
  dir: 'up' | 'down'
): Promise<void> {
  const db = getDb();
  const all = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .orderBy(asc(categories.sortOrder));

  const idx = all.findIndex((c) => c.id === categoryId);
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= all.length) return;

  const a = all[idx]!;
  const b = all[swapIdx]!;
  await db.update(categories).set({ sortOrder: b.sortOrder }).where(eq(categories.id, a.id));
  await db.update(categories).set({ sortOrder: a.sortOrder }).where(eq(categories.id, b.id));
}

export async function deleteCategory(
  tenantId: string,
  categoryId: string
): Promise<Result<null, 'HAS_PRODUCTS'>> {
  const db = getDb();
  const prods = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, categoryId)))
    .limit(1);

  if (prods.length > 0) {
    return { ok: false, error: 'HAS_PRODUCTS' };
  }

  await db
    .delete(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId)));
  return { ok: true, value: null };
}

export interface ProductPatch {
  title?: string;
  description?: string | null;
  priceMinor?: number;
  unit?: string;
  leadDays?: number | null;
  capacityUnits?: number;
  photoFileId?: string | null;
  categoryId?: string;
}

export async function createProduct(
  tenantId: string,
  categoryId: string,
  title: string,
  priceMinor: number
): Promise<{ id: string }> {
  const db = getDb();
  const rows = await db
    .select({ max: sql<number | null>`max(${products.sortOrder})` })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.categoryId, categoryId)));
  const sortOrder = (rows[0]?.max ?? -1) + 1;
  const id = nanoid();
  await db.insert(products).values({
    id,
    tenantId,
    categoryId,
    title,
    priceMinor,
    sortOrder,
    isActive: true,
  });
  return { id };
}

export async function updateProduct(
  tenantId: string,
  productId: string,
  patch: ProductPatch
): Promise<void> {
  const db = getDb();
  await db
    .update(products)
    .set(patch)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
}

export async function setProductActive(tenantId: string, productId: string, isActive: boolean) {
  const db = getDb();
  await db
    .update(products)
    .set({ isActive })
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
}

export async function moveProduct(tenantId: string, productId: string, dir: 'up' | 'down') {
  const db = getDb();
  const all = await db
    .select()
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(asc(products.sortOrder));

  const idx = all.findIndex((p) => p.id === productId);
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= all.length) return;

  const a = all[idx]!;
  const b = all[swapIdx]!;
  await db.update(products).set({ sortOrder: b.sortOrder }).where(eq(products.id, a.id));
  await db.update(products).set({ sortOrder: a.sortOrder }).where(eq(products.id, b.id));
}

export async function deleteProduct(tenantId: string, productId: string): Promise<void> {
  const db = getDb();
  await db.delete(productOptions).where(eq(productOptions.productId, productId));
  await db.delete(products).where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
}

export async function addOption(
  tenantId: string,
  productId: string,
  groupTitle: string,
  title: string,
  priceDeltaMinor: number
): Promise<Result<{ id: string }, 'NOT_FOUND'>> {
  const db = getDb();
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .limit(1);
  if (productRows.length === 0) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  const rows = await db
    .select({ max: sql<number | null>`max(${productOptions.sortOrder})` })
    .from(productOptions)
    .where(eq(productOptions.productId, productId));
  const sortOrder = (rows[0]?.max ?? -1) + 1;
  const id = nanoid();
  await db.insert(productOptions).values({
    id,
    productId,
    groupTitle,
    title,
    priceDeltaMinor,
    sortOrder,
    isActive: true,
  });
  return { ok: true, value: { id } };
}

export async function setOptionActive(
  tenantId: string,
  optionId: string,
  isActive: boolean
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: productOptions.id })
    .from(productOptions)
    .innerJoin(products, eq(productOptions.productId, products.id))
    .where(and(eq(productOptions.id, optionId), eq(products.tenantId, tenantId)))
    .limit(1);
  if (rows.length === 0) return false;
  await db.update(productOptions).set({ isActive }).where(eq(productOptions.id, optionId));
  return true;
}

export async function deleteOption(tenantId: string, optionId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: productOptions.id })
    .from(productOptions)
    .innerJoin(products, eq(productOptions.productId, products.id))
    .where(and(eq(productOptions.id, optionId), eq(products.tenantId, tenantId)))
    .limit(1);
  if (rows.length === 0) return false;
  await db.delete(productOptions).where(eq(productOptions.id, optionId));
  return true;
}
