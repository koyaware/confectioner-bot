// Truncates text to Telegram limits without splitting surrogate pairs.
// Pure function: no DB, no Telegram, no Date.
export function truncateText(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}
