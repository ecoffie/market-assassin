/**
 * Solicitation Family v1 — required acceptance tests 1–20.
 * Fixture: MASA N0017426R1003 / N0017425RFPREQIHDMDept0002.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  extractAmendmentLabel,
  isSolicitationIdentifier,
  resolveFromCandidateRows,
  type SolicitationVersionRow,
} from '@/lib/sam/resolve-solicitation';
import {
  FAMILY_EVIDENCE,
  attachPursuitToFamily,
  buildFamilyView,
  detectFamilyNewVersion,
  extractConfirmedAliases,
  extractPrimaryDodaac,
  familyIdentityKey,
  gradeAwardRelationship,
  gradeForecastRelationship,
  groupRowsBySolicitationNumber,
  indexFamiliesByNoticeId,
  paeRelationshipForFamily,
  partitionConfirmedFamily,
  shouldMergeFamilies,
  shouldMergeOnTitleDodaacNaics,
  splitDocumentSets,
  type FamilyNoticeRow,
} from '@/lib/sam/solicitation-family';

const NOW = new Date('2026-09-18T18:00:00.000Z');

function row(partial: Partial<FamilyNoticeRow> & { notice_id: string }): FamilyNoticeRow {
  return {
    solicitation_number: 'N0017425RFPREQIHDMDept0002',
    title: 'Manufacturing & Services Acquisition (MASA) Manufacturing Support',
    department: 'DEPT OF DEFENSE',
    sub_tier: 'DEPT OF THE NAVY',
    office: 'NSWC INDIAN HEAD DIVISION',
    naics_code: '332710',
    psc_code: '1377',
    set_aside_description: 'Partial Small Business Set-Aside (FAR 19.5)',
    notice_type: 'Solicitation',
    posted_date: null,
    response_deadline: null,
    archive_date: null,
    active: false,
    description: null,
    ui_link: null,
    attachments: [],
    points_of_contact: [{ fullName: 'Diane Hicks', email: 'diane.hicks@navy.mil' }],
    ...partial,
  };
}

const ORIGINAL_ID = 'ce85c48dc296497eb902a0a73ac45680';
const AMD1_ID = 'd85b93617ae54e8e9b05b7e7a23ffe61';
const AMD2_ID = '8ca5ef19cc974f288722a8d5913cda5c';
const AMD3_ID = 'f1aa309fa39040a4929d90a7d88fd091';

const ORIGINAL: FamilyNoticeRow = row({
  notice_id: ORIGINAL_ID,
  posted_date: '2026-06-17T00:00:00+00:00',
  response_deadline: '2026-07-21T19:00:00+00:00',
  archive_date: '2026-08-05T00:00:00+00:00',
  description: 'The proposed contact action will be multiple award...\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026. Please refer to the attachments for more i',
  attachments: [{ filename: 'N0017426R1003.pdf' }],
});
const AMD1: FamilyNoticeRow = row({
  notice_id: AMD1_ID,
  posted_date: '2026-07-14T00:00:00+00:00',
  response_deadline: '2026-08-04T19:00:00+00:00',
  archive_date: '2026-08-19T00:00:00+00:00',
  description: 'Amendment 0001, extending the solicitation response/closing date and answering questions received in response to issuance of the solicitation, is posted as of 14 July 2026. Please see attachments.\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
});
const AMD2: FamilyNoticeRow = row({
  notice_id: AMD2_ID,
  posted_date: '2026-07-22T00:00:00+00:00',
  response_deadline: '2026-08-04T19:00:00+00:00',
  archive_date: '2026-08-19T00:00:00+00:00',
  description: 'Amendment 0002, answering a question received in response to issuance of the solicitation, is posted as of 22 July 2026. Please see attachments.\n\n Amendment 0001, extending the solicitation response/closing date...\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
  attachments: [{ filename: 'N0017426R1003_Amd0002.pdf' }],
});
const AMD3: FamilyNoticeRow = row({
  notice_id: AMD3_ID,
  posted_date: '2026-07-29T00:00:00+00:00',
  response_deadline: '2026-08-27T19:00:00+00:00',
  archive_date: '2026-09-11T00:00:00+00:00',
  description: 'Amendment 0003, extending the solicitation response/closing date and answering questions received in response to issuance of the solicitation, is posted as of 29 July 2026. Please see attachments.\n\nAmendment 0002...\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
  attachments: [],
});

const MASA = [ORIGINAL, AMD1, AMD2, AMD3];
const FAMILY_IDS = MASA.map((r) => r.notice_id);

const UNRELATED: FamilyNoticeRow = row({
  notice_id: '11111111111111111111111111111111',
  solicitation_number: 'N0017426Q5555',
  title: 'Precision Machining Support',
  posted_date: '2026-08-01T00:00:00+00:00',
  response_deadline: '2026-09-01T19:00:00+00:00',
  description: 'NSWC Indian Head Division seeks machining support. NAICS 332710.',
  attachments: [],
  points_of_contact: [],
});

const MASAN: FamilyNoticeRow = row({
  notice_id: '22222222222222222222222222222222',
  solicitation_number: 'N0017426R9999',
  title: 'Masan Manufacturing Support',
  posted_date: '2026-07-01T00:00:00+00:00',
  response_deadline: '2026-08-01T19:00:00+00:00',
  description: 'Unrelated Masan effort. Not the Indian Head MASA IDIQ.',
  attachments: [],
  points_of_contact: [],
});

function family(rows: FamilyNoticeRow[], query?: string) {
  return buildFamilyView(rows, { query, now: NOW });
}

function repoFile(relFromSamDir: string): string {
  return readFileSync(resolve(__dirname, relFromSamDir), 'utf8');
}

describe('solicitation family v1 — MASA identity', () => {
  it('1. MASA customer RFP resolves to one family', () => {
    const view = family(MASA, 'N0017426R1003');
    expect(view).not.toBeNull();
    expect(view!.identity_key).toBe('sol:N0017425RFPREQIHDMDEPT0002');
    expect(view!.versions).toHaveLength(4);
    expect(view!.rejected_unrelated_notice_ids).toEqual([]);
    expect(extractConfirmedAliases(MASA).some((id) => id.identifier_norm === 'N0017426R1003' && id.identifier_type === 'customer_rfp')).toBe(true);
  });

  it('2. MASA SAM token resolves to the same family', () => {
    const byRfp = family(MASA, 'N0017426R1003')!;
    const bySam = family(MASA, 'N0017425RFPREQIHDMDept0002')!;
    expect(bySam.identity_key).toBe(byRfp.identity_key);
    expect(bySam.current_notice_id).toBe(byRfp.current_notice_id);
  });

  it('3. all 4 notice IDs resolve to the same family', () => {
    const keys = FAMILY_IDS.map((id) => family(MASA, id)!.identity_key);
    expect(new Set(keys).size).toBe(1);
  });

  it('4. current notice is Amd 0003', () => {
    const view = family(MASA)!;
    expect(view.current_notice_id).toBe(AMD3_ID);
    expect(view.current_amendment).toBe('Amendment 0003');
    expect(extractAmendmentLabel(ORIGINAL.description)).toBeNull();
  });

  it('5. current deadline is 2026-08-27', () => {
    const view = family(MASA)!;
    expect(String(view.current_deadline)).toContain('2026-08-27');
  });

  it('6. current status is closed/archived, never open', () => {
    const view = family(MASA)!;
    expect(view.current_status).not.toBe('open');
    expect(['closed', 'archived']).toContain(view.current_status);
  });

  it('7. historical deadlines are preserved', () => {
    const view = family(MASA)!;
    const byId = new Map(view.versions.map((v) => [v.notice_id, v.response_deadline]));
    expect(String(byId.get(ORIGINAL_ID))).toContain('2026-07-21');
    expect(String(byId.get(AMD1_ID))).toContain('2026-08-04');
    expect(String(byId.get(AMD2_ID))).toContain('2026-08-04');
    expect(String(byId.get(AMD3_ID))).toContain('2026-08-27');
  });

  it('8. family current is Amd 0003; UUID stays the historical record', () => {
    const view = family(MASA, ORIGINAL_ID)!;
    expect(view.current_notice_id).toBe(AMD3_ID);
    expect(['closed', 'archived']).toContain(view.current_status);
    expect(view.current_status).not.toBe('open');
    expect(String(view.current_deadline)).toContain('2026-08-27');
    // #1557 owns UUID semantics: a notice id is a record pointer.
    const resolved = resolveFromCandidateRows(ORIGINAL_ID, MASA as SolicitationVersionRow[], 'notice_id', NOW);
    expect(resolved?.notice.notice_id).toBe(ORIGINAL_ID);
    expect(resolved?.matched_by).toBe('notice_id');
    expect(resolved?.notice.notice_id).not.toBe(view.current_notice_id);
  });
});

describe('solicitation family v1 — pursuit attach / heal / monitor', () => {
  it('9. pursuit on Original preserves Original as worked-from', () => {
    const view = family(MASA)!;
    const attached = attachPursuitToFamily(ORIGINAL_ID, view);
    expect(attached.worked_from_notice_id).toBe(ORIGINAL_ID);
    expect(attached.heal.preserved_worked_from).toBe(true);
    expect(attached.heal.claimed_user_saw_current).toBe(false);
  });

  it('10. pursuit on Amd 0002 preserves Amd 0002 as worked-from', () => {
    const attached = attachPursuitToFamily(AMD2_ID, family(MASA)!);
    expect(attached.worked_from_notice_id).toBe(AMD2_ID);
    expect(attached.worked_from_notice_id).not.toBe(AMD3_ID);
  });

  it('11. both pursuits expose Amd 0003 as current', () => {
    const view = family(MASA)!;
    const a = attachPursuitToFamily(ORIGINAL_ID, view);
    const b = attachPursuitToFamily(AMD2_ID, view);
    expect(a.current_notice_id).toBe(AMD3_ID);
    expect(b.current_notice_id).toBe(AMD3_ID);
    expect(a.identity_key).toBe(b.identity_key);
    expect(a.newer_sibling).toBe(true);
    expect(b.newer_sibling).toBe(true);
  });

  it('12. family monitor detects Amd 0003 as newer sibling', () => {
    const change = detectFamilyNewVersion({
      previousCurrentNoticeId: AMD2_ID,
      familyCurrentNoticeId: AMD3_ID,
      familyNoticeIds: FAMILY_IDS,
      currentAmendment: 'Amendment 0003',
    });
    expect(change).not.toBeNull();
    expect(change!.change_type).toBe('new_version');
    expect(change!.new_value).toBe(AMD3_ID);
    expect(change!.old_value).toBe(AMD2_ID);
    expect(detectFamilyNewVersion({
      previousCurrentNoticeId: null,
      familyCurrentNoticeId: AMD3_ID,
      familyNoticeIds: FAMILY_IDS,
    })).toBeNull();
  });
});

describe('solicitation family v1 — false merge + external records', () => {
  it('13. unrelated N00174 + 332710 notice does NOT merge', () => {
    const part = partitionConfirmedFamily([...MASA, UNRELATED], ORIGINAL_ID);
    expect(part.accepted.map((r) => r.notice_id).sort()).toEqual([...FAMILY_IDS].sort());
    expect(part.rejected.map((r) => r.notice_id)).toEqual([UNRELATED.notice_id]);
    expect(shouldMergeFamilies(
      { canonical_solicitation_number: 'N0017425RFPREQIHDMDept0002', confirmed_identifier_norms: ['N0017426R1003'] },
      { canonical_solicitation_number: 'N0017426Q5555', confirmed_identifier_norms: ['N0017426Q5555'] },
    )).toBe(false);
    expect(shouldMergeOnTitleDodaacNaics()).toBe(false);
    expect(extractPrimaryDodaac('N0017425RFPREQIHDMDept0002')).toBe('N00174');
    expect(extractPrimaryDodaac('N0017426Q5555')).toBe('N00174');
  });

  it('14. MASA vs Masan does NOT merge', () => {
    const part = partitionConfirmedFamily([...MASA, MASAN], 'N0017426R1003');
    expect(part.rejected.map((r) => r.notice_id)).toEqual([MASAN.notice_id]);
    expect(shouldMergeFamilies(
      { canonical_solicitation_number: 'N0017425RFPREQIHDMDept0002', confirmed_identifier_norms: ['N0017426R1003'] },
      { canonical_solicitation_number: 'N0017426R9999', confirmed_identifier_norms: ['N0017426R9999'] },
    )).toBe(false);
  });

  it('15. forecast does NOT become confirmed family identity', () => {
    const grade = gradeForecastRelationship({
      familyTitle: ORIGINAL.title,
      forecastTitle: ORIGINAL.title,
      familyDodaac: 'N00174',
      forecastOffice: 'N00174',
      familyNaics: '332710',
      forecastNaics: '332710',
      authoritativeIdentityEvidence: false,
    });
    expect(grade).toBe(FAMILY_EVIDENCE.SUPPORTED_LINK);
    expect(grade).not.toBe(FAMILY_EVIDENCE.CONFIRMED_IDENTITY);
    expect(family(MASA)!.identity_key.startsWith('sol:')).toBe(true);
  });

  it('16. missing award remains NOT_ESTABLISHED', () => {
    expect(gradeAwardRelationship({})).toBe(FAMILY_EVIDENCE.NOT_ESTABLISHED);
    expect(gradeAwardRelationship({ awardId: null, piid: null })).toBe(FAMILY_EVIDENCE.NOT_ESTABLISHED);
  });

  it('17. documents remain version-specific', () => {
    const docs = splitDocumentSets(MASA, AMD3_ID);
    expect(docs.current.notice_id).toBe(AMD3_ID);
    expect(docs.current.attachments).toEqual([]);
    const originalDocs = docs.historical.find((d) => d.notice_id === ORIGINAL_ID);
    const amd2Docs = docs.historical.find((d) => d.notice_id === AMD2_ID);
    expect(originalDocs?.attachments).toEqual([{ filename: 'N0017426R1003.pdf' }]);
    expect(amd2Docs?.attachments).toEqual([{ filename: 'N0017426R1003_Amd0002.pdf' }]);
    expect(docs.historical.some((d) => d.notice_id === AMD3_ID)).toBe(false);
  });

  it('18. P2/P3/P4 FIND behavior unchanged (three horizons still composed)', () => {
    const findSrc = repoFile('../opportunities/find-opportunities.ts');
    expect(findSrc).toContain("export type HorizonKey = 'open_now' | 'coming_back' | 'coming_soon'");
    expect(findSrc).toContain('open_now');
    expect(findSrc).toContain('coming_back');
    expect(findSrc).toContain('coming_soon');
    const openFilter = repoFile('../opportunities/map-filters.ts');
    expect(openFilter).toContain("eq('active', true)");
    expect(openFilter).toContain('gt(\'response_deadline\', nowIso)');
  });

  it('19. FIND price remains 10', () => {
    const registry = repoFile('../mcp/tool-registry.ts');
    expect(registry).toMatch(/find_opportunities:\s*10/);
  });

  it('20. no PAE relationship invented', () => {
    const pae = paeRelationshipForFamily();
    expect(pae.implemented).toBe(false);
    expect(pae.invented).toBe(false);
    expect(pae.linked).toBe(false);
  });
});

describe('solicitation family v1 — identity rules', () => {
  it('does not invent an Original amendment number', () => {
    expect(family(MASA)!.versions.find((v) => v.notice_id === ORIGINAL_ID)?.amendment).toBeNull();
  });

  it('customer RFP is a confirmed alias, not a second family key', () => {
    expect(familyIdentityKey('N0017425RFPREQIHDMDept0002', AMD3_ID)).toBe('sol:N0017425RFPREQIHDMDEPT0002');
    expect(isSolicitationIdentifier('N0017426R1003')).toBe(true);
    expect(isSolicitationIdentifier('N00174')).toBe(false);
  });

  it('junk solicitation_number never shares a sol: family', () => {
    const energy = row({
      notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      solicitation_number: 'EMAIL',
      department: 'DEPARTMENT OF ENERGY',
      title: 'Energy junk token',
      description: 'Unrelated.',
      attachments: [],
    });
    const epa = row({
      notice_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      solicitation_number: 'EMAIL',
      department: 'ENVIRONMENTAL PROTECTION AGENCY',
      title: 'EPA junk token',
      description: 'Unrelated.',
      attachments: [],
    });
    expect(familyIdentityKey('EMAIL', energy.notice_id)).toBe(`nid:${energy.notice_id}`);
    expect(familyIdentityKey('0001', energy.notice_id)).toBe(`nid:${energy.notice_id}`);
    expect(familyIdentityKey('RFP', energy.notice_id)).toBe(`nid:${energy.notice_id}`);
    expect(familyIdentityKey('2026', energy.notice_id)).toBe(`nid:${energy.notice_id}`);
    expect(familyIdentityKey('07152026', energy.notice_id)).toBe(`nid:${energy.notice_id}`);
    expect(familyIdentityKey('EMAIL', energy.notice_id)).not.toBe(familyIdentityKey('EMAIL', epa.notice_id));

    const mixed = partitionConfirmedFamily([energy, epa], energy.notice_id);
    expect(mixed.accepted.map((r) => r.notice_id)).toEqual([energy.notice_id]);
    expect(mixed.rejected.map((r) => r.notice_id)).toEqual([epa.notice_id]);
    expect(buildFamilyView([energy, epa], { query: energy.notice_id, now: NOW })!.identity_key).toBe(`nid:${energy.notice_id}`);
    expect(buildFamilyView([energy, epa], { query: epa.notice_id, now: NOW })!.identity_key).toBe(`nid:${epa.notice_id}`);
    expect(buildFamilyView([energy, epa], { query: energy.notice_id, now: NOW })!.versions).toHaveLength(1);
    expect(extractConfirmedAliases([energy, epa]).filter((id) => id.identifier_type === 'solicitation_number')).toEqual([]);

    const groups = groupRowsBySolicitationNumber([energy, epa]);
    expect(groups.size).toBe(2);
    const indexed = indexFamiliesByNoticeId([energy, epa], NOW);
    expect(indexed.get(energy.notice_id)!.identity_key).not.toBe(indexed.get(epa.notice_id)!.identity_key);
  });

  it('valid identical solicitation_number still produces one sol family', () => {
    expect(family(MASA)!.identity_key).toBe('sol:N0017425RFPREQIHDMDEPT0002');
    expect(family(MASA)!.versions).toHaveLength(4);
    expect(groupRowsBySolicitationNumber(MASA).size).toBe(1);
  });

  it('shared hyphenated customer-RFP across different SAM sol numbers does not merge', () => {
    // HVAC: shared W912C3-26-R-A009, neither side's SAM sol# is that alias.
    expect(shouldMergeFamilies(
      {
        canonical_solicitation_number: 'W912C326RA009',
        confirmed_identifier_norms: ['W912C326RA009', 'W912C3-26-R-A009'],
      },
      {
        canonical_solicitation_number: 'W912C326QA011',
        confirmed_identifier_norms: ['W912C326QA011', 'W912C3-26-R-A009'],
      },
    )).toBe(false);
  });

  it('monitor ignores unrelated same-office notices', () => {
    expect(detectFamilyNewVersion({
      previousCurrentNoticeId: AMD2_ID,
      familyCurrentNoticeId: UNRELATED.notice_id,
      familyNoticeIds: FAMILY_IDS,
    })).toBeNull();
  });
});
