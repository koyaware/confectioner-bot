import { describe, it, expect } from 'vitest';
import { ru } from '../src/i18n/ru.js';

describe('phone examples', () => {
  it('matches tenant currency', () => {
    expect(ru.checkout.phoneExample('₽')).toBe('+79991234567');
    expect(ru.checkout.phoneExample('₸')).toBe('+77001234567');
    expect(ru.checkout.phoneExample('UZS')).toBe('+998901234567');
    expect(ru.checkout.phoneExample('???')).toBe('+79991234567');
  });
});
