/**
 * POST /api/app/vault/documents/commit
 *   { email, document_id, selections: {
 *       overview?: {...}, identity?: {...},
 *       past_performance?: ParsedPP[], capabilities?: ParsedCap[]
 *   } }
 *
 * The ONE transactional save for a parsed capability statement. The review modal
 * sends the pieces the user KEPT; this route normalizes every value server-side
 * (via lib/vault/normalize) and writes them in batch, then returns an honest
 * per-section summary of what saved and what was skipped (with reasons).
 *
 * Why this route exists (the long-term fix): the client used to fire ~30 separate
 * POSTs, each re-deriving the parser→column mapping, with best-effort error
 * handling. Every mismatch (string vs numeric value, period split, a missing-agency
 * 400) silently dropped rows. Centralizing here kills that whole bug class:
 *   - coercion lives once, next to the columns (shared with the manual forms),
 *   - one call → one authoritative response (no partial/silent failure),
 *   - batch inserts so one bad row can't strand the rest.
 *
 * Grounding (#1): normalization never invents facts; website is dropped unless its
 * host appears in the doc text; a missing agency gets a VISIBLE placeholder, not a
 * fabricated one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { invalidateCapabilityVector } from '@/lib/alerts/capability-vector';
import {
  normalizePastPerf, normalizeCapability, normalizeIdentity,
  type ParsedPP, type ParsedCap, type ParsedIdentity,
} from '@/lib/vault/normalize';
import { embedVaultRow } from '@/lib/vault/embed-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

interface Selections {
  overview?: { one_liner?: unknown; elevator_pitch?: unknown };
  identity?: ParsedIdentity;
  past_performance?: ParsedPP[];
  capabilities?: ParsedCap[];
}

/**
 * Additively sync Vault NAICS into the alert filter (user_notification_settings).
 * Mirrors the identity route: ADD codes the alert filter is missing, never
 * overwrite the user's tuned picks. Non-fatal.
 */
