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

// ── PLACEHOLDER SHAPES ──────────────────────────────────────────────────────
//
// Every pattern below is an EXACT, WHOLE-STRING or WHOLE-PREFIX label proven present in the
// corpus (measured 2026-09-15 over 205,354 government rows). Deliberately NOT substring rules:
// "contains fax" / "contains contract" / "contains officer" would suppress real people —
// e.g. a contracting officer legitimately named in the title field, or a surname containing
// a matched fragment. Bounded patterns only.

// SAM's "no real name" placeholder: a communication label plus a run of digits and nothing
// else — "Telephone: 7175503122", "Facsimile: 0000000000".
//
// `facsimile` was MISSING until 2026-09-15 and 26 rows rendered a fax number as a buyer's name.
const PLACEHOLDER_NAME_RE = /^(telephone|phone|fax|tel|facsimile)\s*:?\s*[\d().\-\s+]{6,}$/i;

// The same defect with an EMAIL payload instead of digits:
// "ELECTRONIC MAIL: AUSTIN.SHATTO@DLA.MIL" — 873 rows, every one an address, never a person.
// Matched as a whole PREFIX label, so a person whose name merely contains "mail" is unaffected.
const EMAIL_LABEL_NAME_RE = /^electronic\s*mail\s*:/i;

// A name that's ENTIRELY digits/punctuation (defensive — covers a bare phone
// number with no label prefix, should one ever slip through the importer).
const ALL_DIGITS_RE = /^[\d().\-\s+]{6,}$/;

/**
 * Bare role/office labels that SAM emits in the name field instead of a person.
 *
 * EXACT whole-string matches only, and every entry was enumerated from the live corpus
 * (379 rows). A frequency heuristic was tried first and REJECTED: ranking name values by
 * "appears under >=3 distinct emails" surfaces mostly REAL people (Jorge Morales, Kelly Palmer,
 * Randy Wentworth — staff who legitimately appear under several addresses), so multiplicity
 * cannot define this set. Only exact equality is defensible.
 *
 * Add to this list only from measured evidence, never by guessing a plausible label.
 */
const BARE_ROLE_LABELS = new Set([
  'CONTRACTING OFFICER',      // 146 rows
  'BAA COORDINATOR',          //  68
  'CONTRACT SPECIALIST',      //  67
  'PROCUREMENT TEAM',         //  31
  'PROCUREMENT',              //  30
  'PURCHASING',               //  27
  'CONTRACT OFFICER',         //   5
  'CONTRACTING OFFICE',       //   4
  'POC',                      //   1
]);

/**
 * PostgREST `ilike` prefixes for the labelled placeholder shapes.
 *
 * These exist so a QUERY can exclude placeholder rows before `count`, keeping an "N of M"
 * label honest rather than filtering only in JS after the page was already counted. This list
 * was hand-copied into FOUR route files and drifted from the regex above; it is now exported
 * from the one module that owns the decision. Use `placeholderNameFilter()` — never retype it.
 */
export const PLACEHOLDER_NAME_PREFIXES = [
  'telephone:', 'phone:', 'fax:', 'tel:', 'facsimile:', 'electronic mail:',
] as const;

/**
 * Apply the placeholder-name exclusions to a PostgREST query builder.
 *
 * Typed structurally rather than against a Supabase generic so every caller (routes, libs,
 * MCP) can share it without importing the client's type parameters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function placeholderNameFilter<T extends { not: (c: string, op: string, v: any) => T }>(q: T): T {
  let out = q;
  for (const p of PLACEHOLDER_NAME_PREFIXES) out = out.not('contact_fullname', 'ilike', `${p}%`);
  return out;
}

/**
 * Remove an embedded email address WITHOUT eating a surname fused to the domain.
 *
 * SAM writes both shapes. "Tamara Feist-Hatfield@va.gov" is a NAME with the domain stuck to
 * it — the local part IS the surname. "alicia.l.wargo.civ@us.navy.mil" is a real address whose
 * local part is a dotted machine token. Deleting the whole match indiscriminately turned the
 * first into "Tamara", destroying a real person's surname (caught by running this over the
 * live corpus, not by a unit test).
 *
 * So: the domain always goes; the local part survives unless it is dotted, which is what
 * distinguishes an address local part from a human surname in this corpus.
 */
