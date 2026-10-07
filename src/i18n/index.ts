import { ru } from './ru.js';
import { uz } from './uz.js';
import { kk } from './kk.js';
import type { Lang } from '../types.js';

export type Strings = typeof ru;

// Compile-time guard: uz and kk must mirror ru exactly.
const _shapeCheckUz: Strings = uz;
const _shapeCheckKk: Strings = kk;
void _shapeCheckUz;
void _shapeCheckKk;

export const SUPPORTED_LANGS: readonly Lang[] = ['ru', 'uz', 'kk'];

export function isLang(s: string): s is Lang {
  return s === 'ru' || s === 'uz' || s === 'kk';
}

/** Tenant language → strings. Unknown/null falls back to Russian. */
export function stringsFor(lang: string | null | undefined): Strings {
  if (lang === 'uz') return uz;
  if (lang === 'kk') return kk;
  return ru;
}

/** Tenant language → Intl locale for numbers and dates. */
export function localeFor(lang: string | null | undefined): string {
  if (lang === 'uz') return 'uz-Latn';
  if (lang === 'kk') return 'kk-KZ';
  return 'ru-RU';
}

export const CURRENCY_CODES = { rub: '₽', kzt: '₸', uzs: 'UZS' } as const;
export type CurrencyCode = keyof typeof CURRENCY_CODES;

export function currencyForCode(code: string): string | null {
  if (code === 'rub') return CURRENCY_CODES.rub;
  if (code === 'kzt') return CURRENCY_CODES.kzt;
  if (code === 'uzs') return CURRENCY_CODES.uzs;
  return null;
}
