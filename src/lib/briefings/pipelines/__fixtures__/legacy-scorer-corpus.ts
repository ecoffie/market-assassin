/**
 * Corpus for the legacy-scorer equality test. Real notices (the frozen alert case) plus
 * variants that exercise every branch the legacy scorer has: exact / partial NAICS, the
 * substring agency match (incl. its known NIST ⊂ "ADMINISTRATION" behaviour, preserved on
 * purpose), keyword hits, business-description terms, deadline windows, set-aside certs,
 * SAM's NONE literal, VA downrank, research notices.
 */
import type { SAMOpportunity } from '../sam-gov';
import { CASE_PROFILE } from '@/lib/alerts/__fixtures__/alert-relevance-case';

export const LEGACY_PROFILES = {
  aiFirm: { ...CASE_PROFILE },
  noKeywords: { ...CASE_PROFILE, keywords: [] as string[] },
  wosbWithDescription: {
    naics_codes: ['541611', '5415'], agencies: ['VA', 'NIST', 'Commerce'], keywords: ['program management', 'records management', 'compliance'],
    business_description: 'Program management and records management support for federal health agencies.',
    setAsides: ['WOSB'], business_type: 'Women-Owned Small Business',
  },
  nonVeteran: { naics_codes: ['541330'], agencies: ['Navy'], keywords: ['engineering support'], business_description: null, business_type: 'Small Business' },
  bare: { naics_codes: [] as string[], agencies: [] as string[], keywords: [] as string[], business_description: null, business_type: null },
};

const DAY = 864e5;
export function legacyCorpus(real: SAMOpportunity[]): SAMOpportunity[] {
  const base = real[0];
  const at = (days: number) => new Date(Date.parse('2026-09-24T03:44:00Z') + days * DAY).toISOString();
  const variants: Partial<SAMOpportunity>[] = [
    { noticeId: 'v1', naicsCode: '541611', setAside: 'WOSB', setAsideDescription: 'Women-Owned Small Business', responseDeadline: at(5) },
    { noticeId: 'v2', naicsCode: '541330', setAside: 'SDVOSBC', setAsideDescription: 'Service-Disabled Veteran-Owned Small Business', noticeType: 'Solicitation', responseDeadline: at(12) },
    { noticeId: 'v3', naicsCode: '541330', setAside: 'SDVOSBC', setAsideDescription: 'Service-Disabled Veteran-Owned', noticeType: 'Sources Sought', responseDeadline: at(25) },
    { noticeId: 'v4', department: 'VETERANS AFFAIRS, DEPARTMENT OF', subTier: 'VETERANS AFFAIRS, DEPARTMENT OF', noticeType: 'Solicitation', responseDeadline: at(40) },
    { noticeId: 'v5', department: 'TRANSPORTATION, DEPARTMENT OF', subTier: 'FEDERAL HIGHWAY ADMINISTRATION', setAside: 'NONE', responseDeadline: at(3) },
    { noticeId: 'v6', naicsCode: '5415', title: 'Records Management and Program Management Services', description: 'compliance with NARA', responseDeadline: '' },
    { noticeId: 'v7', naicsCode: '541519', setAside: 'SBA', setAsideDescription: 'Total Small Business Set-Aside (FAR 19.5)', responseDeadline: at(8) },
    { noticeId: 'v8', naicsCode: '236220', title: 'Roof replacement', description: '', department: 'DEPT OF DEFENSE', subTier: 'DEPT OF THE NAVY', responseDeadline: at(60) },
  ];
  return [...real, ...variants.map((v) => ({ ...base, ...v }) as SAMOpportunity)];
}
