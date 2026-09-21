import { describe, it, expect } from 'vitest';
import {
  assembleNoticeSourceText,
  attachmentLocationNote,
  deadlinesConflict,
  detectPiee,
  extractLotDeadlines,
  extractPieeLinks,
  lotDeadlinesConflict,
  normalizeNoticeUuid,
  pieeRetrievalLimitation,
  resolveCachedNotices,
} from './notice-identity';

const UUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const UUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SOL = 'N0017426R1003';

const BASE = {
  notice_id: UUID_A,
  solicitation_number: SOL,
  posted_date: '2026-01-15',
  response_deadline: '2026-03-01T21:00:00.000Z',
};
const AMENDMENT = {
  notice_id: UUID_B,
  solicitation_number: SOL,
  posted_date: '2026-02-20',
  response_deadline: '2026-06-15T21:00:00.000Z',
};

describe('conflicting solicitation deadlines', () => {
  it('UUID lookup keeps THAT notice’s deadline — never the later amendment', () => {
    const r = resolveCachedNotices(UUID_A, [AMENDMENT, BASE]);
    expect(r.resolution).toBe('uuid');
    expect(r.selected?.notice_id).toBe(UUID_A);
    expect(r.selected?.response_deadline).toMatch(/2026-03-01/);
    expect(r.deadline_conflict).toBe(false);
  });

  it('sol# lookup of the same family flags a deadline conflict and names both UUIDs', () => {
    const r = resolveCachedNotices(SOL, [BASE, AMENDMENT]);
    expect(r.resolution).toBe('solicitation_latest');
    expect(r.selected?.notice_id).toBe(UUID_B);
    expect(r.deadline_conflict).toBe(true);
    expect(r.notice_ids).toEqual([UUID_B, UUID_A]);
  });

  it('sol# vs UUID of the SAME notice compare equal when that UUID is the only row', () => {
    const byUuid = resolveCachedNotices(UUID_B, [AMENDMENT]);
    const bySol = resolveCachedNotices(SOL, [AMENDMENT]);
    expect(byUuid.selected?.notice_id).toBe(bySol.selected?.notice_id);
    expect(deadlinesConflict(byUuid.selected?.response_deadline, bySol.selected?.response_deadline)).toBe(false);
  });

  it('timezone-offset variants of the same calendar day are not a conflict', () => {
    expect(deadlinesConflict('2026-06-15T21:00:00.000Z', '2026-06-15T17:00:00-04:00')).toBe(false);
  });
});

describe('hyphenated UUID normalizes', () => {
  it('strips hyphens so lookup is consistent', () => {
    expect(normalizeNoticeUuid('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA')).toBe(UUID_A);
  });
});

describe('compliance-matrix source text — 28-shall fixture', () => {
  const shalls = Array.from({ length: 28 }, (_, i) =>
    `The Contractor shall perform requirement ${String(i + 1).padStart(2, '0')} of the statement of work.`,
  );
  const full = shalls.join('\n');

  it('paste of the same documents yields 28 shall-lines in the assembled text', () => {
    const assembled = assembleNoticeSourceText({
      sow_text: 'Scope overview.',
      description: '',
      documents: [{ filename: 'PWS.pdf', extracted_text: full, char_count: full.length }],
    });
    expect((assembled.text.match(/The Contractor shall/g) || []).length).toBe(28);
    expect(assembled.truncated_attachments).toBe(0);
  });

  it('THE REGRESSION: capped inline text drops shalls the paste still has', () => {
    const cap = 400;
    const capped = full.slice(0, cap);
    const assembled = assembleNoticeSourceText({
      sow_text: '',
      description: '',
      documents: [{
        filename: 'PWS.pdf',
        extracted_text: capped,
        extracted_text_truncated: true,
        char_count: full.length,
      }],
    });
    const n = (assembled.text.match(/The Contractor shall/g) || []).length;
    expect(n).toBeLessThan(28);
    expect(assembled.truncated_attachments).toBe(1);
  });
});

describe('external attachment locations', () => {
  it('explains a SAM.gov URL is not a Mindy-stored file', () => {
    expect(attachmentLocationNote('sam_public')).toMatch(/SAM\.gov/i);
    expect(attachmentLocationNote('mindy_signed')).toMatch(/Mindy/i);
    expect(attachmentLocationNote(null)).toMatch(/No downloadable copy/i);
  });
});

describe('lot due-dates vs SAM field (N00024-26-R-2200 SCB MAC)', () => {
  const synopsis = `
Proposal Due Dates:
 1. Lot 1 proposals and Lot 2 proposals from offerors not submitting a proposal for the initial APL Delivery Order are due 13 August 2026.
 2. Lot 2 proposals from offerors submitting a proposal for the initial APL Delivery Order are due 31 August 2026.
Offerors must have an active account in the Procurement Integrated Enterprise Environment (PIEE).
`.trim();

  it('extracts Lot 1 13 Aug and Lot 2 31 Aug from the synopsis', () => {
    const lots = extractLotDeadlines(synopsis);
    expect(lots.some((l) => l.lot === 'Lot 1' && l.date === '2026-08-13')).toBe(true);
    expect(lots.some((l) => l.lot === 'Lot 2' && l.date === '2026-08-31')).toBe(true);
    expect(lotDeadlinesConflict('2026-08-31T19:00:00+00:00', lots)).toBe(true);
  });

  it('detects PIEE in the synopsis even with no SOW heading', () => {
    expect(detectPiee(synopsis)).toBe(true);
    expect(detectPiee('Section C Statement of Work. Paint the hull.')).toBe(false);
  });

  it('extracts the PIEE URL and states the unread-attachment limitation', () => {
    const withLink = `${synopsis}\nhttps://piee.eb.mil/sol/xhtml/unauth/search/oppMgmtLink.xhtml?noticeId=N0002426R220X&noticeType=CombinedSynopsisSolicitation\n`;
    const links = extractPieeLinks(withLink);
    expect(links[0]).toMatch(/piee\.eb\.mil/);
    const note = pieeRetrievalLimitation(links);
    expect(note).toMatch(/did not retrieve/i);
    expect(note).toMatch(/does not establish/i);
    expect(note).toContain(links[0]);
  });
});
