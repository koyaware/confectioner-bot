export function formatMinor(minor: number, currency: string): string {
  const rubles = minor / 100;
  const formatted =
    rubles % 1 === 0
      ? rubles.toLocaleString('ru-RU')
      : rubles.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}
