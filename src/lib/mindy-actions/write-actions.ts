/**
 * Ask Mindy WRITE actions (BETA, 2026-11-27). The model's action tool only EMITS {type:'action', name, args, id}; the
 * client shows a confirm and, on Yes, POSTs here through /api/app/mindy-actions. Nothing in this file is reachable
 * without that confirmed, session-authenticated request.
 *
 * Every action calls the SAME lib as today's button, so auth, workspace (coach mode), validation and dedupe cannot
 * drift:
 *   save_search          → createSavedSearch   (Map "Save search", /api/app/saved-searches, MCP schedule_market_search)
 *   update_alert         → updateSavedSearch
 *   add_to_pursuits      → createCanonicalPursuit (/api/pipeline POST, Map "Track", "Start Pursuit")
 *   remove_from_pursuits → removeOwnedPursuit    (/api/pipeline DELETE)
 *
 * Idempotent: a repeated save returns the existing row (fingerprint / UNIQUE(user_email, notice_id)); a repeated
 * removal of something already gone answers `already: true`. Pursuit fields come from OUR rows
 * (sam_opportunities / recompete_opportunities), never from model-written args.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RECOMPETE_PURSUIT_SOURCE, cleanRecompetePiid, recompetePursuitTitle } from '@/lib/recompete/pursuit-key';
import type { PursuitDraft, PursuitWriteContext, CreatePursuitResult } from '@/lib/pipeline/create-pursuit';
import type { RemovePursuitResult } from '@/lib/pipeline/remove-pursuit';

export const WRITE_ACTION_NAMES = ['save_search', 'update_alert', 'add_to_pursuits', 'remove_from_pursuits'] as const;
export type WriteActionName = (typeof WRITE_ACTION_NAMES)[number];
export type AlertChoice = 'daily' | 'weekly' | 'off';

export type WriteAction =
  | { name: 'save_search'; args: { name: string; mode: 'open' | 'recompete'; filters: Record<string, unknown>; alert: AlertChoice } }
  | { name: 'update_alert'; args: { search_id: string; alert: AlertChoice } }
  | { name: 'add_to_pursuits'; args: { kind: 'opportunity'; notice_id: string } | { kind: 'recompete'; contract_id: string } }
  | { name: 'remove_from_pursuits'; args: { pursuit_id?: string; notice_id?: string } };

export interface WriteActionResult {
  ok: boolean;
  action_id: string;
  name: string;
  /** One line the client can show as-is. */
  message: string;
  /** The write was already in effect (repeat save, already in pursuits, already removed). Nothing new was written. */
  already?: boolean;
  target?: { kind: 'saved_search' | 'pursuit'; id: string | null; href: string };
  error_code?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
// Same arg rules as the client registry (Agent 2, #2502), enforced here so the server never relies on the client.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTICE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const PLAIN = (s: string, max: number) => s.length <= max && !/[\u0000-\u001f<>]/.test(s);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parseAlert(v: unknown): AlertChoice | null {
  const s = str(v).toLowerCase();
  if (s === 'paused' || s === 'none') return 'off';
  return s === 'daily' || s === 'weekly' || s === 'off' ? s : null;
}

/** Validate a client-supplied action. Pure. Unknown names and malformed args are refused, never coerced. */
export function parseWriteAction(name: unknown, args: unknown): { ok: true; action: WriteAction } | { ok: false; error: string } {
  const n = str(name).replace(/^mindy\./, '');
  const a = isObj(args) ? args : {};
  switch (n) {
    case 'save_search': {
      const label = str(a.name);
      if (!label) return { ok: false, error: 'save_search needs a name' };
      if (!PLAIN(label, 80)) return { ok: false, error: 'name must be plain text of at most 80 characters' };
      const mode = str(a.mode) || 'open';
      if (mode !== 'open' && mode !== 'recompete') return { ok: false, error: 'mode must be open or recompete' };
      if (!isObj(a.filters)) return { ok: false, error: 'save_search needs filters (the Map search to save)' };
      const alert = a.alert_frequency === undefined ? 'daily' : parseAlert(a.alert_frequency);
      if (!alert) return { ok: false, error: 'alert_frequency must be daily, weekly or off' };
      return { ok: true, action: { name: 'save_search', args: { name: label, mode, filters: a.filters, alert } } };
    }
    case 'update_alert': {
      const id = str(a.search_id);
      const alert = parseAlert(a.alert_frequency);
      if (!UUID.test(id)) return { ok: false, error: 'update_alert needs a valid search_id' };
      if (!alert) return { ok: false, error: 'alert_frequency must be daily, weekly or off' };
      return { ok: true, action: { name: 'update_alert', args: { search_id: id, alert } } };
    }
    case 'add_to_pursuits': {
      const kind = str(a.kind) || (a.contract_id ? 'recompete' : 'opportunity');
      if (kind === 'opportunity') {
        const notice = str(a.notice_id);
        if (!NOTICE_ID.test(notice)) return { ok: false, error: 'add_to_pursuits (opportunity) needs a valid notice_id' };
        return { ok: true, action: { name: 'add_to_pursuits', args: { kind, notice_id: notice } } };
      }
      if (kind === 'recompete') {
        const cid = str(a.contract_id);
        if (!cid || !PLAIN(cid, 64)) return { ok: false, error: 'add_to_pursuits (recompete) needs a valid contract_id' };
        return { ok: true, action: { name: 'add_to_pursuits', args: { kind, contract_id: cid } } };
      }
      return { ok: false, error: 'kind must be opportunity or recompete' };
    }
    case 'remove_from_pursuits': {
      const pid = str(a.pursuit_id);
      const notice = str(a.notice_id);
      if (!pid && !notice) return { ok: false, error: 'remove_from_pursuits needs pursuit_id or notice_id' };
      if (pid ? !UUID.test(pid) : !NOTICE_ID.test(notice)) return { ok: false, error: 'remove_from_pursuits needs a valid pursuit_id or notice_id' };
      return { ok: true, action: { name: 'remove_from_pursuits', args: { ...(pid ? { pursuit_id: pid } : { notice_id: notice }) } } };
    }
    default:
      return { ok: false, error: `unknown write action: ${n || '(none)'}` };
  }
}

