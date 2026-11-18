/**
 * SBLO contact provenance — the shared vocabulary between the refresh importer
 * (scripts/import-sblo-refresh.ts → sblo-refresh.ts) and the serving path
 * (sblo-lookup.ts → MCP get_sblo_contact).
 *
 * Why this exists (Data Core PR 3, 2026-11-17): a 10-company sample checked against
 * each prime's own website found 7 of 9 reachable named contacts could no longer be
 * confirmed, and NONE of the 9 published the personal email we hold — official pages
 * now publish ROLE mailboxes (NGDSSmallBusiness@ngc.com, GA-ASI-Small-Business@…).
 * The personal-email field is the decaying part. So every contact field carries its
 * own status, date and source URL, and the serving path labels a value it cannot
 * trace to a verified source instead of presenting it as current.
 */

/** The four contact fields that carry field-level provenance. `portal` is stored as `supplierPortal`. */
export const SBLO_FIELDS = ['sbloName', 'email', 'phone', 'portal'] as const;
export type SbloField = (typeof SBLO_FIELDS)[number];

/** Storage key on a roster / prime-DB row for each provenance field. */
export const SBLO_FIELD_STORAGE: Record<SbloField, 'sbloName' | 'email' | 'phone' | 'supplierPortal'> = {
  sbloName: 'sbloName',
  email: 'email',
  phone: 'phone',
  portal: 'supplierPortal',
};

/**
 * Outcome of re-checking ONE field against the company's own published page.
 *   confirmed   — the page shows the value we hold
 *   changed     — the page shows a DIFFERENT value (must carry a sourceUrl)
 *   not_named   — the page no longer names anyone / shows no such field (value kept, marked stale)
 *   unreachable — the page could not be checked (403/5xx/gone) (value kept, marked stale)
 */
export const PROVENANCE_STATUSES = ['confirmed', 'changed', 'not_named', 'unreachable'] as const;
export type ProvenanceStatus = (typeof PROVENANCE_STATUSES)[number];

export interface FieldProvenance {
  status: ProvenanceStatus;
  /** YYYY-MM-DD the field was checked. */
  verifiedAt: string;
  sourceUrl: string | null;
  /** Set when status is not_named/unreachable and a value was kept: the date it stopped being confirmable. */
  staleSince?: string | null;
}

export interface FieldHistoryEntry {
  value: string;
  /** Provenance the value had while it was current (null = Jun-2026 snapshot, no field provenance). */
  provenance: FieldProvenance | null;
  /** YYYY-MM-DD it was replaced (the verifiedAt of the replacing check). */
  replacedAt: string;
  replacedBecause: 'changed' | 'role_mailbox_preferred';
}

export type EmailKind = 'role' | 'personal' | 'unknown';

/** Status of a personal email kept INTERNALLY after a role mailbox took the served `email` slot. */
export type PersonalEmailStatus = 'confirmed' | 'unverified' | 'stale';

/** Optional provenance fields a roster or prime-DB row may carry (all additive; legacy rows have none). */
export interface SbloProvenanceFields {
  provenance?: Partial<Record<SbloField, FieldProvenance>> | null;
  history?: Partial<Record<SbloField | 'title', FieldHistoryEntry[]>> | null;
  /** Explicit kind for the served email when the researcher recorded it. */
  emailKind?: EmailKind | null;
  /** A personal email kept internally (never served) after a role mailbox replaced it, or alongside one. */
  personalEmail?: string | null;
  personalEmailStatus?: PersonalEmailStatus | null;
}

// Long role words match as SUBSTRINGS of the separator-free local part
// ("NGDSSmallBusiness", "GA-ASI-Small-Business", "supplier_diversity").
const ROLE_SUBSTRINGS = [
  'smallbusiness', 'smallbiz', 'fedsmallbiz', 'sblo', 'osbp', 'supplier', 'diversity',
  'procurement', 'purch', 'subcontract', 'vendor', 'sourcing', 'supplychain',
  'socioeconomic', 'teaming', 'assessment',
];
// Short role words match only as a WHOLE token ("sb@", "mbx.osbp") — as substrings they hit surnames.
// ("rosales" must not read as "sales", "purcell" not as a purchasing desk).
const ROLE_TOKENS = new Set([
  'sb', 'sbo', 'sbp', 'mbx', 'contact', 'contracts', 'partners', 'mailbox',
  'info', 'sales', 'bids', 'connect', 'agencies',
]);

