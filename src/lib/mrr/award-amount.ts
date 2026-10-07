/**
 * Award amount for display: the dollar figure FIRST, then what it measures.
 * The buyer-history cards used to print only the qualifier ("award lifetime
 * total to date, as reported by USASpending") and drop the number.
 */
export function awardAmountLabel(
  field: { state: string; value?: unknown } | undefined,
): string | null {
  if (!field || field.state !== 'value') return null;
  const amount = field.value as { value?: unknown; label?: unknown } | undefined;
  if (typeof amount?.value !== 'number' || !Number.isFinite(amount.value)) return null;
  const figure = `$${amount.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return typeof amount.label === 'string' && amount.label ? `${figure} — ${amount.label}` : figure;
}
