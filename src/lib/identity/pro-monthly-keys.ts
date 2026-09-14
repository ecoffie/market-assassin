/**
 * Exactly-once Pro monthly credit keys.
 *
 * Primary key is account-scoped so an email change cannot mint a second grant.
 * Legacy email keys are included in the SAME apply set so a Stripe/cron retry
 * after rename still hits the prior guard row.
 */

export function proMonthlyAccountKey(accountId: string, month: string): string {
  return `pro:acct:${accountId}:${month}`;
}

export function proMonthlyLegacyEmailKey(email: string, month: string): string {
  return `pro:${email.toLowerCase().trim()}:${month}`;
}

/**
 * Build the full idempotency key set for one monthly grant.
 * Dedupes; account key always first.
 */
export function proMonthlyCreditKeys(input: {
  accountId: string;
  month: string; // YYYY-MM
  emails: string[];
}): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const push = (k: string) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  push(proMonthlyAccountKey(input.accountId, input.month));
  for (const email of input.emails) {
    const e = (email || '').toLowerCase().trim();
    if (e.includes('@')) push(proMonthlyLegacyEmailKey(e, input.month));
  }
  return keys;
}
