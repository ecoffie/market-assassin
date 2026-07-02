/**
 * Vault evidence embedding — the ONE place that turns a Vault row (past
 * performance, capability, or key person) into the text we embed and writes the
 * vector into its pgvector column.
 *
 * Substrate: native Postgres pgvector (migration 20260702_vault_pgvector.sql),
 * NOT the legacy JSONB-in-JS-cosine path — this scales to millions of rows via
 * the ivfflat index + match_vault_evidence RPC.
 *
 * IMPORTANT (the gotcha): a pgvector column does NOT accept a JS number[] over
 * PostgREST. It must be the pgvector TEXT form '[0.1,0.2,...]'. toPgVector()
 * handles that; pass its output as the column value.
 */
import { embedText } from '@/lib/market/embeddings';

// pgvector text input form. supabase-js sends this string; Postgres casts it to
// vector(1536). A JS array would be rejected / silently wrong.
export function toPgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

// ---- Per-kind "what text represents this row" ------------------------
// Embed the MEANING of the evidence, not just the title — scope/description is
// where the requirement match actually lives.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pastPerfEmbedText(row: any): string {
  return [
    row.contract_title,
    row.agency,
    row.sub_agency,
    row.role,
    row.scope_description,
    row.outcomes,
    Array.isArray(row.relevance_keywords) ? row.relevance_keywords.join(' ') : '',
    Array.isArray(row.naics_codes) ? row.naics_codes.join(' ') : '',
  ].filter(Boolean).join('. ').trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capabilityEmbedText(row: any): string {
  return [
    row.capability_name,
    row.description,
    row.evidence,
    Array.isArray(row.keywords) ? row.keywords.join(' ') : '',
    Array.isArray(row.related_naics) ? row.related_naics.join(' ') : '',
    Array.isArray(row.tools_methods) ? row.tools_methods.join(' ') : '',
  ].filter(Boolean).join('. ').trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function personEmbedText(row: any): string {
  return [
    row.full_name,
    row.title,
    row.role_type,
    row.security_clearance,
    Array.isArray(row.certifications) ? row.certifications.join(' ') : '',
    row.bio_short,
    row.bio_full,
  ].filter(Boolean).join('. ').trim();
}

export type VaultKind = 'past_performance' | 'capability' | 'person';

const TABLE: Record<VaultKind, string> = {
  past_performance: 'user_past_performance',
  capability: 'user_capabilities_library',
  person: 'user_team_members',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TEXT_FN: Record<VaultKind, (row: any) => string> = {
  past_performance: pastPerfEmbedText,
  capability: capabilityEmbedText,
  person: personEmbedText,
};

/**
 * Embed one Vault row and write the vector to its pgvector column. Best-effort:
 * returns true on success, false on any failure (never throws — embedding is an
 * enhancement, a failure must not break the save). `stampIso` lets a batch pass a
 * single deterministic timestamp (Date.now() is unavailable in some runners).
 */
export async function embedVaultRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  kind: VaultKind,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  stampIso: string,
): Promise<boolean> {
  try {
    const text = TEXT_FN[kind](row);
    if (!text || text.length < 3) return false;
    const vec = await embedText(text);
    const { error } = await sb
      .from(TABLE[kind])
      .update({ embedding: toPgVector(vec), embedded_at: stampIso })
      .eq('id', row.id);
    return !error;
  } catch {
    return false;
  }
}
