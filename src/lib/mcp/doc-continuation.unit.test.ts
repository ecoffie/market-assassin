/**
 * Bounded free continuation (ChatGPT blocker #2, owner decision 2026-10-04).
 * Measured: one A3 prompt paged a 725-page reference guide 9× at 10 credits each, and finishing
 * it would have cost 50 calls. Continuing a paid retrieval is free; everything else bills, and
 * "free pagination" may not become an unlimited extraction API.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CONTINUATION_TTL_SEC,
  MAX_FREE_CONTINUATIONS,
  canonicalWindows,
  isFreeDocumentContinuation,
  issueContinuation,
  verifyContinuation,
} from './doc-continuation';

beforeAll(() => {
  process.env.MCP_OAUTH_SIGNING_SECRET = 'test-secret-doc-continuation';
});

const USER = 'Reader@Example.com';
const W = [{ document_id: 'doc-a', offset: 20_000, limit: 20_000 }];
const NOW = 1_800_000_000;

describe('issue → verify', () => {
  it('a token verifies for the same user (case-insensitive) and the exact windows', () => {
    const t = issueContinuation(USER, W, 1, NOW)!;
    expect(verifyContinuation(t, { userEmail: 'reader@example.com', windows: W }, NOW)).toEqual({ ok: true, page: 1 });
  });

  it('window order does not matter', () => {
    const two = [{ document_id: 'a', offset: 0, limit: 10 }, { document_id: 'b', offset: 5, limit: 10 }];
    const t = issueContinuation(USER, two, 1, NOW)!;
    expect(verifyContinuation(t, { userEmail: USER, windows: [...two].reverse() }, NOW).ok).toBe(true);
  });

  it('the token never carries the email address', () => {
    const t = issueContinuation(USER, W, 1, NOW)!;
    const body = Buffer.from(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(body.toLowerCase()).not.toContain('reader');
    expect(body).not.toContain('@');
  });
});

describe('every way a continuation is NOT free', () => {
  const t = () => issueContinuation(USER, W, 1, NOW)!;

  it('absent / empty token', () => {
    expect(verifyContinuation(undefined, { userEmail: USER, windows: W }, NOW)).toEqual({ ok: false, reason: 'absent' });
    expect(verifyContinuation('', { userEmail: USER, windows: W }, NOW).ok).toBe(false);
  });

  it('another user presenting the token', () => {
    expect(verifyContinuation(t(), { userEmail: 'other@example.com', windows: W }, NOW)).toEqual({ ok: false, reason: 'wrong_user' });
  });

  it('a different offset (reading somewhere else is a new retrieval)', () => {
    expect(verifyContinuation(t(), { userEmail: USER, windows: [{ ...W[0], offset: 400_000 }] }, NOW).ok).toBe(false);
  });

  it('a wider window', () => {
    expect(verifyContinuation(t(), { userEmail: USER, windows: [{ ...W[0], limit: 120_000 }] }, NOW).ok).toBe(false);
  });

  it('adding another document to the windows', () => {
    expect(verifyContinuation(t(), { userEmail: USER, windows: [...W, { document_id: 'doc-b', offset: 0, limit: 20_000 }] }, NOW).ok).toBe(false);
  });

  it('widening document_ids beyond the windows', () => {
    expect(verifyContinuation(t(), { userEmail: USER, windows: W, documentIds: ['doc-a', 'doc-b'] }, NOW)).toEqual({ ok: false, reason: 'windows_mismatch' });
    expect(verifyContinuation(t(), { userEmail: USER, windows: W, documentIds: ['doc-a'] }, NOW).ok).toBe(true);
  });

  it('expired', () => {
    expect(verifyContinuation(t(), { userEmail: USER, windows: W }, NOW + CONTINUATION_TTL_SEC + 1)).toEqual({ ok: false, reason: 'expired' });
  });

  it('tampered payload or signature', () => {
    const [body, sig] = t().split('.');
    expect(verifyContinuation(`${body}x.${sig}`, { userEmail: USER, windows: W }, NOW).ok).toBe(false);
    expect(verifyContinuation(`${body}.${sig.slice(0, -2)}AA`, { userEmail: USER, windows: W }, NOW).ok).toBe(false);
    expect(verifyContinuation('not-a-token', { userEmail: USER, windows: W }, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('the cap bounds free pages per paid retrieval', () => {
  it(`issues up to page ${MAX_FREE_CONTINUATIONS} and nothing past it`, () => {
    expect(issueContinuation(USER, W, MAX_FREE_CONTINUATIONS, NOW)).toBeTypeOf('string');
    expect(issueContinuation(USER, W, MAX_FREE_CONTINUATIONS + 1, NOW)).toBeNull();
  });

  it('windows a host could abuse are never authorised', () => {
    expect(canonicalWindows([{ document_id: 'a', offset: 0, limit: 500_000 }])).toBeNull();
    expect(canonicalWindows([{ document_id: 'a', offset: -1, limit: 10 }])).toBeNull();
    expect(canonicalWindows([{ offset: 0, limit: 10 }])).toBeNull();
    expect(canonicalWindows([])).toBeNull();
  });
});

describe('isFreeDocumentContinuation (the billing hook)', () => {
  it('true only for get_solicitation_documents with a verifying token', () => {
    const tok = issueContinuation(USER, W, 1)!;
    expect(isFreeDocumentContinuation('get_solicitation_documents', { notice_id: 'n', documents: W, document_ids: ['doc-a'], continuation: tok }, USER)).toBe(true);
    expect(isFreeDocumentContinuation('get_solicitation_documents', { notice_id: 'n', documents: W }, USER)).toBe(false);
    expect(isFreeDocumentContinuation('lookup_solicitation', { continuation: tok, documents: W }, USER)).toBe(false);
    expect(isFreeDocumentContinuation('get_solicitation_documents', { documents: W, continuation: tok }, undefined)).toBe(false);
    expect(isFreeDocumentContinuation('get_solicitation_documents', { documents: W, continuation: tok }, 'someone@else.com')).toBe(false);
  });
});
