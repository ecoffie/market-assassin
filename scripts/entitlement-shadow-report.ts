/**
 * R2 — offline shadow run over the whole entitled population. READ-ONLY.
 *
 *   npx tsx scripts/entitlement-shadow-report.ts            → prints the aggregate report (counts only)
 *   npx tsx scripts/entitlement-shadow-report.ts --private <dir>
 *        → also writes per-account detail (emails) to <dir>/r2-shadow-accounts.json.
 *          <dir> must be an UNTRACKED path (e.g. .claude/auth-r2); this repo is public.
 *
 * For every account that holds ANY entitlement source (plus every account that has USED
 * an ungated paid surface), it computes:
 *   CURRENT   — exactly what each production gate decides today (the same helpers, called
 *               the way the routes call them: verifyMIAccess without identityVerified,
 *               resolveAccess, or no gate at all);
 *   CANONICAL — src/lib/entitlements/policy.ts over the sources resolved by sources.ts
 *               (identityVerified=true: every gated route has a verified identity since R1).
 * Free users with no source and no usage are not enumerated: for them CURRENT and
 * CANONICAL are identical by construction on every gated surface (both Free).
 *
 * Writes nothing to any store.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess, getStaffRole, INTERNAL_TEAM_EMAILS } from '../src/lib/api-auth';
import { resolveAccess } from '../src/lib/access/resolve-access';
import { resolveEntitlementSources } from '../src/lib/entitlements/sources';
import {
  canonicalDecision, entitlementStateFor, sourceCategory, type Capability, type EntitlementSource,
} from '../src/lib/entitlements/policy';
import { ADVOCATE_ACCOUNTS } from '../src/lib/mindy/advocate-accounts';
import Stripe from 'stripe';
import { readFileSync } from 'fs';
import { classifyMembershipSubs, fetchMembershipSubs } from '../src/lib/entitlements/membership-reconciler';
import { selectGrandfatherCohort } from '../src/lib/entitlements/grandfather-cohort';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const privIdx = process.argv.indexOf('--private');
const PRIVATE_DIR = privIdx > 0 ? process.argv[privIdx + 1] : null;
/**
 * --preview-observations <frozen-snapshot.json>: before the migration exists, build the
 * shadow-evidence observations in memory (live Stripe memberships + the frozen D1 cohort)
 * instead of reading entitlement_source_observations. Read-only either way.
 */
const prevIdx = process.argv.indexOf('--preview-observations');
const PREVIEW_SNAPSHOT = prevIdx > 0 ? process.argv[prevIdx + 1] : null;

type Helper = 'verify' | 'resolve' | 'verify_team' | 'none';
/** Every production surface R2 shadows, with the helper its gate uses today. */
const SURFACES: Array<{ route: string; capability: Capability; helper: Helper; usage?: string }> = [
  { route: 'app/target-list POST (+auto-setup, target-events, target-enrichment, discover-events)', capability: 'target_list.manage', helper: 'verify', usage: 'target_list' },
  { route: 'app/target-outreach POST', capability: 'outreach.log', helper: 'verify', usage: 'outreach' },
  { route: 'app/pricing-intel GET', capability: 'pricing_intel.view', helper: 'verify' },
  { route: 'app/competitor-awards GET', capability: 'competitor.analyze', helper: 'verify' },
  { route: 'app/market-narrative POST', capability: 'market_narrative.generate', helper: 'verify' },
  { route: 'app/market-report POST', capability: 'market_report.generate', helper: 'verify', usage: 'market_reports' },
  { route: 'analyst/bid-no-bid POST', capability: 'bid_decision.ai', helper: 'verify' },
  { route: 'market research full (dossier, TMR, overview, generate-all)', capability: 'market_research.full', helper: 'verify' },
  { route: 'app/chat, chat-sessions, rag-doc', capability: 'chat.ask', helper: 'resolve' },
  { route: 'briefings/latest, briefings/verify', capability: 'briefings.ai', helper: 'resolve' },
  { route: 'mcp get_winning_playbook (tier gate)', capability: 'mcp.playbook', helper: 'resolve' },
  { route: 'app/team/upgrade POST', capability: 'workspace.share', helper: 'verify_team' },
  { route: 'app/workspace POST (invite)', capability: 'workspace.share', helper: 'none', usage: 'workspace_invites' },
  { route: 'pipeline POST/PATCH (stage beyond tracking)', capability: 'pipeline.manage', helper: 'none', usage: 'pipeline_managed' },
  { route: 'app/proposal/draft, draft-all', capability: 'proposal.build', helper: 'none', usage: 'proposal_drafts' },
  { route: 'app/proposal/compliance', capability: 'proposal.compliance', helper: 'none' },
  { route: 'app/proposal/export', capability: 'proposal.export', helper: 'none' },
  { route: 'teaming POST', capability: 'teaming.manage', helper: 'none', usage: 'teaming' },
  { route: 'app/relationships POST', capability: 'relationships.manage', helper: 'none', usage: 'relationships' },
];

