import { ru } from './ru.js';
import { uz } from './uz.js';
import type { Lang } from '../types.js';

export type Strings = typeof ru;

// Compile-time guard: uz must mirror ru exactly.
const _shapeCheck: Strings = uz;
void _shapeCheck;

export const SUPPORTED_LANGS: readonly Lang[] = ['ru', 'uz'];

export function isLang(s: string): s is Lang {
  return s === 'ru' || s === 'uz';
}

/** Tenant language → strings. Unknown/null falls back to Russian. */
export function stringsFor(lang: string | null | undefined): Strings {
  return lang === 'uz' ? uz : ru;
}

/** Tenant language → Intl locale for numbers and dates. */
export function localeFor(lang: string | null | undefined): string {
  return lang === 'uz' ? 'uz-Latn' : 'ru-RU';
}

export const CURRENCY_CODES = { rub: '₽', kzt: '₸', uzs: 'UZS' } as const;
export type CurrencyCode = keyof typeof CURRENCY_CODES;

export function currencyForCode(code: string): string | null {
  if (code === 'rub') return CURRENCY_CODES.rub;
  if (code === 'kzt') return CURRENCY_CODES.kzt;
  if (code === 'uzs') return CURRENCY_CODES.uzs;
  return null;
}
