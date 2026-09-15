/**
 * PATHWAY FIT v0 — load stranger-verifiable company record for a UEI.
 * No vault upgrade. No vehicle-portfolio invention.
 */
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
import { getCachedCerts, certBucketsWithSource, type CertBucket } from '@/lib/sam/recipient-certs';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import type { CompanyCertFact, CompanyPublicRecord } from './pathway-fit-types';

const BUCKET_LABEL: Record<CertBucket, string> = {
  '8A': '8(a)',
  SDVOSB: 'SDVOSB',
  WOSB: 'WOSB',
  HZ: 'HUBZone',
};

export async function loadCompanyPublicRecord(opts: {
  uei?: string;
  company_name?: string;
  actor?: string;
}): Promise<{ company: CompanyPublicRecord; sources_queried: string[]; sources_failed: string[]; degraded: boolean }> {
  const sources_queried: string[] = [];
  const sources_failed: string[] = [];
  let degraded = false;

  const uei = (opts.uei || '').trim().toUpperCase();
  if (!uei || !isWellFormedUei(uei)) {
    return {
      company: {
        uei: null,
        legal_name: opts.company_name || null,
        cage: null,
        identity_source: 'unresolved',
        certifications: [],
        awards: [],
        verified_vehicle_holds: [],
        ot_nontraditional_established: false,
      },
      sources_queried,
      sources_failed,
      degraded: false,
    };
  }

  sources_queried.push('history_by_uei');
  let legal_name: string | null = opts.company_name || null;
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
    sources_queried,
    sources_failed,
    degraded,
  };
}
