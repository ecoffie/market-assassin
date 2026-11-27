/**
 * Repository hygiene: tracked files must not carry private operational data (customer lists,
 * exports, rollback dumps, call transcripts). This repository is public.
 *
 * Two rules, enforced by tracked-private-data.unit.test.ts over `git ls-files` (so it blocks in the
 * pre-push gate and in CI's verify job):
 *   1. EMAIL DENSITY — a file may hold at most MAX_REAL_EMAILS distinct real-looking addresses.
 *      Synthetic/test domains, our own domains and public-official (.gov/.mil) contacts do not count.
 *   2. EXPORT-STYLE PATHS — working caches, export-named data files and stray root files are refused.
 *
 * Public resources that legitimately list organisational contacts are allowlisted below, each with a
 * reason. Private inputs belong in $MINDY_PRIVATE_DIR (scripts/lib/private-path.js), never the tree.
 */

export const MAX_REAL_EMAILS = 5;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

/** Domains that never count: synthetic fixtures, our own domains, public officials. */
const NON_COUNTING_DOMAIN_RE = new RegExp(
  [
    String.raw`(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$`,
    String.raw`^example\.test$`,
    String.raw`^[a-z]\.(com|co|org|net)$`,
    String.raw`^(co|corp|example-corp|customer|firm|domain|email|company|test|acme)\.(com|gov|org)$`,
    String.raw`(^|\.)(getmindy\.ai|govcongiants\.(com|org))$`,
    String.raw`^(users\.noreply\.github\.com|anthropic\.com|sentry\.io)$`,
    String.raw`\.(gov|mil)$`,
  ].join('|'),
  'i',
);

/** Distinct real-looking addresses in a text (lower-cased). */
export function realLookingEmails(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) {
    if (!NON_COUNTING_DOMAIN_RE.test(m[1])) out.add(m[0].toLowerCase());
  }
  return [...out];
}

/** Public resources that legitimately list organisational contacts (reason in each comment). */
export const EMAIL_DENSITY_ALLOWLIST: Array<{ prefix: string; reason: string }> = [
  { prefix: 'public/', reason: 'published pages and downloadable public resources' },
  { prefix: 'src/data/', reason: 'public contractor / government reference databases served by the app' },
  { prefix: 'data/imports/', reason: 'government point-of-contact imports from public sources' },
  { prefix: 'scripts/demo-rosters/', reason: 'labelled synthetic demo data' },
  { prefix: 'projects/public-sector-targets/MASTER-REGISTRY.csv', reason: 'public organisational contacts from published sources' },
  { prefix: 'projects/edc-mbda-partnerships/landscape-research-phase2.md', reason: 'public organisational contacts from published sources' },
  { prefix: 'src/lib/gov-contacts/sblo-refresh.unit.test.ts', reason: 'public small-business liaison contacts (published SBLO directory)' },
];

/**
 * Existing production allowlists that still carry addresses in code. Moving them to private
 * configuration is tracked separately; listed here so the check blocks any NEW file, and so these
 * cannot grow unnoticed (each entry is capped at its current count).
 */
export const KNOWN_EXCEPTIONS: Array<{ path: string; maxEmails: number }> = [
  { path: 'src/lib/mindy/campaign-exclusions.ts', maxEmails: 10 },
  { path: 'src/lib/mindy/advocate-accounts.ts', maxEmails: 6 },
  { path: 'src/lib/mindy/advocate-accounts.unit.test.ts', maxEmails: 8 },
  // The staff list moved here from src/lib/api-auth.ts (2026-11-24); same addresses, same cap.
  { path: 'src/lib/access/staff-role.ts', maxEmails: 6 },
  { path: 'src/app/api/admin/member-lookup/route.ts', maxEmails: 6 },
];

const ROOT_FILE_OK = new Set(['LICENSE', 'Makefile', 'Dockerfile', 'Procfile', 'CODEOWNERS']);
const EXPORT_NAME_RE = /(customer|subscriber|attendee|outreach|invitation|unmatched|founder-calls|paid_|member[s_-]?list|leads?[_-]|rollback_)/i;
const DATA_EXT_RE = /\.(csv|tsv|json|jsonl|txt|sql|xlsx?|ndjson)$/i;

export type Violation = { path: string; rule: 'email_density' | 'export_path' | 'stray_root_file' | 'known_exception_grew'; detail: string };

/** Path rules (no content needed). */
export function pathViolation(path: string): Violation | null {
  if (path.startsWith('tasks/cache/')) return { path, rule: 'export_path', detail: 'working cache directory' };
  if (!path.includes('/')) {
    if (/["'`]/.test(path) || (!path.includes('.') && !ROOT_FILE_OK.has(path))) {
      return { path, rule: 'stray_root_file', detail: 'unexpected root-level file' };
    }
  }
  const base = path.split('/').pop() || path;
  const allowlisted = EMAIL_DENSITY_ALLOWLIST.some((a) => path.startsWith(a.prefix));
  if (!allowlisted && DATA_EXT_RE.test(base) && EXPORT_NAME_RE.test(base) && !path.startsWith('supabase/migrations/')) {
    return { path, rule: 'export_path', detail: 'export-style data file name' };
  }
  return null;
}

/** Content rule for one file. */
export function contentViolation(path: string, text: string): Violation | null {
  if (EMAIL_DENSITY_ALLOWLIST.some((a) => path.startsWith(a.prefix))) return null;
  const n = realLookingEmails(text).length;
  const known = KNOWN_EXCEPTIONS.find((k) => k.path === path);
  if (known) return n > known.maxEmails ? { path, rule: 'known_exception_grew', detail: `${n} > ${known.maxEmails}` } : null;
  return n > MAX_REAL_EMAILS ? { path, rule: 'email_density', detail: `${n} real-looking addresses (max ${MAX_REAL_EMAILS})` } : null;
}
