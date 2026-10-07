import { z } from 'zod';
import { Result } from '../types.js';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoMonthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const daysSchema = z.enum(['7', '30']);
const directionSchema = z.enum(['inc', 'dec']);
const fulfillmentSchema = z.enum(['pickup', 'delivery']);
const reasonCodeSchema = z.enum(['full', 'busy', 'date', 'other']);
const settingsFieldSchema = z.string().regex(/^[A-Za-z0-9_]{1,32}$/);
const sourceCodeSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/);
const productFieldSchema = z.enum([
  'title',
  'description',
  'price',
  'unit',
  'lead',
  'capacity',
  'photo',
]);

const callbackSchema = z
  .union([
    z.object({ ns: z.literal('cat'), action: z.literal('list') }),
    z.object({ ns: z.literal('cat'), action: z.literal('open'), arg: idSchema }),
    z.object({ ns: z.literal('prd'), action: z.enum(['open', 'add']), arg: idSchema }),
    z.object({ ns: z.literal('prd'), action: z.literal('opt'), arg: idSchema, arg2: idSchema }),
    z.object({
      ns: z.literal('prd'),
      action: z.literal('qty'),
      arg: directionSchema,
      arg2: idSchema,
    }),
    z.object({ ns: z.literal('cart'), action: z.enum(['show', 'clear', 'noop']) }),
    z.object({ ns: z.literal('cart'), action: z.enum(['inc', 'dec', 'open']), arg: idSchema }),
    z.object({ ns: z.literal('chk'), action: z.enum(['start', 'skip', 'back', 'cancel']) }),
    z.object({ ns: z.literal('chk'), action: z.literal('date'), arg: isoDateSchema }),
    z.object({ ns: z.literal('chk'), action: z.literal('datepage'), arg: isoMonthSchema }),
    z.object({ ns: z.literal('chk'), action: z.literal('ful'), arg: fulfillmentSchema }),
    z.object({ ns: z.literal('chk'), action: z.literal('submit'), arg: idSchema }),
    z.object({ ns: z.literal('chk'), action: z.literal('photos'), arg: z.literal('done') }),
    z.object({ ns: z.literal('my'), action: z.literal('list') }),
    z.object({ ns: z.literal('my'), action: z.enum(['view', 'cancel', 'refs']), arg: idSchema }),
    z.object({ ns: z.literal('nav'), action: z.literal('menu') }),
    z.object({ ns: z.literal('pay'), action: z.literal('sent'), arg: idSchema }),
    z.object({ ns: z.literal('faq'), action: z.literal('list') }),
    z.object({ ns: z.literal('faq'), action: z.literal('view'), arg: idSchema }),
    z.object({ ns: z.literal('rel'), action: z.literal('start') }),
    z.object({ ns: z.literal('pd'), action: z.enum(['yes', 'no']), arg: idSchema }),
    z.object({ ns: z.literal('adm'), area: z.literal('menu') }),
    z.object({ ns: z.literal('adm'), area: z.literal('preview') }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('stats'),
      action: z.literal('summary'),
      arg: daysSchema.optional(),
    }),
    z.object({ ns: z.literal('adm'), area: z.literal('cat'), action: z.enum(['list', 'add']) }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('cat'),
      action: z.enum(['rename', 'edit', 'toggle', 'up', 'down', 'del']),
      arg: idSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('prd'),
      action: z.enum(['list', 'add', 'edit', 'toggle', 'up', 'down', 'del', 'opt', 'optadd']),
      arg: idSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('prd'),
      action: z.literal('field'),
      arg: idSchema,
      arg2: productFieldSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('prd'),
      action: z.enum(['opttoggle', 'optdel']),
      arg: idSchema,
      arg2: idSchema,
    }),
    z.object({ ns: z.literal('adm'), area: z.literal('faq'), action: z.enum(['list', 'add']) }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('faq'),
      action: z.enum(['edit', 'q', 'a', 'del']),
      arg: idSchema,
    }),
    z.object({ ns: z.literal('adm'), area: z.literal('set'), action: z.literal('list') }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('set'),
      action: z.literal('edit'),
      arg: settingsFieldSchema,
    }),
    z.object({ ns: z.literal('adm'), area: z.literal('cal'), action: z.literal('list') }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('cal'),
      action: z.literal('page'),
      arg: isoMonthSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('cal'),
      action: z.enum(['day', 'toggle', 'setcap']),
      arg: isoDateSchema,
    }),
    z.object({ ns: z.literal('adm'), area: z.literal('src'), action: z.enum(['list', 'add']) }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('src'),
      action: z.enum(['view', 'del']),
      arg: sourceCodeSchema,
    }),
    z.object({ ns: z.literal('adm'), area: z.literal('ord'), action: z.literal('list') }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('ord'),
      action: z.enum([
        'view',
        'msg',
        'refs',
        'accept',
        'reject',
        'paid',
        'badpay',
        'ready',
        'done',
        'cancel',
        'date',
      ]),
      arg: idSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('ord'),
      action: z.literal('rr'),
      arg: idSchema,
      arg2: reasonCodeSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('ord'),
      action: z.literal('datepage'),
      arg: idSchema,
      arg2: isoMonthSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('ord'),
      action: z.literal('pd'),
      arg: idSchema,
      arg2: isoDateSchema,
    }),
    z.object({
      ns: z.literal('adm'),
      area: z.literal('relay'),
      action: z.literal('block'),
      arg: idSchema,
    }),
  ])
  .and(
    z.object({
      action: z.string().min(1).max(32).optional(),
      arg: idSchema.optional(),
      arg2: z.string().min(1).max(32).optional(),
    })
  );

