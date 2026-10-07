// Truncates text to Telegram limits (UTF-16 code units) without splitting
// surrogate pairs. Pure function: no DB, no Telegram, no Date.
export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  const chars = Array.from(s);
  let len = 0;
  let i = 0;
  while (i < chars.length && len + chars[i]!.length <= max - 1) {
    len += chars[i]!.length;
    i++;
  }
  return `${chars.slice(0, i).join('')}…`;
}
