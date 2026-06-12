/**
 * Mindy Advocate accounts (Launch Strategy T4 — power users / creators).
 *
 * Not staff (@govcongiants.com), not Mindy Team (paid), not comp/testimonial
 * (demo accounts for marketing). Advocates get complimentary Pro access and are
 * excluded from upgrade / trial conversion campaigns.
 */
export const ADVOCATE_ACCOUNTS: ReadonlyArray<{ email: string; name?: string }> = [
  { email: 'westover105@gmail.com', name: 'Sue Kranes' },
];

const ADVOCATE_EMAIL_SET = new Set(
  ADVOCATE_ACCOUNTS.map((a) => a.email.toLowerCase().trim()),
);

export function isAdvocateAccount(email: string | null | undefined): boolean {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return false;
  return ADVOCATE_EMAIL_SET.has(normalized);
}

export function getAdvocateName(email: string | null | undefined): string | undefined {
  const normalized = (email || '').toLowerCase().trim();
  return ADVOCATE_ACCOUNTS.find((a) => a.email === normalized)?.name;
}
