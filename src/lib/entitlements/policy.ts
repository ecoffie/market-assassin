/**
 * R2 — the canonical entitlement POLICY. Pure, dependency-free, safe in any runtime.
 *
 *   verified identity → entitlement SOURCES → CAPABILITIES (the union of every source)
 *
 * SHADOW ONLY. Nothing in the product reads this module to decide access yet. R2 runs
 * it beside the existing gates and logs where the two disagree; R3 is the first step
 * that enforces it, and only after Eric reviews the disagreement report
 * (tasks/entitlement-r2-shadow-report-2026-10-04.md).
 *
 * Rulings this table encodes (do not re-derive; see tasks/mindy-entitlement-audit-
 * 2026-09-26.md §15–16 and tasks/commercial-corrections-2026-09-28.md):
 *   - FREE = DISCOVERY. PAID = EXECUTION (organize, execute, produce, automate).
 *   - Team ⊇ Pro. Team never sees "Upgrade to Pro".
 *   - A user may hold many sources at once. Capabilities are their UNION. Removing one
 *     source never removes a capability another source still grants.
 *   - Legacy standalone products (Market Assassin, Contractor Database, Recompete
 *     Tracker, Opportunity Hunter Pro, Content Reaper) are separate products. Owning one
 *     grants NO Mindy capability (Correction 1, 2026-09-28).
 *   - MCP credits are a balance/meter, never an entitlement.
 *   - Pursuit Briefs are RETIRED (Correction 3). There is no `pursuit_brief.*` capability.
 *   - Staff counts only from a VERIFIED identity (R1).
 *
 * LOCKED 2026-10-04 (Eric approved R2, tasks/entitlement-r2-shadow-report-2026-10-04.md):
 *   - D1: legacy-only owners frozen at 2026-10-04 → `legacy_mindy_grandfather`, which keeps
 *     exactly today's behavior (see GRANDFATHER_CAPS). New legacy owners are NOT added.
 *   - D2/D3: Free proposal drafts and pipeline rows that already exist stay readable /
 *     exportable (a data-access rule for R5, recorded on the capability, not a grant).
 *   - D6: membership = an ACTIVE qualifying $99 subscription observed in Stripe now —
 *     never the stale classification snapshot. past_due, $799/yr and Ongoing Coaching are
 *     observed but grant nothing until ruled.
 *   - D7: staff = Team capabilities (verified identity), excluded from revenue.
 *   - D8: advocates = Pro (comp), excluded from revenue.
 *
 * Adding a capability or a source? Add it HERE and nowhere else.
 */

// ── Auth / entitlement states (kept separate: logged in ≠ paid) ──────────────────────

export type AuthState = 'LOGGED_OUT' | 'LOGGED_IN';
export type EntitlementState = 'LOGGED_OUT' | 'FREE' | 'PRO' | 'TEAM';

const STATE_RANK: Record<EntitlementState, number> = { LOGGED_OUT: 0, FREE: 1, PRO: 2, TEAM: 3 };

// ── Sources ──────────────────────────────────────────────────────────────────────────

/**
 * A named, auditable reason a user holds (or doesn't hold) something.
 * `pro_unattributed` is honest: KV `briefings:` holds a bare `true` with no record of
 * WHY. R2 does not adjudicate those grants — it reports them so they can be attributed.
 */
export type EntitlementSource =
  | 'stripe_pro'          // classification: active Mindy subscription (subscription / 1_year)
  | 'stripe_team'         // user_profiles.access_team
  | 'lifetime_mindy'      // classification: lifetime Mindy purchase (incl. Mindy Teams lifetime, bundle lifetime)
  | 'founder'             // lifetime purchase whose products name Founders
  | 'membership'          // ACTIVE qualifying $99 membership, observed in Stripe by the reconciler (ruling 2026-10-03; app Pro only, no MCP credits)
  | 'membership_past_due' // qualifying membership in dunning — UNRULED, grants nothing until Eric rules
  | 'membership_unruled'  // $799/yr annual or Ongoing Coaching — UNRULED, grants nothing until Eric rules
  | 'legacy_mindy_grandfather' // FROZEN D1 cohort (2026-10-04): legacy-only owners keep exactly what they have today
  | 'manual_grant'        // an admin grant recorded in mi_admin_grants
  | 'pro_unattributed'    // a live Pro grant (KV briefings: / access_briefings) with no record of its origin
  | 'trial'               // trial_ends_at in the future while the trial program is open
  | 'staff'               // verified identity on an internal domain / list
  | 'advocate'            // advocate registry (comp Pro)
  | `legacy:${LegacyProduct}`
  | 'mcp_credit_balance'; // a positive MCP balance — a meter, grants nothing

export type LegacyProduct =
  | 'market_assassin_standard'
  | 'market_assassin_premium'
  | 'content_reaper'
  | 'opportunity_hunter_pro'
  | 'recompete_tracker'
  | 'contractor_database';

/** Sources that must never count as paid revenue / campaign audience. */
export const NON_REVENUE_SOURCES: ReadonlySet<EntitlementSource> = new Set(['staff', 'advocate', 'trial', 'legacy_mindy_grandfather']);

