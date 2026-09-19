/**
 * Canonical solicitation known-ID: identity, latest version, status.
 * Fixture: N0017426R1003 / N0017425RFPREQIHDMDept0002 (four stored versions).
 */
import { describe, expect, it } from 'vitest';
import {
  deriveSolicitationStatus,
  extractAmendmentLabel,
  isNoticeUuid,
  isSolicitationIdentifier,
  normalizeSolicitationQuery,
  resolveFromCandidateRows,
  selectCanonicalVersion,
  solicitationStatusLabel,
  type SolicitationVersionRow,
} from '@/lib/sam/resolve-solicitation';

const NOW = new Date('2026-09-18T18:00:00.000Z');

function row(partial: Partial<SolicitationVersionRow> & { notice_id: string }): SolicitationVersionRow {
  return {
    solicitation_number: 'N0017425RFPREQIHDMDept0002',
    title: 'Manufacturing & Services Acquisition (MASA) Manufacturing Support',
    department: 'DEPT OF DEFENSE',
    sub_tier: 'DEPT OF THE NAVY',
    office: null,
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
    ...partial,
  };
}

const ORIGINAL = row({
  notice_id: 'ce85c48dc296497eb902a0a73ac45680',
  posted_date: '2026-06-17T00:00:00+00:00',
  response_deadline: '2026-07-21T19:00:00+00:00',
  archive_date: '2026-08-05T00:00:00+00:00',
  description: 'The proposed contact action will be multiple award...\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026. Please refer to the attachments for more i',
});
const AMD1 = row({
  notice_id: 'd85b93617ae54e8e9b05b7e7a23ffe61',
  posted_date: '2026-07-14T00:00:00+00:00',
  response_deadline: '2026-08-04T19:00:00+00:00',
  archive_date: '2026-08-19T00:00:00+00:00',
  description: 'Amendment 0001, extending the solicitation response/closing date and answering questions received in response to issuance of the solicitation, is posted as of 14 July 2026. Please see attachments.\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
});
const AMD2 = row({
  notice_id: '8ca5ef19cc974f288722a8d5913cda5c',
  posted_date: '2026-07-22T00:00:00+00:00',
  response_deadline: '2026-08-04T19:00:00+00:00',
  archive_date: '2026-08-19T00:00:00+00:00',
  description: 'Amendment 0002, answering a question received in response to issuance of the solicitation, is posted as of 22 July 2026. Please see attachments.\n\n Amendment 0001, extending the solicitation response/closing date...\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
});
const AMD3 = row({
  notice_id: 'f1aa309fa39040a4929d90a7d88fd091',
  posted_date: '2026-07-29T00:00:00+00:00',
  response_deadline: '2026-08-27T19:00:00+00:00',
  archive_date: '2026-09-11T00:00:00+00:00',
  description: 'Amendment 0003, extending the solicitation response/closing date and answering questions received in response to issuance of the solicitation, is posted as of 29 July 2026. Please see attachments.\n\nAmendment 0002...\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
});

const MASA = [AMD2, ORIGINAL, AMD1, AMD3]; // shuffled — current reader would take first

describe('normalize + identity shape', () => {
  it('F. trailing whitespace does not break identity', () => {
    expect(normalizeSolicitationQuery('  N0017426R1003  ')).toBe('N0017426R1003');
    expect(isSolicitationIdentifier('  N0017426R1003  ')).toBe(true);
  });
  it('A. RFP number is a solicitation identifier even when the column stores RFPREQ', () => {
    expect(isSolicitationIdentifier('N0017426R1003')).toBe(true);
    expect(isSolicitationIdentifier('N0017425RFPREQIHDMDept0002')).toBe(true);
  });
  it('B. RFPREQ identifier is accepted', () => {
    expect(isSolicitationIdentifier('N0017425RFPREQIHDMDept0002')).toBe(true);
  });
  it('does not treat free text as an identifier (no unbounded description search)', () => {
    expect(isSolicitationIdentifier('manufacturing support')).toBe(false);
    expect(isSolicitationIdentifier('cyber')).toBe(false);
    for (const word of ['manufacturing', 'amendment', 'services', 'navy', 'open', 'solicitation']) {
      expect(isSolicitationIdentifier(word)).toBe(false);
    }
    expect(isSolicitationIdentifier('too-short')).toBe(false);
    expect(isSolicitationIdentifier('N00174')).toBe(false);
    expect(isSolicitationIdentifier('EMAIL')).toBe(false);
    expect(isSolicitationIdentifier('RFP')).toBe(false);
    expect(isSolicitationIdentifier('0001')).toBe(false);
    expect(isSolicitationIdentifier('2026')).toBe(false);
    expect(isSolicitationIdentifier('07152026')).toBe(false);
  });
  it('recognizes notice UUIDs', () => {
    expect(isNoticeUuid('f1aa309fa39040a4929d90a7d88fd091')).toBe(true);
    expect(isNoticeUuid('N0017426R1003')).toBe(false);
  });
});

