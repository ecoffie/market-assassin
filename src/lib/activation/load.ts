/**
 * Activation dashboard: READ-ONLY loader (activation Phase 1). Reads existing production tables and writes
 * nothing. Every query binds { data, error } and throws on error; a source that does not exist yet
 * (card_chat_turns before its migration) is reported as unavailable (null), never as zero.
 *
 * Registration = an auth.users row (Supabase Auth): the one table every signup door writes. signup_events
 * undercounted (it logged one legacy door), and user_profiles is also written by purchases and admin tools.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';
import { getStaffRole } from '@/lib/api-auth';
import type { AccountActivity } from './framework';
import { activationPaidReasons } from '@/lib/entitlements/paid-reasons';

const PAGE = 1000;
const EMAIL_CHUNK = 150;

/** listing/detail opens: the first-value proxy. */
export const OPEN_OPPORTUNITY_TOOLS = new Set(['listing_open', 'open_details', 'pin_clicked', 'expand_opportunity', 'office_viewed']);
/** Shared paid-status reasons: the legacy list unless PAID_STATUS_RESOLVER=true (read at import). */
export const PAID_REASONS = activationPaidReasons();

/** Staff, comp, advocate, partner, demo and synthetic accounts are not customers. */
export function isExcludedAccount(email: string): boolean {
  const e = email.toLowerCase().trim();
  if (!e.includes('@')) return true;
  if (isExcludedFromMetrics(e)) return true;
  if (getStaffRole(e) !== 'none') return true;
  if (e === 'demo@getmindy.ai' || e.endsWith('.invalid') || e.endsWith('@example.com')) return true;
  return false;
}

type Row = Record<string, unknown>;

async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>, label: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(`${label}: ${error.message}`), { code: error.code });
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function loadRegisteredAccounts(db: SupabaseClient, from: Date, to: Date): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`auth.users: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      const c = Date.parse(u.created_at);
      if (u.email && c >= from.getTime() && c < to.getTime() && !isExcludedAccount(u.email)) out.push(u);
    }
    if (users.length < PAGE) return out;
  }
}

export async function loadActivationData(db: SupabaseClient, opts: { from: Date; to: Date }): Promise<{ accounts: AccountActivity[]; cardChatAvailable: boolean }> {
  const users = await loadRegisteredAccounts(db, opts.from, opts.to);
  const byEmail = new Map<string, AccountActivity>();
  for (const u of users) {
    const email = u.email!.toLowerCase();
    byEmail.set(email, {
      email, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at ?? null,
      appEvents: [], mcpCalls: [], emailClicks: [], emailOpens: [], tracked: [], watches: [], pursuitChanges: [],
      cardAnswers: [], paidAt: null,
    });
  }
  const emails = [...byEmail.keys()];
  const since = opts.from.toISOString();
  const get = (e: unknown) => byEmail.get(String(e || '').toLowerCase());
  let cardChatAvailable = true;

  for (const part of chunks(emails, EMAIL_CHUNK)) {
    const engagement = await pageAll((a, b) => db.from('user_engagement')
      .select('user_email, event_type, created_at, tool:metadata->>tool, action:metadata->>action')
      .in('user_email', part).gte('created_at', since).order('id').range(a, b), 'user_engagement');
    for (const r of engagement) {
      const acc = get(r.user_email); if (!acc) continue;
      const at = String(r.created_at);
      if (r.event_type === 'email_open') acc.emailOpens.push(at);
      else if (r.event_type === 'link_click') acc.emailClicks.push(at);
      // The Map writes the event name in metadata.action; other surfaces use metadata.tool.
      else acc.appEvents.push({ at, openedOpportunity: OPEN_OPPORTUNITY_TOOLS.has(String(r.action || r.tool || '')) });
    }

    const calls = await pageAll((a, b) => db.from('mcp_call_log').select('user_email, created_at, status')
      .in('user_email', part).gte('created_at', since).order('id').range(a, b), 'mcp_call_log');
    for (const r of calls) {
      const acc = get(r.user_email); if (!acc) continue;
      acc.mcpCalls.push({ at: String(r.created_at), ok: r.status === 'success' || r.status === 'uncharged', rejectedNoCredits: r.status === 'rejected_no_credits' });
    }

    const pipeline = await pageAll((a, b) => db.from('user_pipeline').select('user_email, created_at')
      .in('user_email', part).order('id').range(a, b), 'user_pipeline');
    const saved = await pageAll((a, b) => db.from('user_saved_opportunities').select('user_email, created_at')
      .in('user_email', part).order('id').range(a, b), 'user_saved_opportunities');
    for (const r of [...pipeline, ...saved]) get(r.user_email)?.tracked.push(String(r.created_at));

    const watches = await pageAll((a, b) => db.from('saved_searches').select('user_email, created_at')
      .in('user_email', part).order('id').range(a, b), 'saved_searches');
    for (const r of watches) get(r.user_email)?.watches.push(String(r.created_at));

    const changes = await pageAll((a, b) => db.from('pursuit_change_log').select('user_email, detected_at')
      .in('user_email', part).gte('detected_at', since).order('id').range(a, b), 'pursuit_change_log');
    for (const r of changes) get(r.user_email)?.pursuitChanges.push(String(r.detected_at));

    const paid = await pageAll((a, b) => db.from('mcp_credit_ledger').select('user_email, created_at')
      .in('user_email', part).in('reason', PAID_REASONS).order('id').range(a, b), 'mcp_credit_ledger');
    for (const r of paid) {
      const acc = get(r.user_email); if (!acc) continue;
      const at = String(r.created_at);
      if (!acc.paidAt || Date.parse(at) < Date.parse(acc.paidAt)) acc.paidAt = at;
    }

    if (cardChatAvailable) {
      try {
        const turns = await pageAll((a, b) => db.from('card_chat_turns').select('user_email, completed_at')
          .in('user_email', part).eq('status', 'completed').order('turn_id').range(a, b), 'card_chat_turns');
        for (const r of turns) if (r.completed_at) get(r.user_email)?.cardAnswers?.push(String(r.completed_at));
      } catch (err) {
        // 42P01 / PGRST205 = the table is not deployed yet: unavailable, not zero. Anything else is a real failure.
        const code = (err as { code?: string }).code;
        if (code === '42P01' || code === 'PGRST205') cardChatAvailable = false;
        else throw err;
      }
    }
  }
  if (!cardChatAvailable) for (const a of byEmail.values()) a.cardAnswers = null;
  return { accounts: [...byEmail.values()], cardChatAvailable };
}
