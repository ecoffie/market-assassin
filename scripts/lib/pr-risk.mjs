/**
 * Release-risk hint from a PR's changed paths (CLAUDE.md release rule 15: payments/Stripe, auth or
 * access control, production env vars / feature flags and migrations need independent review +
 * coordinator sequencing). A HINT for the reviewer, never an approval.
 */
export const RISK_RULES = [
  { level: 'RED', label: 'payments / Stripe', re: /(^|\/)(stripe|billing|checkout|payments?|webhooks?\/stripe)(\/|[-_.]|$)|stripe/i },
  { level: 'RED', label: 'auth / access control', re: /(^|\/)(auth|oauth|api-auth|admin-auth|access|entitlements?|session|mfa|rbac)(\/|[-_.]|$)/i },
  { level: 'RED', label: 'SQL / database migrations', re: /^(supabase\/)?migrations\/|\.sql$/i },
  { level: 'RED', label: 'customer data / deletion', re: /(^|\/)(vault|delete-[\w-]*user|deletion)(\/|[-_.]|$)/i },
  { level: 'YELLOW', label: 'env vars / feature flags', re: /(^|\/)(\.env[\w.]*|flags?\.(ts|js|mjs)|feature-flags?[\w./-]*|vercel\.json|next\.config\.[tj]s)$/i },
  { level: 'YELLOW', label: 'scheduled jobs (cron)', re: /^src\/app\/api\/cron\/|(^|\/)cron[\w-]*\.(ts|js|mjs)$|^vercel\.json$/i },
  { level: 'YELLOW', label: 'release / deploy tooling', re: /^\.githooks\/|^\.github\/workflows\/|^scripts\/(deploy|release|migrate)[\w-]*\./i },
];

const ORDER = { GREEN: 0, YELLOW: 1, RED: 2 };

/** { level: 'GREEN'|'YELLOW'|'RED', reasons: [{ level, label, files }] } */
export function riskHint(files) {
  const reasons = [];
  for (const rule of RISK_RULES) {
    const hits = files.filter((f) => rule.re.test(f));
    if (hits.length) reasons.push({ level: rule.level, label: rule.label, files: hits });
  }
  const level = reasons.reduce((lv, r) => (ORDER[r.level] > ORDER[lv] ? r.level : lv), 'GREEN');
  return { level, reasons };
}

/** Other open PRs whose changed files overlap this one's: [{ number, title, files }]. */
export function overlappingPrs(thisNumber, thisFiles, others) {
  const mine = new Set(thisFiles);
  return others
    .filter((o) => o.number !== thisNumber)
    .map((o) => ({ number: o.number, title: o.title, files: o.files.filter((f) => mine.has(f)) }))
    .filter((o) => o.files.length > 0)
    .sort((a, b) => b.files.length - a.files.length);
}
