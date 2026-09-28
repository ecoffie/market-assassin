/**
 * P0-I — the ONE place that decides whether a company legal name may be written, and with
 * what provenance. Canonical store: `user_identity_profile.legal_name` (Vault / profile
 * domain). Provenance: `user_identity_profile.legal_name_source`
 * (migration 20260928_identity_legal_name_source.sql).
 *
 *   sam           grounded: matches SAM's legalBusinessName for the registered UEI
 *   user_entered  the owner typed or submitted it
 *   admin         an admin/staff tool set it
 *   NULL          UNKNOWN — every pre-migration row, and a submission SAM could not confirm.
 *                 Never inferred; never back-filled.
 *
 * Rules (Eric, P0-I decision 2026-09-28):
 *   - empty legal_name + onboarding typed name        → store it, user_entered
 *   - existing user_entered                            → the user may update it
 *   - existing sam                                     → onboarding must NOT overwrite it
 *   - a later grounded SAM identity                    → may supersede user_entered
 *   - admin writes                                     → keep explicit admin provenance
 *   - lookup failure / absence                         → unknown (NULL), never "sam"
 *
 * Also decided here (not spelled out in the ruling, chosen conservatively):
 *   - onboarding never overwrites a non-empty name of UNKNOWN provenance — it may be SAM's;
 *   - SAM never overwrites an admin-set name;
 *   - an explicit Vault identity edit by the owner (vault_edit) may replace any non-admin
 *     name and is stamped user_entered — it is the owner's own statement;
 *   - an identical value never downgrades provenance (re-saving a SAM name stays sam).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type LegalNameSource = 'sam' | 'user_entered' | 'admin';

/**
 * Who is writing:
 *   onboarding  /welcome/company typed name
 *   vault_edit  the owner's explicit Vault identity edit / confirmed document import
 *   sam         a value verified equal to SAM's legalBusinessName for the entity
 *   unverified  a SAM-prefill submission SAM could not confirm (lookup failed / no entity)
 *   admin       admin or staff tooling
 */
export type LegalNameWriter = 'onboarding' | 'vault_edit' | 'sam' | 'unverified' | 'admin';

export interface CurrentLegalName {
  legal_name: string | null;
  legal_name_source: LegalNameSource | null;
}

export type LegalNameDecision =
  | { action: 'write'; legal_name: string; legal_name_source: LegalNameSource | null; reason: string }
  | { action: 'keep'; reason: 'empty_input' | 'unchanged' | 'protected_sam' | 'protected_admin' | 'protected_unknown' };

const SOURCE_FOR: Record<LegalNameWriter, LegalNameSource | null> = {
  onboarding: 'user_entered',
  vault_edit: 'user_entered',
  sam: 'sam',
  unverified: null,
  admin: 'admin',
};

export function normalizeLegalName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/** Pure decision. `current` is null when the user has no Vault identity row. */
export function decideLegalNameWrite(
  current: CurrentLegalName | null,
  rawName: unknown,
  writer: LegalNameWriter,
): LegalNameDecision {
  const name = normalizeLegalName(rawName);
  if (!name) return { action: 'keep', reason: 'empty_input' };
  const source = SOURCE_FOR[writer];
  const existing = normalizeLegalName(current?.legal_name);
  const curSource = current?.legal_name_source ?? null;

  if (!existing) return { action: 'write', legal_name: name, legal_name_source: source, reason: 'was_empty' };

  if (existing === name) {
    // Same value: provenance may only be UPGRADED to a stronger, explicit claim.
    if (writer === 'admin' && curSource !== 'admin') return { action: 'write', legal_name: name, legal_name_source: 'admin', reason: 'admin_confirmed' };
    if (writer === 'sam' && curSource !== 'sam' && curSource !== 'admin') return { action: 'write', legal_name: name, legal_name_source: 'sam', reason: 'sam_confirmed' };
    return { action: 'keep', reason: 'unchanged' };
  }

  switch (writer) {
    case 'admin':
      return { action: 'write', legal_name: name, legal_name_source: 'admin', reason: 'admin_set' };
    case 'sam':
      if (curSource === 'admin') return { action: 'keep', reason: 'protected_admin' };
      return { action: 'write', legal_name: name, legal_name_source: 'sam', reason: 'sam_supersedes' };
    case 'vault_edit':
      if (curSource === 'admin') return { action: 'keep', reason: 'protected_admin' };
      return { action: 'write', legal_name: name, legal_name_source: 'user_entered', reason: 'owner_edit' };
    case 'onboarding':
    case 'unverified':
      if (curSource === 'user_entered') return { action: 'write', legal_name: name, legal_name_source: source, reason: 'user_update' };
      if (curSource === 'sam') return { action: 'keep', reason: 'protected_sam' };
      if (curSource === 'admin') return { action: 'keep', reason: 'protected_admin' };
      return { action: 'keep', reason: 'protected_unknown' };
  }
}

