export type IsoDate = string;

export function toIsoDate(date: Date, timezone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const t1 = Date.UTC(y1!, m1! - 1, d1);
  const t2 = Date.UTC(y2!, m2! - 1, d2);
  return Math.round((t1 - t2) / 86_400_000);
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function zonedTimeToUtc(dateIso: IsoDate, time: string, timezone: string): Date {
  const guessMs = Date.parse(`${dateIso}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(guessMs));
  const wallAtGuess = `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}T${parts.find((p) => p.type === 'hour')!.value === '24' ? '00' : parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}:${parts.find((p) => p.type === 'second')!.value}Z`;
  const offsetMs = Date.parse(wallAtGuess) - guessMs;
  return new Date(guessMs - offsetMs);
}
