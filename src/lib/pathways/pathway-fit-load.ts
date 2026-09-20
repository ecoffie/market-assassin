/**
 * PATHWAY FIT v0 — load stranger-verifiable company record.
 * Identity: UEI is authoritative. Company name uses the canonical
 * award-warehouse seam (`resolveAwardCorpusByName`, #1548) — unique match
 * loads by UEI; ambiguous never auto-picks; none is a dataset miss, not
 * “no federal awards”. No second resolver. No vault upgrade. No vehicle
 * portfolio invention.
 */
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
import {
  resolveAwardCorpusByName,
  type AwardNameCandidate,
} from '@/lib/contractor/name-resolution';
import { getCachedCerts, certBucketsWithSource, type CertBucket } from '@/lib/sam/recipient-certs';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import type { CompanyCertFact, CompanyPublicRecord, MatchCompanyToPathwaysResult } from './pathway-fit-types';

const BUCKET_LABEL: Record<CertBucket, string> = {
  '8A': '8(a)',
  SDVOSB: 'SDVOSB',
  WOSB: 'WOSB',
  HZ: 'HUBZone',
};

export type PathwayIdentityResolution = NonNullable<
  MatchCompanyToPathwaysResult['_meta']['identity_resolution']
>;

export interface ResolvedPathwayIdentity {
  uei: string | null;
  legal_name: string | null;
  resolution: PathwayIdentityResolution;
  name_match?: 'sole_hit' | 'exact_stem' | 'exact_dba_stem' | 'slug';
  match_count?: number;
  candidates?: AwardNameCandidate[];
  note?: string;
}

/**
 * Canonical identity seam for PATHWAY FIT. Delegates name matching to
 * `resolveAwardCorpusByName` — same unique / ambiguous / none / degraded
 * contract as get_contractor_profile and get_contractor_award_history.
 */
export async function resolvePathwayFitIdentity(opts: {
  uei?: string;
  company_name?: string;
}): Promise<ResolvedPathwayIdentity> {
  const uei = (opts.uei || '').trim().toUpperCase();
  if (uei) {
    if (!isWellFormedUei(uei)) {
      return {
        uei: null,
        legal_name: (opts.company_name || '').trim() || null,
        resolution: 'malformed',
        note: 'UEI must be exactly 12 alphanumeric characters.',
      };
    }
    return {
      uei,
      legal_name: (opts.company_name || '').trim() || null,
      resolution: 'uei',
    };
  }

  const name = (opts.company_name || '').trim();
  if (!name) {
    return {
      uei: null,
      legal_name: null,
      resolution: 'unresolved',
      note: 'Pass a UEI or a unique company name.',
    };
  }

  const named = await resolveAwardCorpusByName(name);
  if (named.status === 'unique') {
    return {
      uei: named.uei,
      legal_name: named.name,
      resolution: 'unique_name',
      name_match: named.match,
    };
  }
  if (named.status === 'ambiguous') {
    return {
      uei: null,
      legal_name: name,
      resolution: 'ambiguous',
      match_count: named.match_count,
      candidates: named.candidates,
      note: named.note,
    };
  }
  if (named.status === 'degraded') {
    return {
      uei: null,
      legal_name: name,
      resolution: 'degraded',
      note: named.detail,
    };
  }
  return {
    uei: null,
    legal_name: name,
    resolution: 'none_in_award_corpus',
    note:
      'No award-warehouse recipient matched this name. That is this dataset only — not proof of no federal awards.',
  };
}

export async function loadCompanyPublicRecord(opts: {
  uei?: string;
  company_name?: string;
  actor?: string;
}): Promise<{
  company: CompanyPublicRecord;
  identity: ResolvedPathwayIdentity;
  sources_queried: string[];
  sources_failed: string[];
  degraded: boolean;
}> {
  const sources_queried: string[] = [];
  const sources_failed: string[] = [];
  let degraded = false;

  sources_queried.push('award_corpus_name_to_uei');
  const identity = await resolvePathwayFitIdentity({
    uei: opts.uei,
    company_name: opts.company_name,
  });

  const emptyCompany = (legal_name: string | null): CompanyPublicRecord => ({
    uei: null,
    legal_name,
    cage: null,
    identity_source: 'unresolved',
    certifications: [],
    awards: [],
    verified_vehicle_holds: [],
    ot_nontraditional_established: false,
  });

  if (!identity.uei) {
    if (identity.resolution === 'degraded') {
      sources_failed.push('award_corpus_name_to_uei');
      degraded = true;
    }
    return {
      company: emptyCompany(identity.legal_name),
      identity,
      sources_queried,
      sources_failed,
      degraded,
    };
  }

  const uei = identity.uei;
  sources_queried.push('history_by_uei');
  let legal_name: string | null = identity.legal_name;
  let identity_source: CompanyPublicRecord['identity_source'] = 'unresolved';
  const awards: CompanyPublicRecord['awards'] = [];

  try {
    const hist = await getContractorHistoryByUei({
      uei,
      actor: opts.actor || 'pathway-fit',
      coldPolicy: 'budgeted',
    });
    if (hist.resolution === 'found' || hist.resolution === 'registered_zero') {
      legal_name = hist.name || legal_name;
      identity_source = hist.source === 'bigquery_normalized' ? 'bq_recipient' : 'sam_entity';
      const recent = hist.history?.recentAwards || [];
      for (const a of recent) {
        awards.push({
          id: a.id,
          title: a.title,
          agency: a.agency,
          naics: a.naics,
          amount: a.amount,
          startDate: a.startDate,
          endDate: a.endDate,
          description: a.title,
          parent_idv: null, // v0: do not invent vehicle portfolio from history
        });
      }
      if (hist.degraded) degraded = true;
    } else if (hist.resolution === 'unavailable') {
      sources_failed.push('history_by_uei');
      degraded = true;
    }
  } catch {
    sources_failed.push('history_by_uei');
    degraded = true;
  }

  sources_queried.push('recipient_certifications');
  const certifications: CompanyCertFact[] = [];
  try {
    const map = await getCachedCerts([uei]);
    const cert = map.get(uei);
    for (const b of certBucketsWithSource(cert)) {
      certifications.push({
        code: b.bucket,
        label: BUCKET_LABEL[b.bucket],
        provenance_state: (b.source || 'unknown') as CompanyCertFact['provenance_state'],
        authoritative: b.authoritative,
      });
    }
  } catch {
    sources_failed.push('recipient_certifications');
    degraded = true;
  }

  return {
    company: {
      uei,
      legal_name,
      cage: null,
      identity_source,
      certifications,
      awards,
      verified_vehicle_holds: [], // never invent
      ot_nontraditional_established: false, // never infer
    },
    identity,
    sources_queried,
    sources_failed,
    degraded,
  };
}