async function readCurrent(sb: SupabaseClient, email: string): Promise<{ row: CurrentLegalName | null; error?: string }> {
  const { data, error } = await sb
    .from('user_identity_profile')
    .select('legal_name, legal_name_source')
    .eq('user_email', email)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as CurrentLegalName | null) ?? null };
}

/**
 * For writers that upsert many Vault fields at once (Vault PUT, prefill, document import,
 * admin restore): returns the `{legal_name, legal_name_source}` keys to spread into the
 * row, or `{}` to leave the stored name alone. Callers MUST delete any `legal_name` they
 * copied from the request before spreading this.
 */
export async function resolveLegalNamePatch(
  sb: SupabaseClient,
  email: string,
  rawName: unknown,
  writer: LegalNameWriter,
): Promise<{ patch: Record<string, unknown>; decision: LegalNameDecision } | { error: string }> {
  const cur = await readCurrent(sb, email);
  if (cur.error) return { error: cur.error };
  const decision = decideLegalNameWrite(cur.row, rawName, writer);
  const patch = decision.action === 'write'
    ? { legal_name: decision.legal_name, legal_name_source: decision.legal_name_source }
    : {};
  return { patch, decision };
}

export type ApplyLegalNameResult =
  | { outcome: 'written'; reason: string; source: LegalNameSource | null }
  | { outcome: 'kept'; reason: string }
  | { outcome: 'failed'; error: string };

/**
 * Single-purpose guarded write (onboarding). The UPDATE is conditioned on the exact state
 * the decision was made from, so a concurrent SAM/admin write can never be overwritten by a
 * stale decision: a 0-row update re-reads and re-decides (once). Counted — a NULL count is
 * a failure, never success (INT-005).
 */
export async function applyLegalName(
  sb: SupabaseClient,
  rawEmail: string,
  rawName: unknown,
  writer: LegalNameWriter,
): Promise<ApplyLegalNameResult> {
  const email = rawEmail.toLowerCase().trim();
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await readCurrent(sb, email);
    if (cur.error) return { outcome: 'failed', error: cur.error };
    const d = decideLegalNameWrite(cur.row, rawName, writer);
    if (d.action === 'keep') return { outcome: 'kept', reason: d.reason };
    const now = new Date().toISOString();

    if (!cur.row) {
      const { count, error } = await sb
        .from('user_identity_profile')
        .upsert(
          { user_email: email, legal_name: d.legal_name, legal_name_source: d.legal_name_source, updated_at: now },
          { onConflict: 'user_email', ignoreDuplicates: true, count: 'exact' },
        );
      if (error) return { outcome: 'failed', error: error.message };
      if (count == null) return { outcome: 'failed', error: 'identity insert count unknown' };
      if (count === 1) return { outcome: 'written', reason: d.reason, source: d.legal_name_source };
      continue; // a row appeared concurrently — decide again against it
    }

    let q = sb
      .from('user_identity_profile')
      .update({ legal_name: d.legal_name, legal_name_source: d.legal_name_source, updated_at: now }, { count: 'exact' })
      .eq('user_email', email);
    q = cur.row.legal_name == null ? q.is('legal_name', null) : q.eq('legal_name', cur.row.legal_name);
    q = cur.row.legal_name_source == null ? q.is('legal_name_source', null) : q.eq('legal_name_source', cur.row.legal_name_source);
    const { count, error } = await q;
    if (error) return { outcome: 'failed', error: error.message };
    if (count == null) return { outcome: 'failed', error: 'identity update count unknown' };
    if (count === 1) return { outcome: 'written', reason: d.reason, source: d.legal_name_source };
    // state moved under us — re-read and re-decide once
  }
  return { outcome: 'failed', error: 'identity changed concurrently; not overwritten' };
}
