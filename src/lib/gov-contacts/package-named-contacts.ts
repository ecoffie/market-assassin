/**
 * Contacts named in the SOLICITATION PACKAGE itself.
 *
 * WHY (Poteto — Pursuit Dossier Truth, 2026-09-22): `build_pursuit_dossier`
 * sourced its people ONLY from `searchFederalContacts({agency, office})` — a
 * national agency directory. Measured on VA `36C24226Q0857` (demolition /
 * asbestos abatement, East Orange & Lyons NJ):
 *
 *   Michael.Spivack@va.gov is named 8x IN THE PACKAGE and appeared in NONE of
 *   the 10 returned contacts, which instead listed unrelated VA staff.
 *
 * The contracting officer written on the customer's own solicitation is the
 * single most useful person in the dossier, and the package was ALREADY being
 * fetched for the documents section. This reads that text — no new external
 * lookup — and lets the dossier rank named people above the generic directory.
 *
 * Deliberately conservative: an email is required. A name without a verifiable
 * address is a guess, and a wrong CO is worse than a missing one.
 */

export interface PackageNamedContact {
  contact_fullname: string | null;
  contact_title: string | null;
  contact_email: string;
  contact_phone: string | null;
  /** How this person was found — so the dossier can rank and explain. */
  source: 'solicitation_package';
  /** Mentions in the package; a proxy for how central they are to this buy. */
  mentions: number;
  /** The package routes quotes/questions to this address — the strongest signal. */
  submission_routed: boolean;
  /** HOW MANY times the package routes submissions here. See the ranking note. */
  submission_mentions: number;
}

/** Index of the nth (1-based) occurrence of `needle`, or -1. */
function nthIndexOf(hay: string, needle: string, n: number): number {
  let i = -1;
  for (let k = 0; k < n; k++) {
    i = hay.indexOf(needle, i + 1);
    if (i < 0) return -1;
  }
  return i;
}

/** Government addresses only — a vendor email in an attachment is not our CO. */
const GOV_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*\.(?:gov|mil)\b/g;

/**
 * Addresses that are org-level or procedural rather than a person on this buy.
 * Measured on the fixture: davisbaconinfo@dol.gov, EDProtests@va.gov etc. are
 * boilerplate in every construction package and would outrank the real CO.
 */
const NON_PERSON = /^(?:osdbu|info|help|support|protests?|edprotests|davisbacon\w*|bcwd-office|dba\.\w+|cisada\d*|no-?reply|donotreply|webmaster|admin)/i;

/** Roles worth surfacing, most authoritative first. */
const ROLE_PATTERNS: { title: string; re: RegExp }[] = [
  { title: 'Contracting Officer', re: /\bcontracting\s+officer\b/i },
  { title: 'Contract Specialist', re: /\bcontract(?:ing)?\s+specialist\b/i },
  { title: "Contracting Officer's Representative", re: /\bcontracting\s+officer'?s?\s+representative\b|\bCOR\b/i },
  { title: 'Point of Contact', re: /\bpoint\s+of\s+contact\b|\bPOC\b/i },
];

/** "Michael.Spivack@va.gov" → "Michael Spivack". Never invent beyond the local part. */
function nameFromEmail(email: string): string | null {
  const local = email.split('@')[0];
  if (!/[._]/.test(local)) return null; // a single token is not a confident full name
  const parts = local.split(/[._]+/).filter((p) => p.length > 1 && /^[A-Za-z]+$/.test(p));
  if (parts.length < 2) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/**
 * Is this address the one the customer must ACT on for this buy?
 *
 * Measured on 36C24226Q0857: ranking by stated role put Karmazyn and McIntosh
 * (both literally labelled "Contracting Officer") above Michael Spivack — but
 * they appear only inside a past-performance questionnaire TEMPLATE dated
 * January 2024, a stale attachment carried along with the package. Spivack is
 * the person quotes and questions actually go to:
 *   "all questions ... must be submitted in writing to Michael.Spivack@va.gov"
 *   "Quotes shall be emailed to Michael Spivack at Michael.Spivack@va.gov"
 * So the signal that matters is SUBMISSION CONTEXT, not the job title printed
 * nearest the address. A title makes someone plausible; being the address the
 * solicitation routes offers to makes them correct.
 */
const SUBMISSION_CONTEXT =
  /\b(?:quotes?|proposals?|offers?|bids?|questions?|inquiries|rfi|submit(?:ted|ssion)?|emailed?\s+to|send\s+to|directed\s+to)\b/i;

function isSubmissionRouted(text: string, at: number): boolean {
  return SUBMISSION_CONTEXT.test(text.slice(Math.max(0, at - 300), at + 120));
}

/** A phone number appearing near the address, normalized; null when not confident. */
function phoneNear(text: string, at: number): string | null {
  const window = text.slice(Math.max(0, at - 260), at + 260);
  const m = window.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b(?:\s*(?:x|ext\.?)\s*\d{1,6})?/i);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '');
  // 10 digits, or 11 starting with a US country code. Anything else is an
  // identifier that merely looks numeric.
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  return null;
}

