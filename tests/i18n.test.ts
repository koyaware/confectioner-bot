import { describe, it, expect } from 'vitest';
import { ru } from '../src/i18n/ru.js';
import { uz } from '../src/i18n/uz.js';
import { kk } from '../src/i18n/kk.js';
import {
  stringsFor,
  isLang,
  localeFor,
  currencyForCode,
  SUPPORTED_LANGS,
} from '../src/i18n/index.js';

function keys(o: object): string[] {
  return Object.keys(o).sort();
}

describe('tenant language read path', () => {
  it('resolves ru/uz/kk and falls back to ru for unknown/null', () => {
    expect(stringsFor('ru')).toBe(ru);
    expect(stringsFor('uz')).toBe(uz);
    expect(stringsFor('kk')).toBe(kk);
    expect(stringsFor(null)).toBe(ru);
    expect(stringsFor(undefined)).toBe(ru);
    expect(stringsFor('en')).toBe(ru);
    expect(stringsFor('')).toBe(ru);
  });

  it('uz and kk mirror ru top-level shape', () => {
    expect(keys(uz)).toEqual(keys(ru));
    expect(keys(kk)).toEqual(keys(ru));
  });

  it('isLang accepts only supported langs', () => {
    expect(isLang('ru')).toBe(true);
    expect(isLang('uz')).toBe(true);
    expect(isLang('kk')).toBe(true);
    expect(isLang('en')).toBe(false);
    expect(isLang('')).toBe(false);
    expect(SUPPORTED_LANGS).toEqual(['ru', 'uz', 'kk']);
  });

  it('locale follows language with ru fallback', () => {
    expect(localeFor('uz')).toBe('uz-Latn');
    expect(localeFor('kk')).toBe('kk-KZ');
    expect(localeFor('ru')).toBe('ru-RU');
    expect(localeFor(null)).toBe('ru-RU');
  });

  it('uz and kk contain no Russian-only words', () => {
    // Loanwords shared across languages (FAQ, QR, brand names) are fine;
    // these stems only exist in Russian texts.
    const forbidden = [
      'Воронка',
      'Статус',
      'статус',
      'Написать',
      'написать',
      'Заказ',
      'Оплата',
      'оплат',
      'Отмена',
      'отмена',
      'Отменить',
      'Дата',
      'Цена',
      'Корзина',
      'Вопрос',
      'Ответ',
      'Доставка',
      'Старт',
      'Назад',
      'Меню',
      'Гость',
    ];
    const collect = (o: unknown, out: string[]): string[] => {
      if (typeof o === 'string') out.push(o);
      else if (Array.isArray(o)) o.forEach((v) => collect(v, out));
      else if (o && typeof o === 'object') Object.values(o).forEach((v) => collect(v, out));
      return out;
    };
    for (const [name, dict] of [
      ['uz', uz],
      ['kk', kk],
    ] as const) {
      for (const text of collect(dict, [])) {
        for (const word of forbidden) {
          expect(`${name}: ${text}`).not.toContain(word);
        }
      }
    }
  });

  it('currency codes are independent of language', () => {
    expect(currencyForCode('rub')).toBe('₽');
    expect(currencyForCode('kzt')).toBe('₸');
    expect(currencyForCode('uzs')).toBe('UZS');
    expect(currencyForCode('usd')).toBe(null);
    expect(currencyForCode('')).toBe(null);
  });
});
