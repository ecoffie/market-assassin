/**
 * Mindy Advocate accounts (Launch Strategy T4 — power users / creators).
 *
 * Not staff (@govcongiants.com), not Mindy Team (paid), not comp/testimonial
 * (demo accounts for marketing). Advocates get complimentary Pro access and are
 * excluded from upgrade / trial conversion campaigns.
 */
export const ADVOCATE_ACCOUNTS: ReadonlyArray<{ email: string; name?: string }> = [
  { email: 'westover105@gmail.com', name: 'Sue Kranes' },
  // Added 2026-08-28 (Eric): power users running LIVE DEMOS of Mindy on our behalf.
  // They were absent from this registry, so nothing in the system marked them as
  // advocates — they read as ordinary paying users, which made every comp look like
  // revenue being given away and put them in upgrade campaigns they should never see.
  // Each one exhausted the 250/mo Pro allowance inside a single demo session and was
  // topped up by hand; register them so the exclusion is automatic, not manual.
  { email: 'olga@olaexecutiveconsulting.com', name: 'Olga Alcaraz' },
  { email: 'louis.reed@reedasolutions.com', name: 'Louis Reed' },
  { email: 'jaisonsolutions@gmail.com', name: 'Tabitha Ruffin' },
  // AJ moved to comp/testimonial 2026-07-19 and BACK to advocate 2026-08-28 (Eric) —
  // he is running live demos again. He also remains in campaign-exclusions.ts, which is
  // additive, not a conflict: that list suppresses campaigns, this one grants comp Pro.
  { email: 'aj@cypherintel.com', name: 'Andre Jerry' },
];

/**
 * ⚠️ IDENTITY NOTE — register the account the person ACTUALLY WORKS FROM, which is not
 * always the address they signed up with. Tabitha Ruffin connects as
 * jaisonsolutions@gmail.com; her app signup tfeast15@gmail.com holds the auth account and
 * is NOT where she works. That split was found the hard way: her Pro credits sat unspent
 * on the signup address while the demo account ran dry.
 * This list gates comp access and campaign exclusion, and both only matter where the
 * person actually is.
 */

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
