/**
 * Persistence for the one-shot market report — the half that turns a JSON blob into
 * something Sue can SEND a client. `generate_market_report` saves the payload here and
 * hands back /reports/<id>; the hosted page loads it and re-renders with the shared
 * renderer.
 *
 * We store the structured payload, NOT the rendered HTML: the renderer is deterministic
 * from the payload, so template fixes reach links that were already shared.
 *
 * ⚠️ The id IS the access control (unguessable capability URL — the page is public so a
 * client can open it without a Mindy login). Never make it sequential/derivable.
 *
 * Saving is best-effort by design: a storage failure must NEVER lose the report the
 * caller just paid credits for — the tool still returns the full JSON + inline HTML.
 */
import { randomBytes } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SavedReport {
  id: string;
  owner_email: string;
  subject: string;
  client_name: string | null;
  params: Record<string, unknown>;
  payload: Record<string, unknown>;
  created_at: string;
  /** null/absent = the link never expires (every link created before link controls). */
  expires_at?: string | null;
  /** null/absent = the link is active. */
  revoked_at?: string | null;
}

/** New hosted links expire after this many days (Eric, 2026-11-22). No "never" option for new links. */
export const REPORT_LINK_DAYS = 90;
/** The only extensions an owner can choose. */
export const REPORT_EXTEND_DAYS = [30, 90, 365] as const;

export type LinkStatus = 'live' | 'expired' | 'revoked';

/**
 * Whether the PUBLIC link works. Revoked wins over expired. A row with neither column set, which covers
 * every link created before link controls, is live, whether or not the migration has run.
 */
export function linkStatus(r: Pick<SavedReport, 'expires_at' | 'revoked_at'>, nowMs: number = Date.now()): LinkStatus {
  if (r.revoked_at) return 'revoked';
  if (r.expires_at) {
    const t = Date.parse(r.expires_at);
    if (Number.isFinite(t) && t <= nowMs) return 'expired';
  }
  return 'live';
}

/** Postgres undefined_column, or PostgREST's schema-cache miss: the link-control columns do not exist yet. */
function missingLinkColumns(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42703' || err.code === 'PGRST204' || /expires_at|revoked_at/.test(String(err.message || ''));
}

function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 22-char base64url token — 128 bits of entropy, not enumerable. */
export function newReportId(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Persist a report. Returns its id, or null when storage is unavailable/failed —
 * the caller degrades to "no shareable link" rather than failing the whole report.
 */
export async function saveMarketReport(input: {
  ownerEmail: string;
  subject: string;
  clientName?: string | null;
  params: Record<string, unknown>;
  payload: Record<string, unknown>;
}): Promise<string | null> {
  const sb = client();
  if (!sb || !input.ownerEmail) return null;

  const id = newReportId();
  try {
    const row = {
      id,
      owner_email: input.ownerEmail,
      subject: input.subject,
      client_name: input.clientName || null,
      params: input.params,
      payload: input.payload,
    };
    const expires_at = new Date(Date.now() + REPORT_LINK_DAYS * 86_400_000).toISOString();
    let { error } = await sb.from('market_reports').insert({ ...row, expires_at });
    // Code deployed before the migration is applied: save the report without an expiry rather than lose it
    // (a report the caller paid for must never fail to save over link metadata).
    if (error && missingLinkColumns(error)) {
      console.warn('[market-report] link-control columns missing; saved without expiry (apply 20261122_market_reports_share_controls.sql)');
      ({ error } = await sb.from('market_reports').insert(row));
    }
    if (error) {
      console.error('[market-report] save failed:', error.message);
      return null;
    }
    return id;
  } catch (err) {
    console.error('[market-report] save threw:', err);
    return null;
  }
}

/** Load a report by id. Returns null when missing (→ the page 404s honestly). */
export async function getMarketReport(id: string): Promise<SavedReport | null> {
  const sb = client();
  if (!sb || !id) return null;
  try {
    const { data, error } = await sb.from('market_reports').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.error('[market-report] load failed:', error.message);
      return null;
    }
    return (data as SavedReport) || null;
  } catch (err) {
    console.error('[market-report] load threw:', err);
    return null;
  }
}

/** An owner's reports, newest first — backs a future "my reports" list. */
export async function listMarketReports(ownerEmail: string, limit = 25): Promise<SavedReport[]> {
  const sb = client();
  if (!sb || !ownerEmail) return [];
  try {
    const { data, error } = await sb
      .from('market_reports')
      .select('*')
      .eq('owner_email', ownerEmail)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));
    if (error) {
      console.error('[market-report] list failed:', error.message);
      return [];
    }
    return (data as SavedReport[]) || [];
  } catch (err) {
    console.error('[market-report] list threw:', err);
    return [];
  }
}

