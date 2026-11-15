/**
 * Activation dashboard: READ-ONLY loader (activation Phase 1). Reads existing production tables and writes
 * nothing. Every query binds { data, error } and throws on error; a source that does not exist yet
 * (card_chat_turns before its migration, mindy_chat_messages.trace before its column) is reported as
 * unavailable (null), never as zero.
 *
 * Known blind spot: user_pipeline rows are HARD deleted, and pipeline_history / pursuit_change_log cascade with
 * them, so a deleted pursuit leaves no table trace. The engagement events pursuit_started / save_to_pipeline are
 * read as a durable backup for "ever tracked" and "tracked within 7 days"; a track made from a surface that emits
 * neither (and later deleted) is still invisible.
 *
 * Registration = an auth.users row (Supabase Auth): the one table every signup door writes. signup_events
 * undercounted (it logged one legacy door), and user_profiles is also written by purchases and admin tools.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';
import { getStaffRole } from '@/lib/api-auth';
import type { AccountActivity } from './framework';

const PAGE = 1000;
const EMAIL_CHUNK = 150;

/**
 * Opening an opportunity: the first-value proxy. Matched against metadata.action, metadata.tool and metadata.kind
 * (the Map's card tracker writes its event name in `kind`).
 *   listing_open        Map listing drawer
 *   open_details        Alerts panel detail
 *   expand_opportunity  in-app opportunity expand
 *   popup_open, click, cta_click   Map decision-card opens/clicks (the same deliberate set Recently Viewed reads)
 * Deliberately NOT counted (decision 2026-11-14, owner may revisit):
 *   pin_clicked   a pin click; it is logged even when no popup opens (the funnel step BEFORE an open)
 *   office_viewed a buying-office drawer, not an opportunity
 *   impression    a card scrolled into view
 */
export const OPEN_OPPORTUNITY_TOOLS = new Set(['listing_open', 'open_details', 'expand_opportunity', 'popup_open', 'click', 'cta_click']);

/**
 * event_source values that mean "a click on a link in a Mindy email". Email link clicks are written only by
 * recordLinkClick (/api/track redirect), whose event_source is the tracking token's email_type
 * (createEmailTrackingToken callers: daily_alert, weekly_alert, daily_briefing, weekly_deep_dive,
 * weekly_deep_dive_retry, admin_briefing) plus the legacy EventSources weekly_briefing / pursuit_brief.
 * NOT 'daily_alerts' (plural): that is the in-app Alerts panel (AlertsPanel, free tier). Every other link_click
 * (source_feed, sidebar, market_intel_dashboard, opportunity_map, todays_intel …) is an in-app event.
 */
export const EMAIL_CLICK_SOURCES = new Set([
  'daily_alert', 'weekly_alert', 'daily_briefing', 'weekly_deep_dive', 'weekly_deep_dive_retry', 'admin_briefing',
  'weekly_briefing', 'pursuit_brief',
]);

/** A durable record that the user tracked/saved an opportunity (survives a hard delete of the pipeline row). */
export const TRACK_EVENT_ACTIONS = new Set(['pursuit_started', 'save_to_pipeline']);

/** user_pipeline rows created by a bulk import, not by the user tracking an opportunity. */
export const BULK_PIPELINE_SOURCES = new Set(['base44_import']);

/** Main-chat trace notices that mean the answer was not a complete, data-backed success. */
const MAIN_CHAT_FAILURE_NOTICES = new Set(['truncated', 'tools_unavailable', 'lookup_failed']);
export const PAID_REASONS = ['pro_monthly', 'app_tier_pro', 'mcp_sub_monthly', 'mcp_sub_annual', 'stripe_topup'];

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

/** Postgres/PostgREST "this table or column does not exist": the source is unavailable, not zero. */
const MISSING_SOURCE_CODES = new Set(['42P01', 'PGRST205', '42703', 'PGRST204']);
const isMissingSource = (err: unknown) => MISSING_SOURCE_CODES.has(String((err as { code?: string }).code || ''));

/** Is an engagement row an email click (vs an in-app link click)? */
export function isEmailClick(eventType: unknown, eventSource: unknown): boolean {
  return eventType === 'link_click' && EMAIL_CLICK_SOURCES.has(String(eventSource || ''));
}

/** A successful main Ask Mindy answer: non-empty, finished normally, not cut off, no failed-tool notice. */
export function isSuccessfulMainChatAnswer(row: { content?: unknown; trace?: unknown }): boolean | null {
  const trace = row.trace as { answer?: { finish_reason?: unknown } | null; notices?: unknown; context?: unknown } | null | undefined;
  if (!trace || typeof trace !== 'object') return null; // untraced (written before the trace column): unknown
  if (trace.context) return false; // a card-chat turn: counted from card_chat_turns instead
  if (typeof row.content !== 'string' || !row.content.trim()) return false;
  if (trace.answer?.finish_reason !== 'stop') return false;
  const notices = Array.isArray(trace.notices) ? trace.notices.map(String) : [];
  return !notices.some((n) => MAIN_CHAT_FAILURE_NOTICES.has(n));
}

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

export interface ActivationSources {
  cardChatAvailable: boolean;
  mainChatAvailable: boolean;
  /** Assistant messages with no trace (written before the trace column existed): success unknown, not counted. */
  mainChatUntraced: number;
  /** Earliest map_search carrying a result count (metadata.via), or null if none yet. */
  searchMeasuredSince: string | null;
  /** user_pipeline rows skipped as bulk imports. */
  bulkPipelineRowsSkipped: number;
}