function stripAddress(v: string): string {
  return v.replace(/([^\s@]*)@[^\s]+/g, (_m, local: string) => (local.includes('.') ? ' ' : local));
}

function collapse(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

/** True when contact_fullname is real prose (a person's name), not a placeholder or a role label. */
export function isUsableContactName(fullname: string | null | undefined): boolean {
  const name = (fullname || '').trim();
  if (!name) return false;
  if (PLACEHOLDER_NAME_RE.test(name)) return false;
  if (EMAIL_LABEL_NAME_RE.test(name)) return false;
  if (ALL_DIGITS_RE.test(name)) return false;
  if (BARE_ROLE_LABELS.has(collapse(name).toUpperCase())) return false;
  return true;
}

/**
 * The name to SHOW, with SAM's contact-data pollution stripped — or null when nothing
 * person-like survives.
 *
 * ⚠️ PRESENTATION ONLY. The raw `contact_fullname` observation is never rewritten; it stays
 * intact for provenance and for the person-identity work that will consume it later.
 *
 * SAM frequently concatenates the phone/DSN/email onto the name. Measured 2026-09-15:
 * 25,731 government rows (12.8%) end in a phone number — "Stephen Weaver6142923131",
 * "Jennifer Payne614-692-1629", "Natalya RadykDSN312-850-4033" — and 1,776 embed an address.
 * Those rendered verbatim as the buyer's name.
 *
 * Recovery is safe here, and that was MEASURED rather than assumed: stripping a trailing digit
 * run changes 25,731 rows, and ZERO names in the corpus end in a single glued digit, so no
 * numeric name-disambiguator can be destroyed. Only 6 rows reduce to nothing, and those are
 * suppressed rather than shown blank.
 *
 * This logic previously existed ONLY inside the MCP market-report tool, so that one surface
 * cleaned names while every other surface showed the raw pollution.
 */
export function displayContactName(fullname: string | null | undefined): string | null {
  const raw = (fullname || '').trim();
  // Reject placeholders on the RAW value first — cleaning "Telephone: 555..." would otherwise
  // leave a bare "Telephone:" that no longer matches the placeholder shape.
  if (!isUsableContactName(raw)) return null;

  // SAM's structured contact block: "<NAME>, <OFFICE>, PHONE (215)737-0543, EMAIL x@y.mil"
  // (154 rows, one consistent shape). Cut at the first contact KEYWORD after a comma — a
  // whole-token match, so a surname like "EMAILY" is untouched by the \b.
  const blockCut = raw.replace(/,\s*(PHONE|EMAIL|DSN|FAX|COMM)\b.*$/i, '');
  const hadBlock = blockCut !== raw;

  // The trailing-phone strip is SKIPPED when the block cut already fired: what remains there
  // is "<NAME>, <OFFICE CODE>", and the code's numeric suffix is part of the office, not a
  // phone number — stripping it turned "CASEY STOCK, APAC.40" into "CASEY STOCK, APAC".
  const stripped = hadBlock
    ? stripAddress(blockCut).replace(/[\r\n]+/g, ' ')
    : stripAddress(blockCut)                             // an embedded address
        .replace(/[\r\n]+/g, ' ')                        // "name\r\nphone\r\nemail"
        .replace(/DSN[\s:().\-]*\d[\d\s().\-]*$/i, ' ')   // "RadykDSN312-850-4033" (often unspaced)
        .replace(/[+]?\d[\d\s().+\-]*$/, ' ');           // a trailing phone run, leading "+1" included

  // Trailing punctuation is trimmed ONLY when a strip actually happened, so the residue of a
  // removed phone number goes ("Angela Haden(445)737-4366" -> "Angela Haden(" -> "Angela Haden")
  // while a legitimate parenthetical survives intact. Measured: an unconditional trim turned
  // "HYONTONG YANG (Rio)" into "HYONTONG YANG (Rio" — damaging a real name to tidy a fake one.
  const cleaned = collapse(
    stripped === raw ? stripped : stripped.replace(/[\s(),.:;/+\-]+$/, ' '),
  );

  // Re-check: the cleaned value must still be a usable name, not an empty string or a label
  // the pollution was hiding.
  if (!isUsableContactName(cleaned)) return null;
  return cleaned;
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
