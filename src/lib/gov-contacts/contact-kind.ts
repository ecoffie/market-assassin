/**
 * Decision Makers — the AUTHORITATIVE government-vs-vendor classification.
 *
 * `federal_contacts` holds two structurally different populations in one table:
 *
 *   government_buyer   a named POC on a SAM NOTICE      — keyed <notice uuid>::<slot>,
 *                      always has a federal department, essentially always an email
 *   vendor_entity_poc  a SAM ENTITY-REGISTRATION POC    — keyed <UEI>::<role>, carries a UEI +
 *                      company, NEVER a department, NEVER an email, NEVER a solicitation
 *
 * ⚠️ NEVER discriminate on `source`, `source_table` or `role_category`.
 *   * `source` ('sam_opportunities_poc') and `role_category` ('contracting') are column DEFAULTS
 *     no producer sets. They are uniform across all rows, carry zero information, and are
 *     factually WRONG on all 82,017 vendor rows.
 *   * `source_table` is a GENERATION label. `AllSamContacts` and `sam_opportunities_pointOfContact`
 *     are the SAME upstream source — the live drain has already re-adopted 94.7% of the latter
 *     in place. Treating it as a source identity produces a three-source model that does not exist.
 *
 * The rules below are STRUCTURAL and were measured to partition the corpus exactly:
 * 82,017 vendor / 205,517 government / overlap 0 / unresolved 0 (2026-09-15T14:22Z).
 */

/** The only values `federal_contacts.contact_kind` may hold. NULL means unclassified. */
export type ContactKind = 'government_buyer' | 'vendor_entity_poc';

export const CONTACT_KIND_GOVERNMENT: ContactKind = 'government_buyer';
export const CONTACT_KIND_VENDOR: ContactKind = 'vendor_entity_poc';

/** The columns the classifier reads. Anything else is irrelevant to the decision. */
export interface ClassifiableContact {
  source_row_key?: string | null;
  department_ind_agency?: string | null;
  contact_email?: string | null;
  solicitation_number?: string | null;
  raw_data?: unknown;
}

/** `<notice uuid>::<slot index>` — the notice-POC key space, shared by BOTH government generations. */
const NOTICE_SLOT_KEY_RE = /^[0-9a-f]{32}::\d+$/;

function rawHas(raw: unknown, key: string): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && key in (raw as Record<string, unknown>);
}

/**
 * A SAM entity-registration POC.
 *
 * Keyed on the PAYLOAD (`uei` + `company`) plus the three absences, NOT on the key shape — six
 * real rows key as `No longer available::<role>` because SAM emits that literal for a delisted
 * entity, so a UEI-shaped key test alone would leave them unclassified. They are unambiguously
 * vendor rows: raw_data carries uei/company/role_title, and department/email/solicitation are
 * all null.
 */
export function isVendorEntityPoc(row: ClassifiableContact): boolean {
  return (
    rawHas(row.raw_data, 'uei') &&
    rawHas(row.raw_data, 'company') &&
    row.department_ind_agency == null &&
    row.contact_email == null &&
    row.solicitation_number == null
  );
}

/**
 * A government POC named on a SAM notice.
 *
 * Requires the notice key space AND a federal department AND the notice-POC payload shape, so a
 * vendor row cannot satisfy it even if a future import left a stray column populated.
 */
export function isGovernmentBuyerContact(row: ClassifiableContact): boolean {
  return (
    typeof row.source_row_key === 'string' &&
    NOTICE_SLOT_KEY_RE.test(row.source_row_key) &&
    row.department_ind_agency != null &&
    rawHas(row.raw_data, 'fullName')
  );
}

/**
 * The single classification entry point. Returns null when NEITHER rule proves a kind —
 * unclassified is a real answer and must never be coerced to a guess.
 *
 * Mutual exclusivity is enforced here rather than assumed: a row satisfying both rules is a
 * contradiction in the data and is returned as null (unclassified) instead of being silently
 * assigned to whichever branch happens to run first.
 */
export function classifyContactKind(row: ClassifiableContact): ContactKind | null {
  const vendor = isVendorEntityPoc(row);
  const government = isGovernmentBuyerContact(row);
  if (vendor && government) return null;
  if (vendor) return CONTACT_KIND_VENDOR;
  if (government) return CONTACT_KIND_GOVERNMENT;
  return null;
}

/**
 * SQL predicates for the backfill and for reconciliation counts, kept beside the TS rules so the
 * two cannot drift. Any change here must change `isVendorEntityPoc` / `isGovernmentBuyerContact`
 * in the same edit — the unit tests assert the pair agree on real corpus shapes.
 */
export const CONTACT_KIND_SQL = {
  vendor:
    "raw_data ? 'uei' AND raw_data ? 'company' AND department_ind_agency IS NULL "
    + 'AND contact_email IS NULL AND solicitation_number IS NULL',
  government:
    "source_row_key ~ '^[0-9a-f]{32}::[0-9]+$' AND department_ind_agency IS NOT NULL "
    + "AND raw_data ? 'fullName'",
} as const;
