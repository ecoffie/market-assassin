/**
 * Stripe billing email → MCP working email.
 *
 * The monthly Pro/Team credit grant enumerates ACTIVE Stripe customers by
 * `customer.email`. Some paying subscribers bill under one address and use
 * Mindy / MCP under another — credits land on the Stripe email and the
 * working account stays at the free signup balance.
 *
 * Same class as advocate "register the account they WORK FROM" (Tabitha).
 * Map is explicit and small on purpose — do not invent aliases from KV or
 * profile guesses (that is how the 2026-07-15 access-keyed grant accident
 * happened). Add a row only when a human confirms the pair.
 *
 * Keys and values are lowercased. Lookup is exact.
 */
export const MCP_BILLING_EMAIL_ALIASES: Readonly<Record<string, string>> = {
  // Ereck Harrison — Pro $149 bills to harrisonplus; app + MCP = serviceopsgroup
  // (2026-09-14 support: Stripe cus_VDb66ELOGzNnT5 / sub_1UD9ufK5zyiZ50PBUfnLvXNH)
  'ereck@harrisonplus.com': 'ereck@serviceopsgroup.com',
};

/** Resolve the email that should receive MCP Pro/Team monthly credits. */
export function resolveMcpCreditEmail(stripeBillingEmail: string): string {
  const e = stripeBillingEmail.toLowerCase().trim();
  return MCP_BILLING_EMAIL_ALIASES[e] ?? e;
}