// ── Dependencies (the existing libs; injected so the executor is testable without a DB) ────────
type ServiceResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
interface SavedRow { id: string; name: string; alerts_enabled: boolean; alert_frequency: string }

export interface WriteActionDeps {
  db: Pick<SupabaseClient, 'from'>;
  createSavedSearch(input: {
    userEmail: string; name: string; mode: string; filters: Record<string, unknown>;
    alertsEnabled: boolean; alertFrequency?: string;
  }): Promise<ServiceResult<{ search: SavedRow; idempotent: boolean }>>;
  updateSavedSearch(input: { userEmail: string; id: string; alertsEnabled: boolean; alertFrequency?: string }):
    Promise<ServiceResult<{ search: SavedRow; noop: boolean }>>;
  createCanonicalPursuit(ctx: PursuitWriteContext, draft: PursuitDraft, opts?: { clientNoticeType?: string | null }): Promise<CreatePursuitResult>;
  removeOwnedPursuit(db: Pick<SupabaseClient, 'from'>, owner: { workspaceId: string; email: string }, target: { id?: string | null; noticeId?: string | null }): Promise<RemovePursuitResult>;
  /** Called with a created pursuit's background doc fetch (the route schedules it with after()). */
  schedule?(work: () => Promise<void>): void;
  recordActivity?(e: { entityId: string; action: 'created' | 'deleted'; summary: string }): Promise<void>;
}

export interface WriteActionCtx {
  /** VERIFIED account email (requireMIAuthSession). */
  email: string;
  workspaceId: string;
  asClient: boolean;
  clientOwnerEmail: string;
  /** Absolute origin for hrefs, e.g. https://getmindy.ai */
  origin: string;
}

