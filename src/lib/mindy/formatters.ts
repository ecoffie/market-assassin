export function formatMindyCurrency(value?: number | null, emptyValue = '$0'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return emptyValue;
  if (value === 0) return emptyValue;

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const compact = (divisor: number, suffix: string) => {
    const formatted = (abs / divisor).toFixed(1).replace(/\.0$/, '');
    return `${sign}$${formatted}${suffix}`;
  };

  if (abs >= 1_000_000_000_000) return compact(1_000_000_000_000, 'T');
  if (abs >= 1_000_000_000) return compact(1_000_000_000, 'B');
  if (abs >= 1_000_000) return compact(1_000_000, 'M');
  if (abs >= 1_000) return compact(1_000, 'K');

  return `${sign}$${Math.round(abs).toLocaleString()}`;
}
