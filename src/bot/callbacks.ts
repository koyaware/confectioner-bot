import { z } from 'zod';
import { Result } from '../types.js';

const idSchema = z.string().min(1).max(32);

const callbackSchema = z.union([
  z.object({ ns: z.literal('cat'), action: z.literal('list') }),
  z.object({ ns: z.literal('cat'), action: z.literal('open'), arg: idSchema }),
  z.object({ ns: z.literal('prd'), action: z.literal('open'), arg: idSchema }),
]);

export type Callback = z.infer<typeof callbackSchema>;

const MAX_BYTES = 64;

export function encodeCallback(c: Callback): string {
  switch (c.ns) {
    case 'cat':
      return c.action === 'list' ? 'cat:list' : `cat:open:${c.arg}`;
    case 'prd':
      return `prd:open:${c.arg}`;
  }
}

export function decodeCallback(s: string): Result<Callback, 'BAD_CALLBACK'> {
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return { ok: false, error: 'BAD_CALLBACK' };
  }
  const [ns, action, ...rest] = parts;
  const arg = rest[0];

  const candidate = arg ? { ns, action, arg } : { ns, action };
  const parsed = callbackSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: 'BAD_CALLBACK' };
  }
  return { ok: true, value: parsed.data };
}

export function isCallbackLengthOk(c: Callback): boolean {
  return Buffer.byteLength(encodeCallback(c), 'utf8') <= MAX_BYTES;
}
