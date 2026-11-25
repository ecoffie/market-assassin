/**
 * Daily cap on in-depth (research-mode) answers per customer (Eric, approved 2026-11-25).
 *
 * - Plan resolution from the existing sources: staff role, the app tier (verifyMIAccess: pro / team / enterprise),
 *   resolveAccess (source stripe / lifetime / trial / free) and a live MCP subscription (mcp_credit_ledger grant).
 *   A user holding several plans gets the HIGHEST cap. Staff and the internal team are uncapped.
 * - Caps live in config: ASK_MINDY_RESEARCH_CAPS (JSON) overrides the defaults below, including per-account caps
 *   ({"accounts": {"someone@x.com": 40}}), so numbers change without a logic deploy.
 * - Counting: research-mode turns with at least one tool call, from the stored traces (mindy_chat_messages.trace),
 *   per UTC day. No new table.
 * - At the cap the turn runs on the standard engine and the answer opens with one plain line (never a silent switch).
 * - Billing unchanged: no credits are debited.
 */
import { subscriptionPlan, SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';
import { tierAtLeast } from '@/lib/access/tier-rank';

export type CapPlan = 'free' | 'trial' | 'pro_lifetime' | 'pro_monthly' | 'team' | 'mcp_entry' | 'mcp_mid' | 'mcp_growth' | 'mcp_agency' | 'enterprise';

export const DEFAULT_RESEARCH_CAPS: Readonly<Record<CapPlan, number>> = {
  free: 2,
  trial: 2,
  pro_lifetime: 3,
  pro_monthly: 10,
  team: 10,
  mcp_entry: 5,
  mcp_mid: 15,
  mcp_growth: 25,
  // Not in the approved table: the agency plan sits above growth, so it gets at least growth's cap.
  mcp_agency: 25,
  // Enterprise / custom: per contract (accounts override); default to Team.
  enterprise: 10,
};

export const PLAN_LABEL: Readonly<Record<CapPlan, string>> = {
  free: 'Free', trial: 'Trial', pro_lifetime: 'Pro lifetime', pro_monthly: 'Pro', team: 'Team',
  mcp_entry: 'MCP Entry', mcp_mid: 'MCP Mid', mcp_growth: 'MCP Growth', mcp_agency: 'MCP Agency', enterprise: 'Enterprise',
};

/**
 * The next plan up named in the notice. App plans move to Pro, then to the MCP plans with more research; the top MCP
 * plans, Enterprise and per-account caps name none. Shown only when the next plan's cap is higher.
 */
export const NEXT_PLAN: Readonly<Partial<Record<CapPlan, CapPlan>>> = {
  free: 'pro_monthly', trial: 'pro_monthly', pro_lifetime: 'pro_monthly', pro_monthly: 'mcp_mid', team: 'mcp_mid',
  mcp_entry: 'mcp_mid', mcp_mid: 'mcp_growth',
};

export interface CapsConfig { caps: Record<CapPlan, number>; accounts: Record<string, number> }

/** Defaults merged with ASK_MINDY_RESEARCH_CAPS; an unreadable or invalid override is ignored, never zero. */
export function researchCapsConfig(env: Record<string, string | undefined> = process.env): CapsConfig {
  const caps: Record<CapPlan, number> = { ...DEFAULT_RESEARCH_CAPS };
  const accounts: Record<string, number> = {};
  const raw = env.ASK_MINDY_RESEARCH_CAPS;
  if (raw) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      for (const k of Object.keys(caps) as CapPlan[]) {
        const v = j[k];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) caps[k] = Math.floor(v);
      }
      const acc = j.accounts as Record<string, unknown> | undefined;
      if (acc && typeof acc === 'object') {
        for (const [e, v] of Object.entries(acc)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) accounts[e.trim().toLowerCase()] = Math.floor(v);
      }
    } catch {
      console.error('[research-caps] ASK_MINDY_RESEARCH_CAPS is not valid JSON; using defaults');
    }
  }
  return { caps, accounts };
}

export interface PlanFacts {
  staff: boolean;
  /** verifyMIAccess tier. */
  appTier: 'none' | 'pro' | 'team' | 'enterprise';
  /** resolveAccess. */
  access: { level: 'pro' | 'free'; source: 'stripe' | 'lifetime' | 'trial' | 'free' };
  /** Live MCP subscription plan id (entry / mid / growth / agency), or null. */
  mcpPlan: string | null;
}

