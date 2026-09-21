/**
 * Decision Makers — the identity read path.
 *
 * THREE CONCEPTS, deliberately not merged:
 *   OBSERVATION  a `federal_contacts` row: one POC slot on one notice.
 *   IDENTITY     a person, keyed on normalized personal email.
 *   ROLE         where an identity acts (agency / sub-tier / office).
 *
 * This module only READS the views added by
 * `supabase/migrations/20260920_decision_maker_identity.sql`. Classification
 * lives in SQL and is NOT mirrored here — two implementations of one rule is the
 * drift bug this codebase keeps paying for.
 *
 * Measured on production 2026-09-20:
 *   23,201 identities from 212,415 government observations
 *     · 17,605 person        (161,395 observations)
 *     ·  5,414 unknown       ( 48,651 observations)
 *     ·    182 role_mailbox  (  2,366 observations)
 *
 * `unknown` is 23% and is NOT promoted to `person`. A missing result beats a
 * misleading one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type IdentityKind = 'person' | 'role_mailbox' | 'unknown';

export interface DecisionMakerIdentity {
  identityEmail: string;
  identityKind: IdentityKind;
  observationCount: number;
  agencyCount: number;
  solicitationCount: number;
  firstSeenPosted: string | null;
  lastSeenPosted: string | null;
  lastObservedAt: string | null;
  /** Display only. NEVER an identity key — stored names include "Telephone: 7176053992". */
  latestObservedName: string | null;
  latestObservedTitle: string | null;
}

export interface DecisionMakerRole {
  identityEmail: string;
  identityKind: IdentityKind;
  agency: string | null;
  subTier: string | null;
  office: string | null;
  roleCategory: string | null;
  observationCount: number;
  firstSeenPosted: string | null;
  lastSeenPosted: string | null;
}

interface IdentityRow {
  identity_email: string;
  identity_kind: string;
  observation_count: number;
  agency_count: number;
  solicitation_count: number;
  first_seen_posted: string | null;
  last_seen_posted: string | null;
  last_observed_at: string | null;
  latest_observed_name: string | null;
  latest_observed_title: string | null;
}

const asKind = (k: string): IdentityKind =>
  k === 'person' || k === 'role_mailbox' ? k : 'unknown';

function toIdentity(r: IdentityRow): DecisionMakerIdentity {
  return {
    identityEmail: r.identity_email,
    identityKind: asKind(r.identity_kind),
    observationCount: Number(r.observation_count),
    agencyCount: Number(r.agency_count),
    solicitationCount: Number(r.solicitation_count),
    firstSeenPosted: r.first_seen_posted,
    lastSeenPosted: r.last_seen_posted,
    lastObservedAt: r.last_observed_at,
    latestObservedName: r.latest_observed_name,
    latestObservedTitle: r.latest_observed_title,
  };
}

/**
 * Look up ONE identity by email.
 *
 * Returns null when the address is not held. Null means "not established", never
 * "this person does not exist" — callers must not render it as an absence claim.
 */
export async function getIdentityByEmail(
  db: SupabaseClient,
  email: string,
): Promise<DecisionMakerIdentity | null> {
  const key = email.trim().toLowerCase();
  if (!key) return null;
  const { data, error } = await db
    .from('decision_maker_identities')
    // unranged-ok: single row by the view's unique identity_email key.
    .select('*')
    .eq('identity_email', key)
    .maybeSingle();
  if (error) throw new Error(`getIdentityByEmail(${key}): ${error.message}`);
  return data ? toIdentity(data as IdentityRow) : null;
}

/**
 * PEOPLE for an agency.
 *
 * Defaults to `person` only. A role mailbox is not a person: `dibbsbsm@dla.mil`
 * carries 45,924 upstream slots and its "name" is a paragraph of filing
 * instructions. Pass `includeKinds` to widen deliberately — never by accident.
 */
export async function listAgencyIdentities(
  db: SupabaseClient,
  agency: string,
  opts: { includeKinds?: IdentityKind[]; limit?: number } = {},
): Promise<DecisionMakerIdentity[]> {
  const kinds = opts.includeKinds ?? ['person'];
  const limit = opts.limit ?? 200;
  const { data, error } = await db
    .from('decision_maker_roles')
    .select('identity_email')
    .eq('agency', agency)
    .in('identity_kind', kinds)
    .order('observation_count', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listAgencyIdentities(${agency}): ${error.message}`);
  const emails = [...new Set((data ?? []).map((r) => (r as { identity_email: string }).identity_email))];
  if (emails.length === 0) return [];

  const { data: ids, error: idErr } = await db
    .from('decision_maker_identities')
    .select('*')
    .in('identity_email', emails)
    .limit(emails.length);
  if (idErr) throw new Error(`listAgencyIdentities identities(${agency}): ${idErr.message}`);
  return (ids ?? []).map((r) => toIdentity(r as IdentityRow));
}

/**
 * The roles ONE identity holds. An identity legitimately holds several — a move
 * between offices shows as two roles, never as an overwritten identity.
 */
export async function getRolesForIdentity(
  db: SupabaseClient,
  email: string,
): Promise<DecisionMakerRole[]> {
  const key = email.trim().toLowerCase();
  if (!key) return [];
  const { data, error } = await db
    .from('decision_maker_roles')
    .select('*')
    .eq('identity_email', key)
    .order('observation_count', { ascending: false })
    .limit(200);
  if (error) throw new Error(`getRolesForIdentity(${key}): ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      identityEmail: String(row.identity_email),
      identityKind: asKind(String(row.identity_kind)),
      agency: (row.agency as string) ?? null,
      subTier: (row.sub_tier as string) ?? null,
      office: (row.office as string) ?? null,
      roleCategory: (row.role_category as string) ?? null,
      observationCount: Number(row.observation_count),
      firstSeenPosted: (row.first_seen_posted as string) ?? null,
      lastSeenPosted: (row.last_seen_posted as string) ?? null,
    };
  });
}

/**
 * Is this address safe to present as a PERSON?
 * `unknown` is not — 23% of the corpus is unknown and stays that way.
 */
export function isPresentableAsPerson(i: DecisionMakerIdentity): boolean {
  return i.identityKind === 'person';
}