/**
 * Classify an email as a company ROLE mailbox, a PERSONAL address, or unknown.
 * Explicit kind wins; then role words; then the liaison's own name in the local part;
 * then a dotted first.last shape. Pure, deterministic — no network.
 */
export function classifyEmailKind(
  email: string | null | undefined,
  opts: { sbloName?: string | null; title?: string | null; explicit?: EmailKind | null } = {},
): EmailKind | null {
  const e = (email || '').trim();
  if (!e || !e.includes('@')) return null;
  if (opts.explicit === 'role' || opts.explicit === 'personal' || opts.explicit === 'unknown') return opts.explicit;
  if (/\bmailbox\b/i.test(opts.title || '')) return 'role';

  const local = e.split('@')[0].toLowerCase();
  const flat = local.replace(/[^a-z0-9]/g, '');
  const tokens = local.split(/[^a-z0-9]+/).filter(Boolean);
  if (ROLE_SUBSTRINGS.some((w) => flat.includes(w)) || tokens.some((t) => ROLE_TOKENS.has(t))) return 'role';

  const nameTokens = (opts.sbloName || '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3);
  if (nameTokens.some((t) => flat.includes(t))) return 'personal';
  if (/^[a-z]+([._-][a-z]\.?)?[._-][a-z][a-z-]+$/.test(local)) return 'personal';
  return 'unknown';
}

/** Serving-side verification status for one field. */
export type ServedFieldStatus = 'verified' | 'unverified' | 'stale';

export interface ServedFieldVerification {
  status: ServedFieldStatus | null; // null = the field is empty
  verified_at: string | null;
  source_url: string | null;
}

export interface SbloVerification {
  /**
   * field_provenance — the row carries per-field provenance from a refresh run.
   * snapshot — the row predates field provenance (the Jun-2026 research, or the older prime DB);
   *            nothing on it has been re-verified since, so every populated field is `unverified`.
   */
  basis: 'field_provenance' | 'snapshot';
  email_kind: EmailKind | null;
  /** Shortcut for fields.email.status — the field that decays fastest. */
  email_status: ServedFieldStatus | null;
  fields: Record<SbloField, ServedFieldVerification>;
}

function servedStatus(p: FieldProvenance | undefined, populated: boolean): ServedFieldStatus | null {
  if (!populated) return null;
  if (!p) return 'unverified';
  if ((p.status === 'confirmed' || p.status === 'changed') && p.sourceUrl) return 'verified';
  if (p.status === 'not_named' || p.status === 'unreachable') return 'stale';
  return 'unverified';
}

/**
 * Build the serving-side label for a row. A value is `verified` ONLY when its own field
 * provenance says confirmed/changed with a source URL. A snapshot row (no provenance) is
 * `unverified` — the Jun-2026 research date is reported as `verified_at`, not as a claim
 * that the value is still current.
 */
export function buildSbloVerification(
  row: SbloProvenanceFields & {
    sbloName?: string | null; email?: string | null; phone?: string | null;
    supplierPortal?: string | null; title?: string | null;
  },
  snapshotVerified: string | null,
): SbloVerification {
  const prov = row.provenance || null;
  const basis: SbloVerification['basis'] = prov && Object.keys(prov).length > 0 ? 'field_provenance' : 'snapshot';
  const fields = {} as Record<SbloField, ServedFieldVerification>;
  for (const f of SBLO_FIELDS) {
    const value = row[SBLO_FIELD_STORAGE[f]];
    const populated = typeof value === 'string' && value.trim() !== '';
    const p = prov?.[f];
    fields[f] = {
      status: servedStatus(p, populated),
      verified_at: populated ? (p?.verifiedAt ?? snapshotVerified ?? null) : null,
      source_url: populated ? (p?.sourceUrl ?? null) : null,
    };
  }
  return {
    basis,
    email_kind: classifyEmailKind(row.email, { sbloName: row.sbloName, title: row.title, explicit: row.emailKind }),
    email_status: fields.email.status,
    fields,
  };
}
