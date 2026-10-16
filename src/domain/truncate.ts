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

const VOID_TAGS = new Set(['br']);

/**
 * HTML-aware truncate for parse_mode=HTML captions: never cuts inside a
 * tag or an entity, and closes tags left open by the cut. Falls back to
 * plain text when closers would overflow the limit.
 */
export function truncateHtml(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  for (let guard = 0; guard < 8; guard++) {
    cut = cut.replace(/&[A-Za-z0-9#]*$/, '').replace(/<[^>]*$/, '');
    const opens: string[] = [];
    const re = /<\/?([a-zA-Z]+)[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cut)) !== null) {
      const tag = m[1]!.toLowerCase();
      if (VOID_TAGS.has(tag)) continue;
      if (m[0][1] === '/') {
        const idx = opens.lastIndexOf(tag);
        if (idx >= 0) opens.splice(idx, 1);
      } else {
        opens.push(tag);
      }
    }
    const closers = opens
      .reverse()
      .map((t) => `</${t}>`)
      .join('');
    if (cut.length + 1 + closers.length <= max) return `${cut}…${closers}`;
    const over = cut.length + 1 + closers.length - max;
    if (cut.length <= over + 1) break;
    cut = cut.slice(0, cut.length - over - 1);
  }
  // Pathological nesting: drop formatting, keep the text.
  const plain = cut.replace(/<[^>]*>/g, '');
  return truncateText(plain, max);
}