async function syncNaicsToAlerts(userEmail: string, naics: string[]): Promise<number> {
  if (!naics.length) return 0;
  try {
    const sb = getSupabase();
    const { data: ns } = await sb
      .from('user_notification_settings')
      .select('naics_codes')
      .eq('user_email', userEmail)
      .maybeSingle();
    const current: string[] = Array.isArray(ns?.naics_codes) ? ns!.naics_codes.map(String) : [];
    const currentSet = new Set(current);
    const missing = naics.filter((c) => !currentSet.has(c));
    if (!missing.length) return 0;
    await sb.from('user_notification_settings').upsert(
      { user_email: userEmail, naics_codes: [...current, ...missing], updated_at: new Date().toISOString() },
      { onConflict: 'user_email' },
    );
    return missing.length;
  } catch (e) {
    console.error('[vault/commit] NAICS sync failed:', (e as Error)?.message);
    return 0;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const documentId = String(body.document_id || '').trim();
  const selections: Selections = body.selections || {};
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;
  const sb = getSupabase();

  // Load the doc's source text (owner-scoped) — used to ground the website field.
  // Optional: commit still works if no document_id is given.
  let sourceText = '';
  if (documentId) {
    const { data: doc } = await sb
      .from('user_boilerplate_docs')
      .select('extracted_text')
      .eq('id', documentId)
      .eq('user_email', userEmail)
      .maybeSingle();
    sourceText = String(doc?.extracted_text || '');
  }

  const skipped: { section: string; item: string; reason: string }[] = [];
  const saved = { identity: 0, past_performance: 0, capabilities: 0 };
  let alertNaicsAdded = 0;

  // 1) Identity + Overview → one upsert (preserves untouched columns).
  const identityPatch = normalizeIdentity(selections.overview, selections.identity, sourceText);
  if (Object.keys(identityPatch).length > 0) {
    const row = { ...identityPatch, user_email: userEmail, updated_at: new Date().toISOString(), capability_embedded_at: null };
    const { error } = await sb.from('user_identity_profile').upsert(row, { onConflict: 'user_email' });
    if (error) skipped.push({ section: 'identity', item: 'company info', reason: error.message });
    else {
      saved.identity = 1;
      if (Array.isArray(identityPatch.primary_naics)) {
        alertNaicsAdded = await syncNaicsToAlerts(userEmail, identityPatch.primary_naics);
      }
    }
  }

  // 2) Past performance → batch insert (normalize each; skip only true no-ops).
  const ppInput = Array.isArray(selections.past_performance) ? selections.past_performance : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ppRows: Record<string, any>[] = [];
  for (const p of ppInput) {
    const { row, skipReason } = normalizePastPerf(p);
    if (!row) { skipped.push({ section: 'past_performance', item: String((p as { contract_title?: unknown }).contract_title || '(untitled)'), reason: skipReason || 'invalid' }); continue; }
    ppRows.push({ ...row, user_email: userEmail, source: 'manual' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertedPP: any[] = [];
  if (ppRows.length) {
    const { data, error } = await sb.from('user_past_performance').insert(ppRows)
      .select('id, contract_title, agency, sub_agency, role, scope_description, outcomes, relevance_keywords, naics_codes');
    if (error) {
      // Batch failed as a unit — fall back to per-row so one bad row can't sink all.
      for (const r of ppRows) {
        const { data: one, error: e2 } = await sb.from('user_past_performance').insert(r)
          .select('id, contract_title, agency, sub_agency, role, scope_description, outcomes, relevance_keywords, naics_codes').maybeSingle();
        if (e2) skipped.push({ section: 'past_performance', item: r.contract_title, reason: e2.message });
        else { saved.past_performance += 1; if (one) insertedPP.push(one); }
      }
    } else {
      saved.past_performance = data?.length ?? ppRows.length;
      if (data) insertedPP.push(...data);
    }
  }

  // 3) Capabilities → batch insert.
  const capInput = Array.isArray(selections.capabilities) ? selections.capabilities : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capRows: Record<string, any>[] = [];
  for (const c of capInput) {
    const { row, skipReason } = normalizeCapability(c);
    if (!row) { skipped.push({ section: 'capabilities', item: String((c as { capability_name?: unknown }).capability_name || '(unnamed)'), reason: skipReason || 'invalid' }); continue; }
    capRows.push({ ...row, user_email: userEmail });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertedCaps: any[] = [];
  if (capRows.length) {
    const { data, error } = await sb.from('user_capabilities_library').insert(capRows)
      .select('id, capability_name, description, evidence, keywords, related_naics, tools_methods');
    if (error) {
      for (const r of capRows) {
        const { data: one, error: e2 } = await sb.from('user_capabilities_library').insert(r)
          .select('id, capability_name, description, evidence, keywords, related_naics, tools_methods').maybeSingle();
        if (e2) skipped.push({ section: 'capabilities', item: r.capability_name, reason: e2.message });
        else { saved.capabilities += 1; if (one) insertedCaps.push(one); }
      }
    } else {
      saved.capabilities = data?.length ?? capRows.length;
      if (data) insertedCaps.push(...data);
    }
  }

  // Embed-on-write → pgvector (powers the proposal requirement→evidence matcher).
  // Best-effort + inline: a Vault import is low-frequency and the user expects the
  // save to "settle", so we embed the just-inserted rows now (each embedVaultRow is
  // self-guarded and never throws). A failed embed just leaves embedding NULL — the
  // backfill script / a later save picks it up.
  const embedStamp = new Date().toISOString();
  await Promise.all([
    ...insertedPP.map((r) => embedVaultRow(sb, 'past_performance', r, embedStamp)),
    ...insertedCaps.map((r) => embedVaultRow(sb, 'capability', r, embedStamp)),
  ]);

  // Past-perf + capabilities + identity all feed the (legacy) capability vector too.
  if (saved.past_performance || saved.capabilities || saved.identity) {
    void invalidateCapabilityVector(userEmail);
  }

  const totalSaved = saved.identity + saved.past_performance + saved.capabilities;
  return NextResponse.json({
    success: true,
    saved,
    total_saved: totalSaved,
    skipped,
    alert_naics_added: alertNaicsAdded,
  });
}
