/**
 * STRATEGIC INTELLIGENCE — turns Institute evidence into foresight.
 *
 *   Institute corpus (institute_sources)  ->  THIS LAYER  ->  pain point / priority /
 *                                                             funding / policy / buying signal
 *
 * The Institute owns the document. This layer only asks: *does this evidence
 * defensibly change what we claim about an agency?*
 *
 * ⚠️ "REPORT EXISTS" IS NOT "PAIN POINT EXISTS". Evidence-only is a first-class,
 * successful outcome. The legacy corpus was built by assuming every GAO title was a
 * pain point, which is how "Air Traffic Control" became a NASA pain point. Unknown
 * beats an invented insight.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgencyResolution } from './agency-resolver';

export type DerivationOutcome =
  | 'evidence_only_unresolved'      // no canonical agency -> nothing can be claimed
  | 'evidence_only_not_defensible'  // resolved, but the document states no problem
  | 'pain_point_created'
  | 'pain_point_unchanged'          // already claimed; no new history
  | 'blocked_history_unavailable';  // refused to advance state without a change record

export interface DerivationResult {
  documentNumber: string;
  outcome: DerivationOutcome;
  changeLogged: boolean;
  entityKey?: string;
  error?: string;
}

/**
 * GAO's own vocabulary for "something is wrong here". A neutral status report
 * ("Priority Open Recommendations: Department of State") states no problem and must
 * NOT become a pain point.
 */
const PROBLEM_MARKERS =
  /\b(needed|needs|should|improve|improvements?|challenges?|weakness(es)?|deficienc\w*|risks?|gaps?|lacks?|failed|shortfalls?|oversight|vulnerab\w*|delays?)\b/i;

export function isDefensiblePainPoint(title: string, resolution: AgencyResolution): boolean {
  if (!resolution.resolved || !resolution.canonicalAgency) return false;
  return PROBLEM_MARKERS.test(title);
}

/**
 * Evaluate ONE Institute source. Writes at most one pain point, and only alongside a
 * successful change record.
 *
 * ORDERING IS THE CONTRACT (the recompete_changes lesson): the change record is
 * written FIRST, and if it fails the derived state is NOT advanced. A mutation must
 * never be able to succeed while its history silently fails.
 */
export async function deriveFromInstituteSource(
  db: SupabaseClient,
  source: {
    instituteSourceId: string | null;
    documentNumber: string;
    title: string;
    url: string;
    resolution: AgencyResolution;
  },
): Promise<DerivationResult> {
  const { resolution } = source;

  if (!resolution.resolved || !resolution.canonicalAgency) {
    return { documentNumber: source.documentNumber, outcome: 'evidence_only_unresolved', changeLogged: false };
  }
  if (!isDefensiblePainPoint(source.title, resolution)) {
    return { documentNumber: source.documentNumber, outcome: 'evidence_only_not_defensible', changeLogged: false };
  }

  const agency = resolution.canonicalAgency;
  const claim = `${source.title} (Source: ${source.documentNumber})`;
  const entityKey = `${agency}::${claim}`;

  const { data: prior } = await db
    .from('agency_pain_points_db')
    // unranged-ok: single row by the unique (agency, pain_point) key.
    .select('id')
    .eq('agency', agency).eq('pain_point', claim).maybeSingle();
  if (prior) {
    return { documentNumber: source.documentNumber, outcome: 'pain_point_unchanged', changeLogged: false, entityKey };
  }

  const changedAt = new Date().toISOString();
  const { error: histErr } = await db.from('intelligence_changes').insert({
    domain: 'pain_point',
    canonical_agency: agency,
    entity_key: entityKey,
    change_type: 'created',
    old_value: null,
    new_value: claim,
    institute_source_id: source.instituteSourceId,
    changed_at: changedAt,
  });
  if (histErr) {
    // History could not be preserved -> REFUSE to advance derived state.
    return { documentNumber: source.documentNumber, outcome: 'blocked_history_unavailable', changeLogged: false, entityKey, error: histErr.message };
  }

  const { error: ppErr } = await db.from('agency_pain_points_db').insert({
    agency,
    pain_point: claim,
    source: 'gao',
    source_url: source.url,
    status: 'emerging',
    confidence: resolution.confidence === 'high' ? 'medium' : 'low',
    institute_source_ids: source.instituteSourceId ? [source.instituteSourceId] : null,
    first_seen: changedAt,
    last_evidence_at: changedAt,
    verified: false,
  });
  if (ppErr) {
    return { documentNumber: source.documentNumber, outcome: 'blocked_history_unavailable', changeLogged: true, entityKey, error: ppErr.message };
  }

  return { documentNumber: source.documentNumber, outcome: 'pain_point_created', changeLogged: true, entityKey };
}