describe('version selection', () => {
  it('C. four versions → Amd 0003 selected (posted_date DESC, not array order)', () => {
    const picked = selectCanonicalVersion(MASA);
    expect(picked?.notice_id).toBe(AMD3.notice_id);
    const resolved = resolveFromCandidateRows('N0017426R1003', MASA, 'description_identifier', NOW);
    expect(resolved?.notice.notice_id).toBe(AMD3.notice_id);
    expect(resolved?.amendment).toBe('Amendment 0003');
    expect(resolved?.version_count).toBe(4);
  });
  it('B. RFPREQ identifier resolves the same canonical notice', () => {
    const a = resolveFromCandidateRows('N0017426R1003', MASA, 'description_identifier', NOW);
    const b = resolveFromCandidateRows('N0017425RFPREQIHDMDept0002', MASA, 'solicitation_number', NOW);
    expect(a?.notice.notice_id).toBe(b?.notice.notice_id);
    expect(b?.notice.notice_id).toBe(AMD3.notice_id);
  });
  it('D. deadline returned = Aug 27', () => {
    const resolved = resolveFromCandidateRows('N0017426R1003', MASA, 'description_identifier', NOW);
    expect(resolved?.response_deadline).toMatch(/^2026-08-27/);
  });
  it('K. historical versions remain listed (not merged/deleted)', () => {
    const resolved = resolveFromCandidateRows('N0017426R1003', MASA, 'description_identifier', NOW);
    const ids = new Set(resolved?.versions.map((v) => v.notice_id));
    expect(ids).toEqual(new Set(MASA.map((r) => r.notice_id)));
  });
  it('J. single-version solicitation is unchanged', () => {
    const one = [ORIGINAL];
    const resolved = resolveFromCandidateRows(ORIGINAL.solicitation_number!, one, 'solicitation_number', NOW);
    expect(resolved?.notice.notice_id).toBe(ORIGINAL.notice_id);
    expect(resolved?.version_count).toBe(1);
    expect(resolved?.amendment).toBeNull();
  });
  it('never depends on unordered first-row order', () => {
    expect(selectCanonicalVersion([AMD2, ORIGINAL, AMD1, AMD3])?.notice_id).toBe(AMD3.notice_id);
    expect(selectCanonicalVersion([ORIGINAL, AMD3, AMD1, AMD2])?.notice_id).toBe(AMD3.notice_id);
  });
});

