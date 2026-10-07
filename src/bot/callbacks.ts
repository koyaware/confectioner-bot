import { z } from 'zod';
import { Result } from '../types.js';

const idSchema = z.string().min(1).max(32);

const admActionSchema = z.enum([
  'list',
  'add',
  'rename',
  'edit',
  'toggle',
  'up',
  'down',
  'del',
  'field',
  'opt',
  'optadd',
  'optdel',
  'opttoggle',
  'q',
  'a',
]);

const callbackSchema = z.union([
  z.object({ ns: z.literal('cat'), action: z.literal('list') }),
  z.object({ ns: z.literal('cat'), action: z.literal('open'), arg: idSchema }),
  z.object({ ns: z.literal('prd'), action: z.literal('open'), arg: idSchema }),
  z.object({ ns: z.literal('faq'), action: z.literal('list') }),
  z.object({ ns: z.literal('faq'), action: z.literal('view'), arg: idSchema }),
  z.object({
    ns: z.literal('adm'),
    area: z.enum(['cat', 'prd', 'faq', 'set']),
    action: admActionSchema,
    arg: idSchema.optional(),
    arg2: z.string().min(1).max(32).optional(),
  }),
]);

export type Callback = z.infer<typeof callbackSchema>;

const MAX_BYTES = 64;

export function encodeCallback(c: Callback): string {
  switch (c.ns) {
    case 'cat':
      return c.action === 'list' ? 'cat:list' : `cat:open:${c.arg}`;
    case 'prd':
      return `prd:open:${c.arg}`;
    case 'faq':
      return c.action === 'list' ? 'faq:list' : `faq:view:${c.arg}`;
    case 'adm': {
      const base = `adm:${c.area}:${c.action}`;
      if (c.arg2) return `${base}:${c.arg}:${c.arg2}`;
      if (c.arg) return `${base}:${c.arg}`;
      return base;
    }
  }
}

export function decodeCallback(s: string): Result<Callback, 'BAD_CALLBACK'> {
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 5) {
    return { ok: false, error: 'BAD_CALLBACK' };
  }
  const [ns, second, third, ...rest] = parts;

  if (ns === 'adm') {
    const candidate = { ns, area: second, action: third, arg: rest[0], arg2: rest[1] };
    const parsed = callbackSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, error: 'BAD_CALLBACK' };
    }
    return { ok: true, value: parsed.data };
  }

  const action = second;
  const arg = third;
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
