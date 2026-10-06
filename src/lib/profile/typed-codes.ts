/**
 * NAICS CODES A USER TYPED INTO THEIR OWN DESCRIPTION — offered back for confirmation, never applied.
 *
 * Match-health audit, 2026-10-06: 39 users wrote real 6-digit NAICS codes into their business
 * description ("Federal contractor: 541611, 541618. 484110, 484121 …") while their stored codes
 * were something else, usually the 5-code starter set. Company-setup Confirm returned 401 and
 * saved nothing until 2026-09-26, which plausibly explains most of them.
 *
 * The rule: a typed code is the user's own words, but it is still an INFERENCE that they meant it
 * as targeting. So it is only ever OFFERED — validated against the Census table, shown with its
 * official title, and written only when the user presses Accept on that one code. A Reject is
 * remembered (aggregated_profile.typed_code_decisions) so the same code is not offered again.
 */
import { getNaics } from '@/lib/codes/lookup';
import { isKnownNaicsCode } from '@/lib/codes/validate-market-codes';

export interface TypedCodeOffer {
  code: string;
  /** Census-authoritative title. */
  title: string;
}

/** Key inside user_notification_settings.aggregated_profile. Merge-preserving like alert_mode. */
export const TYPED_CODE_DECISIONS_KEY = 'typed_code_decisions';

/** Every standalone 6-digit token, in order of first appearance. Not validated. */
export function extractTypedNaics(text: string | null | undefined): string[] {
  const out: string[] = [];
  // Census validation (in typedCodeOffers) is what rejects non-codes; here we only skip money.
  for (const m of String(text || '').matchAll(/(?<![$\d])\b(\d{6})\b/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Codes this user has already rejected as typed-code offers. Unknown shapes read as none. */
export function rejectedTypedCodes(aggregated: unknown): string[] {
  if (!aggregated || typeof aggregated !== 'object' || Array.isArray(aggregated)) return [];
  const d = (aggregated as Record<string, unknown>)[TYPED_CODE_DECISIONS_KEY];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [];
  const r = (d as Record<string, unknown>).rejected;
  return Array.isArray(r) ? r.map((c) => String(c).trim()).filter(Boolean) : [];
}

/** aggregated_profile with `code` added to the rejected list. Every other key is preserved. */
export function mergeTypedCodeRejection(aggregated: unknown, code: string, at: string): Record<string, unknown> {
  const base = aggregated && typeof aggregated === 'object' && !Array.isArray(aggregated)
    ? { ...(aggregated as Record<string, unknown>) }
    : {};
  const rejected = [...new Set([...rejectedTypedCodes(aggregated), String(code).trim()])];
  base[TYPED_CODE_DECISIONS_KEY] = { rejected, updated_at: at };
  return base;
}

/**
 * Typed codes worth offering: 6-digit, present in the Census table, not already stored, not
 * previously rejected. Each carries its official title so the user can judge it.
 */
export function typedCodeOffers(
  texts: Array<string | null | undefined>,
  opts: { stored?: readonly string[] | null; rejected?: readonly string[] | null } = {},
): TypedCodeOffer[] {
  const stored = new Set((opts.stored || []).map((c) => String(c).trim()));
  const rejected = new Set((opts.rejected || []).map((c) => String(c).trim()));
  const seen = new Set<string>();
  const offers: TypedCodeOffer[] = [];
  for (const text of texts) {
    for (const code of extractTypedNaics(text)) {
      if (seen.has(code)) continue;
      seen.add(code);
      if (stored.has(code) || rejected.has(code) || !isKnownNaicsCode(code)) continue;
      const entry = getNaics(code);
      if (!entry?.title) continue;
      offers.push({ code, title: entry.title });
    }
  }
  return offers;
}