describe('status truth', () => {
  it('E. fixture today is closed/archived, never open', () => {
    const resolved = resolveFromCandidateRows('N0017426R1003', MASA, 'description_identifier', NOW);
    expect(resolved?.status).not.toBe('open');
    expect(['closed', 'archived']).toContain(resolved?.status);
    expect(solicitationStatusLabel(resolved!.status)).not.toMatch(/^Open /);
  });
  it('G. currently open amended solicitation selects newest amendment', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const v1 = row({
      notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      solicitation_number: 'OPEN26R0001',
      posted_date: '2026-08-01T00:00:00Z',
      response_deadline: '2026-08-20T19:00:00Z',
      active: true,
      description: 'Amendment 0001, extending the date.',
    });
    const v2 = row({
      notice_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      solicitation_number: 'OPEN26R0001',
      posted_date: '2026-08-08T00:00:00Z',
      response_deadline: '2026-09-01T19:00:00Z',
      active: true,
      description: 'Amendment 0002, extending the date.',
    });
    const resolved = resolveFromCandidateRows('OPEN26R0001', [v1, v2], 'solicitation_number', now);
    expect(resolved?.notice.notice_id).toBe(v2.notice_id);
    expect(resolved?.amendment).toBe('Amendment 0002');
    expect(resolved?.status).toBe('open');
    expect(resolved?.response_deadline).toMatch(/^2026-09-01/);
  });
  it('UUID of an older amendment stays on that record — not upgraded to latest', () => {
    const resolved = resolveFromCandidateRows(ORIGINAL.notice_id, MASA, 'notice_id', NOW);
    expect(resolved?.notice.notice_id).toBe(ORIGINAL.notice_id);
    expect(resolved?.matched_by).toBe('notice_id');
    expect(resolved?.response_deadline).toMatch(/^2026-07-21/);
    expect(resolved?.status).not.toBe('open');
    expect(resolved?.deadline_conflict).toBe(false);
  });
  it('sol# of the same family flags deadline conflict; UUID of one notice does not inherit the later date', () => {
    const bySol = resolveFromCandidateRows('N0017425RFPREQIHDMDept0002', MASA, 'solicitation_number', NOW);
    const byUuid = resolveFromCandidateRows(ORIGINAL.notice_id, MASA, 'notice_id', NOW);
    expect(bySol?.deadline_conflict).toBe(true);
    expect(byUuid?.deadline_conflict).toBe(false);
    expect(byUuid?.notice.notice_id).not.toBe(bySol?.notice.notice_id);
    expect(byUuid?.response_deadline).toMatch(/^2026-07-21/);
    expect(bySol?.response_deadline).toMatch(/^2026-08-27/);
    expect(bySol?.notice_ids).toContain(ORIGINAL.notice_id);
    expect(bySol?.notice_ids).toContain(AMD3.notice_id);
  });
  it('H. older deadline passed + newer deadline future → OPEN', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const older = row({
      notice_id: '11111111111111111111111111111111',
      posted_date: '2026-07-01T00:00:00Z',
      response_deadline: '2026-08-04T19:00:00Z',
      active: true,
    });
    const newer = row({
      notice_id: '22222222222222222222222222222222',
      posted_date: '2026-07-29T00:00:00Z',
      response_deadline: '2026-08-27T19:00:00Z',
      active: true,
    });
    const resolved = resolveFromCandidateRows('X', [older, newer], 'solicitation_number', now);
    expect(resolved?.notice.notice_id).toBe(newer.notice_id);
    expect(resolved?.status).toBe('open');
  });
  it('measured live failure class (12FPC326Q0056 shape): unordered CLOSED, canonical OPEN', () => {
    const now = new Date('2026-09-18T18:00:00.000Z');
    const older = row({
      notice_id: '26a9f64be79f4b1ead9a25bf9105eae0',
      solicitation_number: '12FPC326Q0056',
      posted_date: '2026-09-02T00:00:00+00:00',
      response_deadline: '2026-09-18T17:00:00+00:00',
      active: true,
    });
    const newer = row({
      notice_id: 'fb27b3dcdce54d21b6c6e2375d2d412b',
      solicitation_number: '12FPC326Q0056',
      posted_date: '2026-09-18T00:00:00+00:00',
      response_deadline: '2026-09-21T17:00:00+00:00',
      active: true,
    });
    const unorderedPick = [older, newer][0];
    expect(deriveSolicitationStatus(unorderedPick, now)).toBe('closed');
    const resolved = resolveFromCandidateRows('12FPC326Q0056', [older, newer], 'solicitation_number', now);
    expect(resolved?.notice.notice_id).toBe(newer.notice_id);
    expect(resolved?.status).toBe('open');
    expect(resolved?.response_deadline).toMatch(/^2026-09-21/);
  });
  it('I. older deadline future + newer deadline passed → CLOSED', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const older = row({
      notice_id: '11111111111111111111111111111111',
      posted_date: '2026-07-01T00:00:00Z',
      response_deadline: '2026-08-27T19:00:00Z',
      active: true,
    });
    const newer = row({
      notice_id: '22222222222222222222222222222222',
      posted_date: '2026-08-01T00:00:00Z',
      response_deadline: '2026-08-05T19:00:00Z',
      active: true,
    });
    const resolved = resolveFromCandidateRows('X', [older, newer], 'solicitation_number', now);
    expect(resolved?.notice.notice_id).toBe(newer.notice_id);
    expect(resolved?.status).toBe('closed');
    expect(solicitationStatusLabel(resolved!.status)).toBe('Closed solicitation');
  });
  it('never hardcodes Open: active true + past deadline is closed', () => {
    expect(deriveSolicitationStatus({
      active: true,
      response_deadline: '2026-08-04T19:00:00Z',
      archive_date: null,
    }, NOW)).toBe('closed');
  });
  it('OPEN requires active=true; missing deadline still opens when active', () => {
    expect(deriveSolicitationStatus({
      active: true,
      response_deadline: null,
      archive_date: null,
    }, NOW)).toBe('open');
  });
  it('active unknown + future deadline is STATUS UNKNOWN, not open', () => {
    expect(deriveSolicitationStatus({
      active: null,
      response_deadline: '2026-12-01T19:00:00Z',
      archive_date: null,
    }, NOW)).toBe('unknown');
  });
  it('does not invent an amendment number when the description has none', () => {
    expect(extractAmendmentLabel(ORIGINAL.description)).toBeNull();
    expect(extractAmendmentLabel(null)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('shared readers no longer unordered-limit solicitation_number', () => {
  const files = [
    join(__dirname, '../usaspending/solicitation-incumbent.ts'),
    join(__dirname, 'solicitation-documents.ts'),
    join(__dirname, 'fetch-pursuit-docs.ts'),
    join(__dirname, '../pipeline/sam-opportunity-lookup.ts'),
    join(__dirname, '../../app/api/admin/heal-pursuit-attachments/route.ts'),
  ];
  for (const file of files) {
    it(`${file.split('/src/').pop()} has no unordered solicitation_number limit(1)`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('resolveCanonicalSolicitation');
      expect(src).not.toMatch(/ilike\('solicitation_number'[\s\S]{0,160}?\.limit\(1\)/);
      expect(src).not.toMatch(/from\('sam_opportunities'\)[\s\S]{0,280}?eq\('solicitation_number'[\s\S]{0,160}?\.limit\(1\)/);
    });
  }
  it('opportunity-detail known-ID path uses the canonical resolver', () => {
    const src = readFileSync(join(__dirname, '../../app/api/app/opportunity-detail/route.ts'), 'utf8');
    expect(src).toContain('resolveCanonicalSolicitation');
    expect(src).not.toMatch(/from\('sam_opportunities'\)[\s\S]{0,280}?eq\('solicitation_number'[\s\S]{0,160}?\.limit\(1\)/);
  });
});
