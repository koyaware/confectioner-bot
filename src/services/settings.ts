import { getDb } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const SETTINGS_FIELDS = [
  'greetingText',
  'aboutText',
  'contactsText',
  'deliveryText',
  'paymentText',
  'busyText',
  'replySlaText',
  'prepaymentPercent',
  'minLeadDays',
  'maxAdvanceDays',
  'defaultDailyCapacity',
  'paymentDeadlineHours',
  'deliveryFeeMinor',
  'digestHour',
  'currency',
] as const;

export type SettingsField = (typeof SETTINGS_FIELDS)[number];

export function isSettingsField(s: string): s is SettingsField {
  return (SETTINGS_FIELDS as readonly string[]).includes(s);
}

export async function updateTenantSetting(
  tenantId: string,
  field: SettingsField,
  value: string | number
): Promise<void> {
  const db = getDb();
  await db
    .update(tenants)
    .set({ [field]: value })
    .where(eq(tenants.id, tenantId));
}

export function validateSetting(
  field: SettingsField,
  raw: string
): { ok: true; value: string | number } | { ok: false } {
  const trimmed = raw.trim();

  switch (field) {
    case 'prepaymentPercent': {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0 || n > 100) return { ok: false };
      return { ok: true, value: n };
    }
    case 'digestHour': {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0 || n > 23) return { ok: false };
      return { ok: true, value: n };
    }
    case 'minLeadDays':
    case 'maxAdvanceDays':
    case 'paymentDeadlineHours': {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0) return { ok: false };
      return { ok: true, value: n };
    }
    case 'defaultDailyCapacity': {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) return { ok: false };
      return { ok: true, value: n };
    }
    case 'deliveryFeeMinor': {
      const n = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return { ok: false };
      return { ok: true, value: Math.round(n * 100) };
    }
    case 'currency': {
      const lower = trimmed.toLowerCase();
      if (['₽', 'руб', 'рубль', 'rub', 'rur'].includes(lower)) return { ok: true, value: '₽' };
      if (['₸', 'тенге', 'tenge', 'kzt'].includes(lower)) return { ok: true, value: '₸' };
      if (['uzs', 'узс', 'сум', 'sum', 'uz'].includes(lower)) return { ok: true, value: 'UZS' };
      return { ok: false };
    }
    default: {
      if (trimmed.length === 0 || trimmed.length > 1000) return { ok: false };
      return { ok: true, value: trimmed };
    }
  }
}