// ── Capabilities ─────────────────────────────────────────────────────────────────────

export type CapabilityCategory =
  | 'discover' | 'remember' | 'organize' | 'execute' | 'produce' | 'automate' | 'ai' | 'team';

export interface CapabilityPolicy {
  category: CapabilityCategory;
  /** The lowest entitlement state that holds this capability. */
  minState: EntitlementState;
  /** Where the audit locked it. */
  ruling: string;
  /** Existing-data protection a future gate must honor (R5). Not a capability grant. */
  grandfather?: string;
}

export const CAPABILITY_POLICY = {
  // DISCOVER — Free
  'map.browse':               { category: 'discover', minState: 'LOGGED_OUT', ruling: 'E5' },
  'horizons.view':            { category: 'discover', minState: 'LOGGED_OUT', ruling: 'E5' },
  'listing.detail':           { category: 'discover', minState: 'LOGGED_OUT', ruling: 'E5' },
  'incumbent.identity':       { category: 'discover', minState: 'LOGGED_OUT', ruling: 'E4' },
  'forecast.browse':          { category: 'discover', minState: 'LOGGED_OUT', ruling: 'E5' },
  'players.view':             { category: 'discover', minState: 'FREE', ruling: 'audit §16' },
  'contacts.listing':         { category: 'discover', minState: 'FREE', ruling: 'E6' },
  'win_probability.view':     { category: 'discover', minState: 'FREE', ruling: 'audit §16' },
  'market_research.standard': { category: 'discover', minState: 'FREE', ruling: 'E10' },
  'learn.discover':           { category: 'discover', minState: 'LOGGED_OUT', ruling: 'audit §8' },
  // REMEMBER — Free (sign-in)
  'save.bookmark':            { category: 'remember', minState: 'FREE', ruling: 'audit §16' },
  'save.track':               { category: 'remember', minState: 'FREE', ruling: 'E3' },
  'watch.create':             { category: 'remember', minState: 'FREE', ruling: 'E5' },
  'alerts.daily':             { category: 'remember', minState: 'FREE', ruling: 'E5 (free daily, permanent)' },
  'learn.track':              { category: 'remember', minState: 'FREE', ruling: 'audit §16' },
  // ORGANIZE — Paid
  'target_list.manage':       { category: 'organize', minState: 'PRO', ruling: 'audit §16' },
  'outreach.log':             { category: 'organize', minState: 'PRO', ruling: 'audit §16' },
  'pipeline.manage':          { category: 'organize', minState: 'PRO', ruling: 'E3',
                                grandfather: 'Existing Free rows stay readable; the Free rows already in `pursuing` keep read/access. Destroy nothing.' },
  'teaming.manage':           { category: 'organize', minState: 'PRO', ruling: 'E8' },
  'relationships.manage':     { category: 'organize', minState: 'PRO', ruling: 'E8' },
  'contacts.roster':          { category: 'organize', minState: 'PRO', ruling: 'E6 (instrument before gating)' },
  // EXECUTE — Paid
  'bid_decision.ai':          { category: 'execute', minState: 'PRO', ruling: 'audit §16' },
  'pricing_intel.view':       { category: 'execute', minState: 'PRO', ruling: 'audit §16' },
  'competitor.analyze':       { category: 'execute', minState: 'PRO', ruling: 'E4' },
  'incumbent.depth':          { category: 'execute', minState: 'PRO', ruling: 'E4' },
  'market_report.generate':   { category: 'execute', minState: 'PRO', ruling: 'audit §16' },
  'market_research.full':     { category: 'execute', minState: 'PRO', ruling: 'E10' },
  'market_narrative.generate':{ category: 'execute', minState: 'PRO', ruling: 'E10' },
  'forecast.export':          { category: 'execute', minState: 'PRO', ruling: 'E5' },
  // PRODUCE — Paid
  'proposal.build':           { category: 'produce', minState: 'PRO', ruling: 'E7',
                                grandfather: 'Existing Free drafts stay readable and exportable.' },
  'proposal.compliance':      { category: 'produce', minState: 'PRO', ruling: 'E7' },
  'proposal.export':          { category: 'produce', minState: 'PRO', ruling: 'E7',
                                grandfather: 'Export of drafts that already exist stays available.' },
  // AUTOMATE — Paid
  'briefings.ai':             { category: 'automate', minState: 'PRO', ruling: 'audit §16' },
  'briefings.weekly':         { category: 'automate', minState: 'PRO', ruling: 'audit §16' },
  'alerts.recompete':         { category: 'automate', minState: 'PRO', ruling: 'audit §16' },
  // AI
  'chat.ask':                 { category: 'ai', minState: 'PRO', ruling: 'audit §16' },
  'mcp.tools':                { category: 'ai', minState: 'FREE', ruling: 'E11 (credits are the meter)' },
  'mcp.playbook':             { category: 'ai', minState: 'PRO', ruling: 'E11' },
  // TEAM
  'workspace.share':          { category: 'team', minState: 'TEAM', ruling: 'E8/E13' },
  'seats.manage':             { category: 'team', minState: 'TEAM', ruling: 'E13' },
  'coach.clients':            { category: 'team', minState: 'TEAM', ruling: 'E13' },
} as const satisfies Record<string, CapabilityPolicy>;