async function fetchAll<T>(table: string, select: string, apply?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select).range(from, from + 999);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function scanKeys(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | number = 0;
  do {
    const [c, keys]: [string | number, string[]] = await kv.scan(cursor, { match: `${prefix}:*@*`, count: 1000 });
    cursor = c;
    out.push(...(keys as string[]).map((k) => k.slice(prefix.length + 1).toLowerCase()));
  } while (String(cursor) !== '0');
  return out;
}

const norm = (e: unknown) => String(e || '').toLowerCase().trim();

async function usageByEmail(): Promise<Record<string, Map<string, number>>> {
  const tally = (rows: Array<Record<string, unknown>>, col: string) => {
    const m = new Map<string, number>();
    for (const r of rows) { const e = norm(r[col]); if (e) m.set(e, (m.get(e) || 0) + 1); }
    return m;
  };
  const [tl, out, pipe, drafts, team, rel, inv, reports] = await Promise.all([
    fetchAll<any>('user_target_list', 'user_email'),
    fetchAll<any>('user_target_outreach', 'user_email'),
    fetchAll<any>('user_pipeline', 'user_email, stage', (q) => q.not('stage', 'in', '(tracking,archived)')),
    fetchAll<any>('user_generated_archive', 'user_email', (q) => q.in('content_type', ['proposal_section', 'cap_statement'])),
    fetchAll<any>('user_teaming_partners', 'user_email'),
    fetchAll<any>('mi_beta_contacts', 'user_email'),
    fetchAll<any>('mi_beta_team_members', 'invited_by', (q) => q.not('invited_by', 'is', null)),
    fetchAll<any>('market_reports', 'owner_email'),
  ]);
  return {
    target_list: tally(tl, 'user_email'),
    outreach: tally(out, 'user_email'),
    pipeline_managed: tally(pipe, 'user_email'),
    proposal_drafts: tally(drafts, 'user_email'),
    teaming: tally(team, 'user_email'),
    relationships: tally(rel, 'user_email'),
    workspace_invites: tally(inv, 'invited_by'),
    market_reports: tally(reports, 'owner_email'),
  };
}