export async function loadActivationData(db: SupabaseClient, opts: { from: Date; to: Date }): Promise<{ accounts: AccountActivity[] } & ActivationSources> {
  const users = await loadRegisteredAccounts(db, opts.from, opts.to);
  const byEmail = new Map<string, AccountActivity>();
  for (const u of users) {
    const email = u.email!.toLowerCase();
    byEmail.set(email, {
      email, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at ?? null,
      appEvents: [], mcpCalls: [], emailClicks: [], emailOpens: [], searches: [], tracked: [], trackedEvents: [],
      watches: [], pursuitChanges: [], cardAnswers: [], mainChatAnswers: [], paidAt: null,
    });
  }
  const emails = [...byEmail.keys()];
  const since = opts.from.toISOString();
  const get = (e: unknown) => byEmail.get(String(e || '').toLowerCase());
  let cardChatAvailable = true;
  let mainChatAvailable = true;
  let mainChatUntraced = 0;
  let bulkPipelineRowsSkipped = 0;
  let searchMeasuredSince: string | null = null;

  for (const part of chunks(emails, EMAIL_CHUNK)) {
    const engagement = await pageAll((a, b) => db.from('user_engagement')
      .select('user_email, event_type, event_source, created_at, tool:metadata->>tool, action:metadata->>action, kind:metadata->>kind, via:metadata->>via, results:metadata->>results')
      .in('user_email', part).gte('created_at', since).order('id').range(a, b), 'user_engagement');
    for (const r of engagement) {
      const acc = get(r.user_email); if (!acc) continue;
      const at = String(r.created_at);
      if (r.event_type === 'email_open') { acc.emailOpens.push(at); continue; }
      if (isEmailClick(r.event_type, r.event_source)) { acc.emailClicks.push(at); continue; }
      // The Map writes the event name in metadata.action, its card tracker in metadata.kind, other surfaces in
      // metadata.tool. An in-app link_click is app activity like any other event.
      const name = String(r.action || r.kind || r.tool || '');
      acc.appEvents.push({ at, openedOpportunity: OPEN_OPPORTUNITY_TOOLS.has(name) });
      if (TRACK_EVENT_ACTIONS.has(name)) acc.trackedEvents!.push(at);
      // A map_search carries a result count only since the emitter started stamping `via`.
      if (name === 'map_search' && r.via) {
        const n = r.results === null || r.results === undefined || r.results === '' ? null : Number(r.results);
        acc.searches!.push({ at, results: n !== null && Number.isFinite(n) ? n : null });
        if (!searchMeasuredSince || Date.parse(at) < Date.parse(searchMeasuredSince)) searchMeasuredSince = at;
      }
    }

    const calls = await pageAll((a, b) => db.from('mcp_call_log').select('user_email, created_at, status, channel')
      .in('user_email', part).gte('created_at', since).order('id').range(a, b), 'mcp_call_log');
    for (const r of calls) {
      const acc = get(r.user_email); if (!acc) continue;
      const at = String(r.created_at);
      const ok = r.status === 'success' || r.status === 'uncharged';
      // channel 'app_chat' = a tool call made by in-app Ask Mindy: app activity, not MCP use.
      if (r.channel === 'app_chat') { if (ok) acc.appEvents.push({ at, openedOpportunity: false }); continue; }
      acc.mcpCalls.push({ at, ok, rejectedNoCredits: r.status === 'rejected_no_credits', channel: r.channel === 'chatgpt' ? 'chatgpt' : 'claude' });
    }

    const pipeline = await pageAll((a, b) => db.from('user_pipeline').select('user_email, created_at, source')
      .in('user_email', part).order('id').range(a, b), 'user_pipeline');
    const saved = await pageAll((a, b) => db.from('user_saved_opportunities').select('user_email, created_at')
      .in('user_email', part).order('id').range(a, b), 'user_saved_opportunities');
    for (const r of pipeline) {
      if (BULK_PIPELINE_SOURCES.has(String(r.source || ''))) { bulkPipelineRowsSkipped++; continue; }
      get(r.user_email)?.tracked.push(String(r.created_at));
    }
    for (const r of saved) get(r.user_email)?.tracked.push(String(r.created_at));

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
        // The table is not deployed yet: unavailable, not zero. Anything else is a real failure.
        if (isMissingSource(err)) cardChatAvailable = false;
        else throw err;
      }
    }

    // Main Ask Mindy: sessions → assistant messages. Success is read from the persisted turn trace.
    if (mainChatAvailable) {
      try {
        const sessions = await pageAll((a, b) => db.from('mindy_chat_sessions').select('id, user_email')
          .in('user_email', part).gte('updated_at', since).order('id').range(a, b), 'mindy_chat_sessions');
        const owner = new Map(sessions.map((r) => [String(r.id), r.user_email]));
        for (const ids of chunks([...owner.keys()], EMAIL_CHUNK)) {
          const msgs = await pageAll((a, b) => db.from('mindy_chat_messages').select('session_id, created_at, content, trace')
            .in('session_id', ids).eq('role', 'assistant').gte('created_at', since).order('id').range(a, b), 'mindy_chat_messages');
          for (const m of msgs) {
            const ok = isSuccessfulMainChatAnswer(m);
            if (ok === null) { mainChatUntraced++; continue; }
            if (ok) get(owner.get(String(m.session_id)))?.mainChatAnswers?.push(String(m.created_at));
          }
        }
      } catch (err) {
        if (isMissingSource(err)) mainChatAvailable = false;
        else throw err;
      }
    }
  }
  for (const a of byEmail.values()) {
    if (!cardChatAvailable) a.cardAnswers = null;
    if (!mainChatAvailable) a.mainChatAnswers = null;
  }
  return { accounts: [...byEmail.values()], cardChatAvailable, mainChatAvailable, mainChatUntraced, searchMeasuredSince, bulkPipelineRowsSkipped };
}