export type Capability = keyof typeof CAPABILITY_POLICY;

export const ALL_CAPABILITIES = Object.keys(CAPABILITY_POLICY) as Capability[];

function capsAtOrBelow(state: EntitlementState): Capability[] {
  return ALL_CAPABILITIES.filter((c) => STATE_RANK[CAPABILITY_POLICY[c].minState] <= STATE_RANK[state]);
}

/**
 * What each SOURCE contributes. A source maps to a capability SET, not a tier label,
 * so a future source can grant a slice (none does today — the rulings are all Pro-or-
 * Team-shaped) and a legacy product can grant nothing at all.
 *
 * MEMBERSHIP: app Pro only. Its "no recurring MCP credits" ruling lives in the credit
 * cron; `mcp.monthly_credits` is a METER and deliberately not a capability here.
 */
const PRO_CAPS = capsAtOrBelow('PRO');
const TEAM_CAPS = capsAtOrBelow('TEAM');
const NONE: Capability[] = [];

/**
 * D1 grandfather (APPROVED 2026-10-04). The frozen cohort of legacy-only owners keeps
 * EXACTLY today's behavior and nothing more: `verifyMIAccess` counts their legacy keys as
 * "pro", so every verifyMIAccess-gated and ungated paid capability stays; the capabilities
 * `resolveAccess` already denies them (chat, briefings, MCP playbook) stay denied. Nothing
 * is added, nothing is taken. Team capabilities are never included.
 */
export const GRANDFATHER_EXCLUDED: ReadonlySet<Capability> = new Set<Capability>([
  'chat.ask', 'briefings.ai', 'briefings.weekly', 'alerts.recompete', 'mcp.playbook',
]);
const GRANDFATHER_CAPS = PRO_CAPS.filter((c) => !GRANDFATHER_EXCLUDED.has(c));

export function capabilitiesGrantedBy(source: EntitlementSource): readonly Capability[] {
  switch (source) {
    case 'stripe_team':
    case 'staff': // LOCKED 2026-10-04: staff = Team capabilities (verified identity only), non-revenue
      return TEAM_CAPS;
    case 'legacy_mindy_grandfather':
      return GRANDFATHER_CAPS;
    case 'membership_past_due':
    case 'membership_unruled':
      return NONE;
    case 'stripe_pro':
    case 'lifetime_mindy':
    case 'founder':
    case 'membership':
    case 'manual_grant':
    case 'pro_unattributed':
    case 'trial':
    case 'advocate':
      return PRO_CAPS;
    case 'mcp_credit_balance':
      return NONE;
    default:
      // legacy:<product> — legacy access lives in the legacy system (Correction 1).
      return NONE;
  }
}

/** The union of every source, plus the Free baseline any signed-in user holds. */
export function capabilitiesFor(auth: AuthState, sources: readonly EntitlementSource[]): Set<Capability> {
  const caps = new Set<Capability>(capsAtOrBelow(auth === 'LOGGED_IN' ? 'FREE' : 'LOGGED_OUT'));
  if (auth === 'LOGGED_OUT') return caps;
  for (const s of sources) for (const c of capabilitiesGrantedBy(s)) caps.add(c);
  return caps;
}

/** A display/report label only. Never gate on this — gate on a capability. */
export function entitlementStateFor(auth: AuthState, sources: readonly EntitlementSource[]): EntitlementState {
  if (auth === 'LOGGED_OUT') return 'LOGGED_OUT';
  const caps = capabilitiesFor(auth, sources);
  if (caps.has('workspace.share')) return 'TEAM';
  if (caps.has('target_list.manage')) return 'PRO';
  return 'FREE';
}

export interface CanonicalDecision {
  allow: boolean;
  /** The sources that grant this capability ([] when allowed by the Free baseline or denied). */
  grantedBy: EntitlementSource[];
  reason: string;
}

export function canonicalDecision(
  capability: Capability,
  auth: AuthState,
  sources: readonly EntitlementSource[],
): CanonicalDecision {
  const policy = CAPABILITY_POLICY[capability];
  const baseline = auth === 'LOGGED_IN' ? 'FREE' : 'LOGGED_OUT';
  if (STATE_RANK[policy.minState] <= STATE_RANK[baseline]) {
    return { allow: true, grantedBy: [], reason: `baseline:${baseline.toLowerCase()}` };
  }
  if (auth === 'LOGGED_OUT') return { allow: false, grantedBy: [], reason: 'sign_in_required' };
  const grantedBy = sources.filter((s) => capabilitiesGrantedBy(s).includes(capability));
  if (grantedBy.length > 0) return { allow: true, grantedBy, reason: `granted_by:${grantedBy.join('+')}` };
  return { allow: false, grantedBy: [], reason: `requires:${policy.minState.toLowerCase()}` };
}

/** Coarse category for logs/reports — no product or customer detail. */
export function sourceCategory(source: EntitlementSource): string {
  return source.startsWith('legacy:') ? 'legacy' : source;
}
