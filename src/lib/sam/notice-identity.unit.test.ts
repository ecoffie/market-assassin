import { describe, it, expect } from 'vitest';
import {
  assembleNoticeSourceText,
  attachmentLocationNote,
  deadlinesConflict,
  normalizeNoticeUuid,
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
