import { localeFor } from '../i18n/index.js';

export function formatMinor(minor: number, currency: string, lang: string = 'ru'): string {
  const locale = localeFor(lang);
  const rubles = minor / 100;
  const formatted =
    rubles % 1 === 0
      ? rubles.toLocaleString(locale)
      : rubles.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}