// ── Owner link controls (strong-auth owner routes under /api/app/market-reports). Every query is scoped by
// owner_email, so another account's report behaves exactly like a missing one. ────────────────────────────

/** Columns the owner list shows (never the payload). */
const OWNER_LIST_COLUMNS = 'id, subject, client_name, created_at, expires_at, revoked_at';

export type OwnedReportSummary = Pick<SavedReport, 'id' | 'subject' | 'client_name' | 'created_at' | 'expires_at' | 'revoked_at'>;

/** The owner's own report, payload included, whatever its link status. Null when missing or not theirs. */
export async function getOwnedMarketReport(id: string, ownerEmail: string): Promise<SavedReport | null> {
  const sb = client();
  if (!sb || !id || !ownerEmail) return null;
  try {
    const { data, error } = await sb.from('market_reports').select('*').eq('id', id).eq('owner_email', ownerEmail).maybeSingle();
    if (error) { console.error('[market-report] owner load failed:', error.message); return null; }
    return (data as SavedReport) || null;
  } catch (err) {
    console.error('[market-report] owner load threw:', err);
    return null;
  }
}

/** The owner's reports, newest first, without payloads. `null` = storage error (unknown, never "none"). */
export async function listOwnedMarketReports(ownerEmail: string, limit = 50): Promise<OwnedReportSummary[] | null> {
  const sb = client();
  if (!sb || !ownerEmail) return null;
  try {
    const n = Math.min(Math.max(limit, 1), 100);
    const first = await sb.from('market_reports').select(OWNER_LIST_COLUMNS).eq('owner_email', ownerEmail)
      .order('created_at', { ascending: false }).limit(n);
    let rows: unknown[] | null = first.data;
    let error = first.error;
    if (error && missingLinkColumns(error)) {
      // Before the migration: no link columns yet, so every link is live (null expiry, not revoked).
      const legacy = await sb.from('market_reports').select('id, subject, client_name, created_at').eq('owner_email', ownerEmail)
        .order('created_at', { ascending: false }).limit(n);
      rows = legacy.data;
      error = legacy.error;
    }
    if (error) { console.error('[market-report] owner list failed:', error.message); return null; }
    return ((rows as OwnedReportSummary[]) || []);
  } catch (err) {
    console.error('[market-report] owner list threw:', err);
    return null;
  }
}

/** Update an owner's row; true only when exactly their row changed. Never deletes the report. */
async function updateOwned(id: string, ownerEmail: string, patch: Partial<Pick<SavedReport, 'expires_at' | 'revoked_at'>>): Promise<boolean> {
  const sb = client();
  if (!sb || !id || !ownerEmail) return false;
  try {
    const { count, error } = await sb.from('market_reports').update(patch, { count: 'exact' }).eq('id', id).eq('owner_email', ownerEmail);
    if (error) { console.error('[market-report] owner update failed:', error.message); return false; }
    return count === 1;
  } catch (err) {
    console.error('[market-report] owner update threw:', err);
    return false;
  }
}

/** Revoke the public link now. The report stays (the owner can still open it). */
export function revokeOwnedReportLink(id: string, ownerEmail: string, nowMs: number = Date.now()): Promise<boolean> {
  return updateOwned(id, ownerEmail, { revoked_at: new Date(nowMs).toISOString() });
}

/** New expiry when extending: from the later of now and the current expiry. */
export function extendedExpiry(currentExpiresAt: string | null | undefined, days: number, nowMs: number = Date.now()): string {
  const cur = currentExpiresAt ? Date.parse(currentExpiresAt) : NaN;
  const base = Number.isFinite(cur) ? Math.max(cur, nowMs) : nowMs;
  return new Date(base + days * 86_400_000).toISOString();
}

export function setOwnedReportExpiry(id: string, ownerEmail: string, expiresAt: string): Promise<boolean> {
  return updateOwned(id, ownerEmail, { expires_at: expiresAt });
}

/** The ONLY path that removes a report: the owner's explicit delete. */
export async function deleteOwnedMarketReport(id: string, ownerEmail: string): Promise<boolean> {
  const sb = client();
  if (!sb || !id || !ownerEmail) return false;
  try {
    const { count, error } = await sb.from('market_reports').delete({ count: 'exact' }).eq('id', id).eq('owner_email', ownerEmail);
    if (error) { console.error('[market-report] owner delete failed:', error.message); return false; }
    return count === 1;
  } catch (err) {
    console.error('[market-report] owner delete threw:', err);
    return false;
  }
}