/** The role stated nearest the address, if any. */
function titleNear(text: string, at: number): string | null {
  const window = text.slice(Math.max(0, at - 320), at + 320);
  for (const { title, re } of ROLE_PATTERNS) if (re.test(window)) return title;
  return null;
}

/**
 * Extract the people named in a solicitation package, most-mentioned first.
 * Returns [] for empty text — absence of names is not an error.
 */
export function extractPackageNamedContacts(packageText: string, limit = 5): PackageNamedContact[] {
  const text = packageText || '';
  if (text.length < 40) return [];

  const byEmail = new Map<string, PackageNamedContact>();
  for (const raw of text.match(GOV_EMAIL) ?? []) {
    const email = raw.trim();
    const local = email.split('@')[0];
    if (NON_PERSON.test(local)) continue;

    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.mentions += 1;
      // A later mention may be the one that routes submissions.
      const nth = nthIndexOf(text, email, existing.mentions);
      if (nth >= 0 && isSubmissionRouted(text, nth)) {
        existing.submission_routed = true;
        existing.submission_mentions += 1;
        existing.contact_title = existing.contact_title ?? titleNear(text, nth);
      }
      continue;
    }

    const at = text.indexOf(email);
    byEmail.set(key, {
      contact_fullname: nameFromEmail(email),
      contact_title: titleNear(text, at),
      contact_email: email,
      contact_phone: phoneNear(text, at),
      source: 'solicitation_package',
      mentions: 1,
      submission_routed: isSubmissionRouted(text, at),
      submission_mentions: isSubmissionRouted(text, at) ? 1 : 0,
    });
  }

  // Rank by HOW OFTEN the package routes submissions to the address, not by the
  // job title printed nearest it. Measured on 36C24226Q0857: Spivack is routed
  // TWICE ("all questions must be submitted in writing to…", "Quotes shall be
  // emailed to…") and carries no adjacent title, while McIntosh is routed once
  // inside a January-2024 questionnaire template and IS labelled "Contracting
  // Officer". Ranking on the title put the stale template contact first. The
  // address the live solicitation repeatedly routes offers to is the answer.
  const roleRank = (t: string | null) => {
    if (!t) return 9;
    const i = ROLE_PATTERNS.findIndex((r) => r.title === t);
    return i < 0 ? 9 : i;
  };
  return [...byEmail.values()]
    .sort(
      (a, b) =>
        b.submission_mentions - a.submission_mentions ||
        roleRank(a.contact_title) - roleRank(b.contact_title) ||
        b.mentions - a.mentions,
    )
    .slice(0, limit);
}

/** Directory rows that duplicate a package-named person, by email. */
export function dedupeAgainstPackage<T extends Record<string, unknown>>(
  directoryRows: T[],
  packageContacts: PackageNamedContact[],
): T[] {
  const seen = new Set(packageContacts.map((c) => c.contact_email.toLowerCase()));
  return directoryRows.filter((r) => {
    const e = String((r as { contact_email?: unknown }).contact_email ?? '').toLowerCase();
    return !e || !seen.has(e);
  });
}