/** Every plan the facts establish (a user can hold several). */
export function plansFor(f: PlanFacts): CapPlan[] {
  const out = new Set<CapPlan>();
  // Hierarchy, never exact matches (tier-rank.ts): a higher app tier always carries the lower tiers' caps too.
  if (tierAtLeast(f.appTier, 'team')) out.add('team');
  if (tierAtLeast(f.appTier, 'enterprise')) out.add('enterprise');
  if (f.access.source === 'lifetime') out.add('pro_lifetime');
  if (f.access.source === 'stripe' && f.access.level === 'pro') out.add('pro_monthly');
  if (tierAtLeast(f.appTier, 'pro') && f.access.source !== 'lifetime' && f.access.source !== 'trial') out.add('pro_monthly');
  if (f.access.source === 'trial') out.add('trial');
  const mcp = f.mcpPlan ? `mcp_${f.mcpPlan}` : null;
  if (mcp && mcp in DEFAULT_RESEARCH_CAPS) out.add(mcp as CapPlan);
  if (!out.size) out.add('free');
  return [...out];
}

export interface CapDecision {
  /** null = uncapped (staff / internal team). */
  cap: number | null;
  plan: CapPlan | 'staff' | 'account';
  used: number | null;
  allowed: boolean;
  /** The plain line that opens a capped (standard) answer. */
  notice: string | null;
}

/** The highest cap among the user's plans; an account override wins over plans. */
export function capFor(email: string, f: PlanFacts, cfg: CapsConfig): { cap: number | null; plan: CapDecision['plan'] } {
  if (f.staff) return { cap: null, plan: 'staff' };
  const acct = cfg.accounts[email.trim().toLowerCase()];
  if (acct !== undefined) return { cap: acct, plan: 'account' };
  let best: { cap: number; plan: CapPlan } | null = null;
  for (const p of plansFor(f)) if (!best || cfg.caps[p] > best.cap) best = { cap: cfg.caps[p], plan: p };
  return best!;
}

export function capNotice(cap: number, plan: CapDecision['plan'], cfg: CapsConfig): string {
  const nextPlan = plan === 'staff' || plan === 'account' ? undefined : NEXT_PLAN[plan];
  const upgrade = nextPlan && cfg.caps[nextPlan] > cap ? ` The ${PLAN_LABEL[nextPlan]} plan includes ${cfg.caps[nextPlan]} a day.` : '';
  return `You've used today's ${cap} in-depth research answer${cap === 1 ? '' : 's'}, so this one is a standard answer. In-depth research resets tomorrow.${upgrade}`;
}

/** Start of the current UTC day. */
export const utcDayStart = (now: number) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

/** A stored trace counts when it ran in research mode and made at least one tool call. */
export function countsTowardCap(trace: unknown): boolean {
  const t = trace as { engine?: unknown; call_count?: unknown } | null;
  return !!t && t.engine === 'research_mode' && typeof t.call_count === 'number' && t.call_count >= 1;
}

export interface CapDeps {
  facts: (email: string) => Promise<PlanFacts>;
  /** Today's stored research traces for this user, or null when they could not be read. */
  todaysTraces: (email: string, sinceIso: string) => Promise<unknown[] | null>;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

/**
 * The cap decision for this turn. A count that cannot be read is UNKNOWN: the turn is allowed (never blocked on a
 * telemetry read) and the trace says so.
 */
export async function researchCapDecision(email: string, deps: CapDeps): Promise<CapDecision & { countUnknown?: boolean }> {
  const cfg = researchCapsConfig(deps.env ?? process.env);
  const f = await deps.facts(email);
  const { cap, plan } = capFor(email, f, cfg);
  if (cap === null) return { cap: null, plan, used: null, allowed: true, notice: null };
  const traces = await deps.todaysTraces(email, utcDayStart((deps.now ?? Date.now)())).catch(() => null);
  if (!traces) return { cap, plan, used: null, allowed: true, notice: null, countUnknown: true };
  const used = traces.filter(countsTowardCap).length;
  const allowed = used < cap;
  return { cap, plan, used, allowed, notice: allowed ? null : capNotice(cap, plan, cfg) };
}

/** MCP plan from the newest subscription grant still inside its window (monthly 35 days, annual 370 days). */
export function mcpPlanFromLedger(rows: Array<{ reason: string; delta: number; created_at: string }>, now: number): string | null {
  const DAY = 86_400_000;
  for (const r of rows) {
    const age = now - Date.parse(r.created_at);
    const monthly = r.reason === 'mcp_sub_monthly' && age <= 35 * DAY;
    const annual = r.reason === 'mcp_sub_annual' && age <= 370 * DAY;
    if (!monthly && !annual) continue;
    const p = SUBSCRIPTION_PLANS.find((x) => (monthly ? x.monthly.credits : x.annual?.credits) === r.delta);
    if (p && subscriptionPlan(p.id)) return p.id;
  }
  return null;
}
