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
    const { error } = await sb.from('market_reports').insert({
      id,
      owner_email: input.ownerEmail,
      subject: input.subject,
      client_name: input.clientName || null,
      params: input.params,
      payload: input.payload,
    });
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
