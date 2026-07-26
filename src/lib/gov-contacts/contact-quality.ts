/**
 * federal_contacts render/query guard — "is this contact card usable?"
 *
 * Root cause (2026-07-26, opportunity-map contacts-mode ghost cards): two
 * distinct data-quality holes in federal_contacts, found by measuring the
 * real table (181,097 rows):
 *
 * 1. ~82K "sam_entities_pocs" rows (contractor-side POCs from the SAM entity
 *    export) have NO email/phone/agency by design — SAM's entity export
 *    doesn't carry them for these roles. They DO have a name + title + the
 *    company (stored in `sub_tier`) + role. These are already structurally
 *    unreachable by the map/roster queries below (no `solicitation_number`,
 *    no `department_ind_agency`), so no extra filter is needed for THEM —
 *    but `isUsableContactCard` still won't call a name-only stub "usable"
 *    if a future path ever surfaces one without the org/company alongside.
 *
 * 2. ~3,912 rows (`AllSamContacts` + `sam_opportunities_pointOfContact`)
 *    carry a real email/agency/solicitation_number, so they ARE fully
 *    reachable everywhere — but `contact_fullname` is a literal SAM
 *    placeholder string like "Telephone: 7175503122" (SAM itself emits this
 *    when the real POC name is blank; there is no recoverable name in
 *    raw_data). Rendered as-is, the "name" on the card is a phone number —
 *    the literal symptom this fix targets. These must be filtered OUT
 *    before rendering; there is nothing to backfill (the source never had
 *    a real name for these rows).
 *
 * `isUsableContactName` / `isUsableContactCard` are the ONE place both bugs
 * are guarded — reused by the contacts-map buyers query, the federal-contacts
 * directory route, and the shared contact-roster lib (MCP + app), so a fix
 * here closes all three surfaces at once.
 */

// SAM's own "no real name" placeholder pattern: "Telephone: 7175503122",
// "Fax: 555-1234", etc. — a label + a run of digits, nothing else.
const PLACEHOLDER_NAME_RE = /^(telephone|phone|fax|tel)\s*:?\s*[\d().\-\s]{6,}$/i;

// A name that's ENTIRELY digits/punctuation (defensive — covers a bare phone
// number with no label prefix, should one ever slip through the importer).
const ALL_DIGITS_RE = /^[\d().\-\s+]{6,}$/;

/** True when contact_fullname is real prose (a person's name), not a phone-number placeholder. */
export function isUsableContactName(fullname: string | null | undefined): boolean {
  const name = (fullname || '').trim();
  if (!name) return false;
  if (PLACEHOLDER_NAME_RE.test(name)) return false;
  if (ALL_DIGITS_RE.test(name)) return false;
  return true;
}

/**
 * True when a federal_contacts row has enough real identity to render as a
 * card: a usable name AND at least one of (org/agency, a contactable field).
 * A row with only a name (or only a phone, or a name that's actually a
 * phone number) should be skipped rather than shown as a ghost card.
 */
export function isUsableContactCard(row: {
  contact_fullname?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  department_ind_agency?: string | null;
  sub_tier?: string | null;
  office?: string | null;
}): boolean {
  if (!isUsableContactName(row.contact_fullname)) return false;
  const hasOrg = !!(row.department_ind_agency || row.sub_tier || row.office);
  const hasContactable = !!(row.contact_email || row.contact_phone);
  return hasOrg || hasContactable;
}