export type Callback = z.infer<typeof callbackSchema>;

const MAX_BYTES = 64;

export function encodeCallback(c: Callback): string {
  switch (c.ns) {
    case 'cat':
      return c.action === 'list' ? 'cat:list' : `cat:open:${c.arg}`;
    case 'prd': {
      if (c.action === 'opt') return `prd:opt:${c.arg}:${c.arg2}`;
      if (c.action === 'qty') return `prd:qty:${c.arg}:${c.arg2}`;
      if (c.action === 'add') return `prd:add:${c.arg}`;
      return `prd:open:${c.arg}`;
    }
    case 'cart':
      return 'arg' in c && c.arg ? `cart:${c.action}:${c.arg}` : `cart:${c.action}`;
    case 'chk':
      return 'arg' in c && c.arg ? `chk:${c.action}:${c.arg}` : `chk:${c.action}`;
    case 'my':
      return c.action === 'list' ? 'my:list' : `my:${c.action}:${c.arg}`;
    case 'nav':
      return 'nav:menu';
    case 'pay':
      return `pay:sent:${c.arg}`;
    case 'faq':
      return c.action === 'list' ? 'faq:list' : `faq:view:${c.arg}`;
    case 'rel':
      return 'rel:start';
    case 'pd':
      return `pd:${c.action}:${c.arg}`;
    case 'adm': {
      if (c.area === 'menu') return 'adm:menu';
      if (c.area === 'preview') return 'adm:preview';
      if (c.area === 'stats') {
        return c.arg ? `adm:stats:${c.arg}` : 'adm:stats';
      }
      const base = `adm:${c.area}:${c.action ?? ''}`;
      if ('arg2' in c && c.arg2) return `${base}:${c.arg}:${c.arg2}`;
      if ('arg' in c && c.arg) return `${base}:${c.arg}`;
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
    if (second === 'menu' && parts.length === 2) {
      return { ok: true, value: { ns: 'adm', area: 'menu' } };
    }
    if (second === 'preview' && parts.length === 2) {
      return { ok: true, value: { ns: 'adm', area: 'preview' } };
    }
    if (second === 'stats' && (parts.length === 2 || parts.length === 3)) {
      const candidate = {
        ns,
        area: second,
        action: 'summary',
        arg: parts.length === 3 ? third : undefined,
      };
      const parsed = callbackSchema.safeParse(candidate);
      if (!parsed.success) {
        return { ok: false, error: 'BAD_CALLBACK' };
      }
      return { ok: true, value: parsed.data };
    }
    const candidate = { ns, area: second, action: third, arg: rest[0], arg2: rest[1] };
    const parsed = callbackSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, error: 'BAD_CALLBACK' };
    }
    return { ok: true, value: parsed.data };
  }

  const action = second;
  const arg = third;
  const candidate = { ns, action, arg, arg2: rest[0] };
  const parsed = callbackSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: 'BAD_CALLBACK' };
  }
  return { ok: true, value: parsed.data };
}

export function isCallbackLengthOk(c: Callback): boolean {
  return Buffer.byteLength(encodeCallback(c), 'utf8') <= MAX_BYTES;
}
