/**
 * LLM usage + cost tracking (Eric: protect margin — a $149/mo user can't run a
 * $200 Claude bill). Records per-call token usage + $ cost, exposes the per-user
 * monthly spend for the budget cap, and prices are centralized here.
 *
 * Prices are approximate USD per 1M tokens (update as providers change). Source
 * of truth for the cost dashboard (#37) + the per-user cap.
 */
import { getStaffRole, INTERNAL_TEAM_EMAILS } from '@/lib/access/staff-role';
import { createClient } from '@supabase/supabase-js';

type TokenUsage = { prompt_tokens?: number; completion_tokens?: number };

// $ per 1M tokens [input, output]. Keyed by model substring (matched loosely).
// GPT-6 family (OpenAI pricing, 2026-11-14). These MUST be priced: an unpriced model costs $0 here,
// which silently disables the per-user budget cap and zeroes the cost dashboard for that model.
const MODEL_PRICES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /gpt-6(\.\d+)?-astra/i,      in: 10.0, out: 50.0 },
  { match: /gpt-6(\.\d+)?-sol/i,        in: 2.00, out: 10.0 },
  { match: /gpt-6(\.\d+)?-terra/i,      in: 1.00, out: 5.00 },
  { match: /gpt-6(\.\d+)?-luna/i,       in: 0.10, out: 0.50 },
  { match: /gpt-oss-120b/i,              in: 0.15, out: 0.60 },
  { match: /gpt-4o-mini|gpt-4\.1-mini/i, in: 0.15, out: 0.60 },
  { match: /gpt-4o|gpt-4\.1\b/i,         in: 2.50, out: 10.0 },
  // Current Claude list prices (Claude API models reference, checked 2026-11-25). Specific families first:
  // the old catch-alls priced Opus 5.5 at 3.75x and Sonnet 5.x at 1.5x, which overstated Claude turns.
  { match: /claude-opus-5-5/i,           in: 4.00, out: 20.0 },
  { match: /claude-opus-5\b/i,           in: 5.00, out: 25.0 },
  { match: /claude-sonnet-5/i,           in: 2.00, out: 10.0 },
  { match: /claude.*opus/i,              in: 15.0, out: 75.0 },
  { match: /claude.*sonnet/i,            in: 3.00, out: 15.0 },
  { match: /claude.*haiku/i,             in: 0.80, out: 4.00 },
  { match: /llama.*70b|groq.*70/i,       in: 0.59, out: 0.79 },
  { match: /llama.*8b|groq.*8/i,         in: 0.05, out: 0.08 },
  { match: /grok/i,                      in: 2.00, out: 10.0 },
];

/** Compute the $ cost of a call from its model + token usage. */
export function costOf(model: string | undefined, usage: TokenUsage | undefined): number {
  if (!model || !usage) return 0;
  const price = MODEL_PRICES.find(p => p.match.test(model));
  if (!price) return 0;
  const pIn = (usage.prompt_tokens || 0) / 1e6 * price.in;
  const pOut = (usage.completion_tokens || 0) / 1e6 * price.out;
  return Number((pIn + pOut).toFixed(5));
}

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Fire-and-forget: log one LLM call's usage + cost. Never throws. */
export async function recordLlmUsage(params: {
  userEmail?: string | null;
  tool: string;
  job?: string;
  provider?: string;
  model?: string;
  usage?: TokenUsage;
}): Promise<void> {
  try {
    const cost = costOf(params.model, params.usage);
    await sb().from('llm_usage_log').insert({
      user_email: params.userEmail || null,
      tool: params.tool,
      job: params.job || null,
      provider: params.provider || null,
      model: params.model || null,
      prompt_tokens: params.usage?.prompt_tokens || 0,
      completion_tokens: params.usage?.completion_tokens || 0,
      cost_usd: cost,
    });
  } catch { /* telemetry must never break the request */ }
}

/** Rows per page when summing usage (PostgREST caps a response at 1,000 rows). */
export const SPEND_PAGE_ROWS = 1000;
/** Pages read at most (a runaway account still gets a bounded read). */
export const SPEND_MAX_PAGES = 50;

/**
 * Current-month LLM spend ($) for a user. 0 on any error (fail-open: a telemetry read never blocks a customer).
 * Every row of the month is summed: the read is paged, because a single PostgREST response stops at 1,000 rows and a
 * heavy user's spend was under-counted (2026-11-25).
 */
export async function getUserMonthSpend(userEmail: string, db: () => ReturnType<typeof sb> = sb): Promise<number> {
  try {
    const start = new Date();
    const monthStart = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
    let total = 0;
    for (let page = 0; page < SPEND_MAX_PAGES; page++) {
      const from = page * SPEND_PAGE_ROWS;
      const { data, error } = await db()
        .from('llm_usage_log')
        .select('cost_usd')
        .eq('user_email', userEmail)
        .gte('created_at', monthStart)
        .order('created_at', { ascending: true })
        .range(from, from + SPEND_PAGE_ROWS - 1);
      if (error) return total;
      const rows = (data || []) as Array<{ cost_usd?: number | string | null }>;
      total += rows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
      if (rows.length < SPEND_PAGE_ROWS) break;
    }
    return total;
  } catch { return 0; }
}

// Per-user monthly compute budget on the $149 plan. A user at this much LLM cost
// is eating the margin — past it we downgrade them to the cheap model (never a
// hard "you can't use Mindy" — that's worse than the cost).
export const USER_MONTHLY_LLM_BUDGET_USD = Number(process.env.USER_MONTHLY_LLM_BUDGET_USD || 15);

/** Is the user over their monthly LLM budget? (→ force the cheapest model.) */
export async function isUserOverBudget(userEmail?: string | null): Promise<boolean> {
  if (!userEmail) return false;
  // Admin, staff and the internal team are never held to the monthly dollar limit (Eric, 2026-11-25).
  const e = userEmail.trim().toLowerCase();
  if (getStaffRole(e) !== 'none' || INTERNAL_TEAM_EMAILS.has(e)) return false;
  const spend = await getUserMonthSpend(userEmail);
  return spend >= USER_MONTHLY_LLM_BUDGET_USD;
}