/** Codes whose upstream message can be a raw database/infra error. */
const TECHNICAL_CODES = new Set(['scheduler_unavailable', 'write_failed', 'lookup_failed']);
const PURSUITS_PATH = '/app?panel=pipeline';
const alertLabel = (row: SavedRow) => (row.alerts_enabled ? `${row.alert_frequency} alerts` : 'alerts off');
const toPrefs = (a: AlertChoice) => (a === 'off' ? { alertsEnabled: false, alertFrequency: 'paused' } : { alertsEnabled: true, alertFrequency: a });
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function executeWriteAction(
  action: WriteAction,
  actionId: string,
  ctx: WriteActionCtx,
  deps: WriteActionDeps,
): Promise<WriteActionResult> {
  const base = { action_id: actionId, name: action.name };
  // `message` is shown to the customer verbatim (Agent 2): never a raw database error, at most 300 characters.
  const fail = (error_code: string, message: string): WriteActionResult => ({
    ...base, ok: false, error_code,
    message: (TECHNICAL_CODES.has(error_code) ? 'Mindy could not save that right now. Nothing was changed. Please try again.' : message).slice(0, 300),
  });

  if (action.name === 'save_search') {
    const r = await deps.createSavedSearch({
      userEmail: ctx.email, name: action.args.name, mode: action.args.mode, filters: action.args.filters, ...toPrefs(action.args.alert),
    });
    if (!r.ok) return fail(r.code, r.message);
    const s = r.data.search;
    return {
      ...base, ok: true, already: r.data.idempotent || undefined,
      message: r.data.idempotent ? `Already saved as '${s.name}' · ${alertLabel(s)}` : `Saved '${s.name}' · ${alertLabel(s)}`,
      target: { kind: 'saved_search', id: s.id, href: `${ctx.origin}/opportunity-map?ss=${encodeURIComponent(s.id)}&src=ask_mindy` },
    };
  }

  if (action.name === 'update_alert') {
    const r = await deps.updateSavedSearch({ userEmail: ctx.email, id: action.args.search_id, ...toPrefs(action.args.alert) });
    if (!r.ok) return fail(r.code, r.code === 'not_found' ? 'That saved search was not found in your account.' : r.message);
    const s = r.data.search;
    return {
      ...base, ok: true, already: r.data.noop || undefined,
      message: `'${s.name}' · ${alertLabel(s)}`,
      target: { kind: 'saved_search', id: s.id, href: `${ctx.origin}/opportunity-map?ss=${encodeURIComponent(s.id)}&src=ask_mindy` },
    };
  }

  if (action.name === 'add_to_pursuits') {
    let draft: PursuitDraft;
    let noticeType: string | null = null;
    if (action.args.kind === 'opportunity') {
      const { data, error } = await deps.db.from('sam_opportunities')
        .select('notice_id, title, department, sub_tier, naics_code, set_aside_description, response_deadline, notice_type, ui_link')
        .eq('notice_id', action.args.notice_id).maybeSingle();
      if (error) return fail('lookup_failed', 'Could not read that opportunity right now. Nothing was saved.');
      if (!data) return fail('not_found', 'That opportunity is not in Mindy\'s SAM data. Nothing was saved.');
      const o = data as Record<string, string | null>;
      noticeType = o.notice_type ?? null;
      draft = {
        title: o.title || `SAM notice ${o.notice_id}`,
        notice_id: o.notice_id || action.args.notice_id,
        agency: o.sub_tier || o.department || undefined,
        naics_code: o.naics_code || undefined,
        set_aside: o.set_aside_description || undefined,
        response_deadline: o.response_deadline || undefined,
        external_url: o.ui_link || undefined,
        source: 'ask_mindy',
      };
    } else {
      const { data, error } = await deps.db.from('recompete_opportunities')
        .select('contract_id, piid, incumbent_name, awarding_agency, awarding_sub_agency, naics_code')
        .eq('contract_id', action.args.contract_id).maybeSingle();
      if (error) return fail('lookup_failed', 'Could not read that contract right now. Nothing was saved.');
      if (!data) return fail('not_found', 'That contract is not in Mindy\'s recompete data. Nothing was saved.');
      const c = data as Record<string, string | null>;
      const piid = cleanRecompetePiid(c.piid);
      // Without a PIID the pursuit has no notice_id and no UNIQUE(user_email, notice_id) protection: refuse rather
      // than write a row a repeat could duplicate (the same rule as the Map's recompetePursuitReq).
      if (!piid) return fail('no_piid', 'This contract has no award number to track it by. Nothing was saved.');
      // Same title, key and source as the Map's "Track this recompete" (pursuit-key.ts).
      draft = {
        title: recompetePursuitTitle(c.incumbent_name, piid),
        notice_id: piid,
        agency: c.awarding_sub_agency || c.awarding_agency || undefined,
        naics_code: c.naics_code || undefined,
        source: RECOMPETE_PURSUIT_SOURCE,
      };
    }
    const r = await deps.createCanonicalPursuit(
      { db: deps.db as SupabaseClient, callerEmail: ctx.email, workspaceId: ctx.workspaceId, asClient: ctx.asClient, clientOwnerEmail: ctx.clientOwnerEmail },
      draft,
      { clientNoticeType: noticeType },
    );
    const href = `${ctx.origin}${PURSUITS_PATH}`;
    if (r.kind === 'duplicate') {
      const id = (r.existing as { id?: string } | null)?.id ?? null;
      return { ...base, ok: true, already: true, message: `'${short(draft.title)}' is already in My Pursuits`, target: { kind: 'pursuit', id, href } };
    }
    if (r.kind === 'invalid') return fail('invalid', r.error);
    if (r.kind === 'error') return fail('write_failed', 'Could not add it to My Pursuits right now. Nothing was saved.');
    if (r.postWrite && deps.schedule) deps.schedule(r.postWrite);
    const id = (r.pursuit as { id?: string } | null)?.id ?? null;
    return { ...base, ok: true, message: `Added '${short(draft.title)}' to My Pursuits`, target: { kind: 'pursuit', id, href } };
  }

  // remove_from_pursuits
  const r = await deps.removeOwnedPursuit(deps.db, { workspaceId: ctx.workspaceId, email: ctx.email }, {
    id: action.args.pursuit_id ?? null, noticeId: action.args.notice_id ?? null,
  });
  const href = `${ctx.origin}${PURSUITS_PATH}`;
  if (r.kind === 'error') return fail('write_failed', r.message);
  if (r.kind === 'not_found') {
    return { ...base, ok: true, already: true, message: 'That item is not in My Pursuits (nothing to remove).', target: { kind: 'pursuit', id: null, href } };
  }
  if (deps.recordActivity) await deps.recordActivity({ entityId: r.row.id, action: 'deleted', summary: `Removed ${r.row.title} from pipeline` });
  return { ...base, ok: true, message: `Removed '${short(r.row.title)}' from My Pursuits`, target: { kind: 'pursuit', id: r.row.id, href } };
}
