import { getDb } from '../src/db/client.js';
import { productOptions } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Test helper mirroring UI behavior: exactly one active option per group.
 */
export async function firstActiveOptionIds(productId: string): Promise<string[]> {
  const opts = await getDb()
    .select()
    .from(productOptions)
    .where(eq(productOptions.productId, productId));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const o of opts) {
    if (o.isActive && !seen.has(o.groupTitle)) {
      seen.add(o.groupTitle);
      ids.push(o.id);
    }
  }
  return ids;
}