const CLS_PAID = new Set<string>();
async function population(usage: Record<string, Map<string, number>>): Promise<Set<string>> {
  const emails = new Set<string>();
  for (const p of ['briefings', 'ma', 'contentgen', 'ospro', 'recompete', 'dbaccess']) {
    for (const e of await scanKeys(p)) emails.add(e);
  }
  const nowIso = new Date().toISOString();
  const profiles = await fetchAll<any>('user_profiles', 'email, access_briefings, access_team, trial_ends_at',
    (q) => q.or(`access_briefings.eq.true,access_team.eq.true,trial_ends_at.gte.${nowIso}`));
  for (const r of profiles) emails.add(norm(r.email));
  const notif = await fetchAll<any>('user_notification_settings', 'user_email', (q) => q.gte('trial_ends_at', nowIso));
  for (const r of notif) emails.add(norm(r.user_email));
  const cls = await fetchAll<any>('customer_classifications', 'email, briefings_access, has_active_subscription',
    (q) => q.or('briefings_access.in.(lifetime,subscription,1_year),has_active_subscription.eq.true'));
  for (const r of cls) {
    emails.add(norm(r.email));
    if (['lifetime', 'subscription', '1_year'].includes(r.briefings_access)) CLS_PAID.add(norm(r.email));
  }
  const grants = await fetchAll<any>('mi_admin_grants', 'target_email');
  for (const r of grants) emails.add(norm(r.target_email));
  for (const a of ADVOCATE_ACCOUNTS) emails.add(norm(a.email));
  for (const e of INTERNAL_TEAM_EMAILS) emails.add(norm(e));
  const staffProfiles = await fetchAll<any>('user_profiles', 'email',
    (q) => q.or('email.ilike.%@govcongiants.com,email.ilike.%@govconedu.com,email.ilike.%@getmindy.ai'));
  for (const r of staffProfiles) emails.add(norm(r.email));
  for (const m of Object.values(usage)) for (const e of m.keys()) emails.add(e);
  emails.delete('');
  return emails;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

interface Account {
  email: string;
  verifyTier: string;
  resolveLevel: string;
  resolveSource: string;
  sources: EntitlementSource[];
  complete: boolean;
  failures: string[];
  canonicalState: string;
  staff: boolean;
}

async function previewObservations(): Promise<Map<string, Array<{ source: string; status: string }>> | null> {
  if (!PREVIEW_SNAPSHOT) return null;
  const map = new Map<string, Array<{ source: string; status: string }>>();
  const add = (e: string, o: { source: string; status: string }) => map.set(e, [...(map.get(e) || []), o]);
  const { observations } = classifyMembershipSubs(await fetchMembershipSubs(new Stripe(process.env.STRIPE_SECRET_KEY!)));
  for (const o of observations) add(o.email, { source: o.source, status: o.status });
  const snap = JSON.parse(readFileSync(PREVIEW_SNAPSHOT, 'utf8'));
  for (const e of selectGrandfatherCohort(snap.accounts)) add(e, { source: 'legacy_mindy_grandfather', status: 'active' });
  return map;
}

async function main() {
  const usage = await usageByEmail();
  const preview = await previewObservations();
  const pop = await population(usage);
  if (preview) for (const e of preview.keys()) pop.add(e);
  const emails = [...pop].sort();
  console.error(`[r2] population: ${emails.length} accounts`);

  const accounts = await pool(emails, 6, async (email): Promise<Account> => {
    const [v, r, s] = await Promise.all([
      verifyMIAccess(email),
      resolveAccess(email),
      resolveEntitlementSources(email, { identityVerified: true, ...(preview ? { observations: preview.get(email) || [] } : {}) }),
    ]);
    return {
      email, verifyTier: v.tier, resolveLevel: r.level, resolveSource: r.source,
      sources: s.sources, complete: s.complete, failures: s.failures,
      canonicalState: entitlementStateFor('LOGGED_IN', s.sources),
      staff: getStaffRole(email) !== 'none',
    };
  });

  const incomplete = accounts.filter((a) => !a.complete).length;

  // Disagreements, aggregated by surface × direction × source signature.
  type Row = { route: string; capability: Capability; current: string; canonical: string; signature: string; accounts: number; usingIt: number; paying: number };
  const agg = new Map<string, Row>();
  const detail: Array<Record<string, unknown>> = [];
  for (const s of SURFACES) {
    const used = s.usage ? usage[s.usage] : undefined;
    for (const a of accounts) {
      if (!a.complete) continue;
      const current =
        s.helper === 'verify' ? a.verifyTier !== 'free' && a.verifyTier !== 'none'
        : s.helper === 'resolve' ? a.resolveLevel === 'pro'
        : s.helper === 'verify_team' ? a.verifyTier === 'team' || a.verifyTier === 'enterprise'
        : true; // ungated: any signed-in account
      const canon = canonicalDecision(s.capability, 'LOGGED_IN', a.sources).allow;
      if (current === canon) continue;
      // An ungated surface disagrees for EVERY Free account. Count only accounts that hold a
      // source or have actually used the surface — the rest are the whole Free population.
      const n = used?.get(a.email) || 0;
      if (s.helper === 'none' && a.sources.length === 0 && n === 0) continue;
      const signature = [...new Set(a.sources.map(sourceCategory))].sort().join('+') || '(no source)';
      const paying = a.sources.some((x) => !['mcp_credit_balance', 'staff', 'advocate', 'trial'].includes(x));
      const key = `${s.route}|${current}|${canon}|${signature}`;
      const row = agg.get(key) || { route: s.route, capability: s.capability, current: current ? 'ALLOW' : 'DENY', canonical: canon ? 'ALLOW' : 'DENY', signature, accounts: 0, usingIt: 0, paying: 0 };
      row.accounts++; if (n > 0) row.usingIt++; if (paying) row.paying++;
      agg.set(key, row);
      detail.push({ email: a.email, route: s.route, capability: s.capability, current, canonical: canon, sources: a.sources, usage_rows: n });
    }
  }

  // Population summary by canonical state × source signature.
  const bySig = new Map<string, number>();
  for (const a of accounts) {
    const k = `${a.canonicalState} | ${[...new Set(a.sources.map(sourceCategory))].sort().join('+') || '(no source)'} | verify=${a.verifyTier} resolve=${a.resolveLevel}`;
    bySig.set(k, (bySig.get(k) || 0) + 1);
  }
  const srcCount = new Map<string, number>();
  for (const a of accounts) for (const s of new Set(a.sources)) srcCount.set(s, (srcCount.get(s) || 0) + 1);

  const result = {
    generated_at: new Date().toISOString(),
    population: accounts.length,
    resolver_incomplete: incomplete,
    trial_program_open: !['off', 'false', '0', 'no'].includes((process.env.MINDY_TRIAL_OPEN || '').trim().toLowerCase()),
    sources: Object.fromEntries([...srcCount].sort((a, b) => b[1] - a[1])),
    states: Object.fromEntries([...bySig].sort((a, b) => b[1] - a[1])),
    resolver_failures: Object.fromEntries(
      [...accounts.flatMap((a) => a.failures).reduce((m, f) => m.set(f, (m.get(f) || 0) + 1), new Map<string, number>())]),
    classification_paid_without_live_grant: accounts.filter((a) => CLS_PAID.has(a.email)
      && !a.sources.some((x) => ['stripe_pro', 'lifetime_mindy', 'founder', 'pro_unattributed', 'manual_grant', 'membership', 'stripe_team'].includes(x))).length,
    usage_accounts: Object.fromEntries(Object.entries(usage).map(([k, m]) => [k, m.size])),
    disagreements: [...agg.values()].sort((a, b) => a.route.localeCompare(b.route) || b.accounts - a.accounts),
  };
  console.log(JSON.stringify(result, null, 2));

  if (PRIVATE_DIR) {
    mkdirSync(PRIVATE_DIR, { recursive: true });
    writeFileSync(join(PRIVATE_DIR, 'r2-shadow-accounts.json'), JSON.stringify({ generated_at: result.generated_at, accounts, detail }, null, 2));
    console.error(`[r2] private detail → ${join(PRIVATE_DIR, 'r2-shadow-accounts.json')}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
