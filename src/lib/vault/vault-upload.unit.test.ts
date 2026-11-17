import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sam/pdf-extract', () => ({
  extractPdf: vi.fn(async (b: Buffer) => ({ text: b.toString('utf-8'), pageCount: 1 })),
  extractDocx: vi.fn(async (b: Buffer) => ({ text: b.toString('utf-8') })),
  extractTxt: vi.fn((b: Buffer) => ({ text: b.toString('utf-8') })),
}));

import { detectProhibitedMarkings } from './marking-detect';
import { effectiveDocClass, mayCommitToFacts } from './doc-class';
import { saveVaultUpload, resolveVaultWriteOwner, safeStorageName, type VaultUploadInput } from './upload';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';

// ── marking detection ───────────────────────────────────────────────────────
describe('detectProhibitedMarkings', () => {
  const blockedClassified = [
    'SECRET',
    'TOP SECRET//SCI',
    'SECRET//NOFORN',
    'CONFIDENTIAL//REL TO USA, FVEY',
    'Page 3\n(S//NF) The system operates at the following frequency.',
    '(U) Background is unclassified.\n(TS) Collection details follow.',
    'Classified By: John Smith, Program Manager\nDerived From: Multiple Sources',
    'Declassify On: 20451231',
    'The briefing is marked TOP SECRET//HCS at the header.',
  ];
  const blockedCui = [
    'CUI',
    'CUI//SP-PRVCY',
    'CONTROLLED UNCLASSIFIED INFORMATION',
    'CONTROLLED',
    'UNCLASSIFIED//FOUO',
    'UNCLASSIFIED//FOR OFFICIAL USE ONLY',
    'FOR OFFICIAL USE ONLY',
    'NOFORN',
    '(CUI) Personnel roster follows.',
    'Controlled by: DLA Acquisition\nCUI Category: PROCURE',
  ];
  for (const t of blockedClassified) {
    it(`blocks classified: ${JSON.stringify(t.slice(0, 40))}`, () => {
      const v = detectProhibitedMarkings(t);
      expect(v.blocked).toBe(true);
      expect(v.kind).toBe('classified');
    });
  }
  for (const t of blockedCui) {
    it(`blocks CUI: ${JSON.stringify(t.slice(0, 40))}`, () => {
      const v = detectProhibitedMarkings(t);
      expect(v.blocked).toBe(true);
      expect(v.kind).toBe('cui');
    });
  }

  // Ordinary federal solicitation and commercial language must pass.
  const allowed = [
    'The contractor shall safeguard CUI in accordance with DFARS 252.204-7012 and NIST SP 800-171.',
    'Personnel must hold an active SECRET clearance. A Top Secret facility clearance is required at award.',
    'Company Confidential',
    'CONFIDENTIAL',
    'Proprietary and Confidential — Acme Corp',
    'Our secret sauce is speed.',
    'Submit via HTTP://RD.EXAMPLE.GOV/PORTAL or HTTPS://OC.MIL',
    'Controlled by: the program office',
    'UNCLASSIFIED',
    'Section C — Statement of Work\n3.1 The contractor shall provide janitorial services.',
    'Answer (C) is correct for question 4.',
    '(A) Technical approach\n(B) Management approach\n(C) Past performance\n(S) Small business plan',
  ];
  for (const t of allowed) {
    it(`allows: ${JSON.stringify(t.slice(0, 50))}`, () => {
      expect(detectProhibitedMarkings(t).blocked).toBe(false);
    });
  }
});

// ── doc class ───────────────────────────────────────────────────────────────
describe('doc class', () => {
  it('maps NULL / unknown to company (legacy rows)', () => {
    expect(effectiveDocClass({ doc_class: null })).toBe('company');
    expect(effectiveDocClass({})).toBe('company');
    expect(effectiveDocClass(null)).toBe('company');
    expect(effectiveDocClass({ doc_class: 'weird' })).toBe('company');
  });
  it('company commits without extra confirmation', () => {
    expect(mayCommitToFacts({ doc_class: null }, false).ok).toBe(true);
  });
  it('reference and generated need explicit confirmation', () => {
    for (const c of ['reference', 'generated']) {
      const refused = mayCommitToFacts({ doc_class: c }, false);
      expect(refused.ok).toBe(false);
      expect(mayCommitToFacts({ doc_class: c }, true).ok).toBe(true);
      // truthy-but-not-true is not a confirmation
      expect(mayCommitToFacts({ doc_class: c }, 'yes' as unknown as boolean).ok).toBe(false);
    }
  });
});

// ── upload helper ───────────────────────────────────────────────────────────
function headers(h: Record<string, string> = {}) {
  return { headers: { get: (n: string) => h[n.toLowerCase()] ?? null } };
}
function stubs(opts: { insertError?: boolean; uploadError?: boolean } = {}) {
  const calls = { uploads: [] as string[], removes: [] as string[][], inserts: [] as Record<string, unknown>[], buckets: [] as unknown[] };
  const storage = {
    listBuckets: vi.fn(async () => ({ data: [{ name: 'vault-assets' }] })),
    createBucket: vi.fn(async (name: string, o: { public: boolean }) => { calls.buckets.push({ name, o }); return { error: null }; }),
    from: vi.fn(() => ({
      upload: vi.fn(async (path: string) => { calls.uploads.push(path); return { error: opts.uploadError ? { message: 'x' } : null }; }),
      remove: vi.fn(async (paths: string[]) => { calls.removes.push(paths); return { error: null }; }),
    })),
  };
  const db = {
    from: vi.fn(() => ({
      insert: (row: Record<string, unknown>) => {
        calls.inserts.push(row);
        return { select: () => ({ maybeSingle: async () => (opts.insertError
          ? { data: null, error: { message: 'boom' } }
          : { data: { id: 'doc-1', ...row }, error: null }) }) };
      },
    })),
  };
  return { calls, storage, db };
}
const own = async (email: string): Promise<ChatActingScope> => ({ kind: 'own', email });
const file = (name: string, text: string) => ({ name, size: Buffer.byteLength(text), buffer: Buffer.from(text) });
function input(over: Partial<VaultUploadInput> = {}): VaultUploadInput {
  return {
    callerEmail: 'owner@x.com', request: headers(), file: file('rfp.pdf', 'Section L instructions. Page limit 20.'),
    docClass: 'reference', source: 'ask_mindy', ...over,
  };
}

describe('saveVaultUpload', () => {
  let s: ReturnType<typeof stubs>;
  beforeEach(() => { s = stubs(); });

  it('stores a clean reference upload in the caller vault with class metadata', async () => {
    const r = await saveVaultUpload(input({ chatSessionId: '11111111-1111-4111-8111-111111111111', noticeId: 'abc' }), { db: s.db, storage: s.storage, resolveScope: own, now: () => 5 });
    expect(r.ok).toBe(true);
    expect(s.calls.uploads).toEqual(['owner@x.com/5-rfp.pdf']);
    expect(s.calls.inserts[0]).toMatchObject({
      user_email: 'owner@x.com', doc_class: 'reference', source: 'ask_mindy',
      chat_session_id: '11111111-1111-4111-8111-111111111111', notice_id: 'abc', version: 1, parse_status: 'parsed',
    });
  });

  it('company upload from the Vault screen writes NO new columns (works before the migration)', async () => {
    const r = await saveVaultUpload(input({ docClass: 'company', source: 'vault', docType: 'cap_stmt' }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(r.ok).toBe(true);
    const row = s.calls.inserts[0];
    for (const k of ['doc_class', 'source', 'chat_session_id', 'notice_id', 'version']) expect(row).not.toHaveProperty(k);
    expect(row.doc_type).toBe('cap_stmt');
  });

  it('classified marking: refused, NOTHING stored (no blob, no row)', async () => {
    const r = await saveVaultUpload(input({ file: file('brief.pdf', 'SECRET//NOFORN\nMission details') }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: false, code: 'prohibited_marking', markingKind: 'classified', status: 422 });
    expect(s.calls.uploads).toHaveLength(0);
    expect(s.calls.inserts).toHaveLength(0);
    expect(s.storage.listBuckets).not.toHaveBeenCalled();
  });

  it('CUI marking: refused, NOTHING stored, copy says why', async () => {
    const r = await saveVaultUpload(input({ docClass: 'company', source: 'vault', file: file('roster.docx', 'CUI//SP-PRVCY\nNames') }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.markingKind).toBe('cui');
      expect(r.message).toMatch(/CUI/);
      expect(r.message).toMatch(/Nothing from this file was saved/);
    }
    expect(s.calls.uploads).toHaveLength(0);
    expect(s.calls.inserts).toHaveLength(0);
  });

  it('unreadable file (no text) is refused unchecked rather than stored', async () => {
    const r = await saveVaultUpload(input({ file: file('scan.pdf', '   ') }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: false, code: 'unreadable' });
    expect(s.calls.uploads).toHaveLength(0);
  });

  it('unsupported type (.doc, .exe) refused before anything else', async () => {
    for (const n of ['old.doc', 'x.exe']) {
      const r = await saveVaultUpload(input({ file: file(n, 'hello') }), { db: s.db, storage: s.storage, resolveScope: own });
      expect(r).toMatchObject({ ok: false, code: 'unsupported_type', status: 415 });
    }
    expect(s.calls.uploads).toHaveLength(0);
  });

  it('too large refused', async () => {
    const r = await saveVaultUpload(input({ file: { name: 'a.txt', size: 21 * 1024 * 1024, buffer: Buffer.from('x') } }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: false, code: 'too_large', status: 413 });
  });

  it('authorized coach writes to the CLIENT vault', async () => {
    const client = async (email: string): Promise<ChatActingScope> => ({ kind: 'client', email, workspaceId: 'ws1', vaultEmail: 'ws1@clients.getmindy.ai' });
    const r = await saveVaultUpload(input({ request: headers({ 'x-active-workspace': 'ws1' }) }), { db: s.db, storage: s.storage, resolveScope: client, now: () => 1 });
    expect(r).toMatchObject({ ok: true, ownerEmail: 'ws1@clients.getmindy.ai', workspace: 'client' });
    expect(s.calls.inserts[0].user_email).toBe('ws1@clients.getmindy.ai');
    expect(s.calls.uploads[0].startsWith('ws1@clients.getmindy.ai/')).toBe(true);
  });

  it('header present but NOT authorized → refused, never falls back to the caller vault', async () => {
    const r = await saveVaultUpload(input({ request: headers({ 'x-active-workspace': 'ws-other' }) }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: false, code: 'workspace_unconfirmed', status: 409 });
    expect(s.calls.uploads).toHaveLength(0);
    expect(s.calls.inserts).toHaveLength(0);
  });

  it('resolver error (unavailable) → refused', async () => {
    const unavailable = async (email: string): Promise<ChatActingScope> => ({ kind: 'unavailable', email });
    const r = await saveVaultUpload(input({ request: headers({ 'x-active-workspace': 'ws1' }) }), { db: s.db, storage: s.storage, resolveScope: unavailable });
    expect(r).toMatchObject({ ok: false, code: 'workspace_unconfirmed' });
  });

  it('insert failure removes the blob (no orphan)', async () => {
    const f = stubs({ insertError: true });
    const r = await saveVaultUpload(input(), { db: f.db, storage: f.storage, resolveScope: own, now: () => 9 });
    expect(r).toMatchObject({ ok: false, code: 'insert_failed' });
    expect(f.calls.removes).toEqual([['owner@x.com/9-rfp.pdf']]);
  });

  it('storage failure stores no row', async () => {
    const f = stubs({ uploadError: true });
    const r = await saveVaultUpload(input(), { db: f.db, storage: f.storage, resolveScope: own });
    expect(r).toMatchObject({ ok: false, code: 'storage_failed' });
    expect(f.calls.inserts).toHaveLength(0);
  });

  it('creates a missing bucket as PRIVATE', async () => {
    s.storage.listBuckets.mockResolvedValueOnce({ data: [] });
    await saveVaultUpload(input(), { db: s.db, storage: s.storage, resolveScope: own });
    expect(s.calls.buckets).toEqual([{ name: 'vault-assets', o: { public: false } }]);
  });

  it('ignores a non-UUID chat session id', async () => {
    await saveVaultUpload(input({ chatSessionId: "'; drop table" }), { db: s.db, storage: s.storage, resolveScope: own });
    expect(s.calls.inserts[0]).not.toHaveProperty('chat_session_id');
  });
});

describe('helpers', () => {
  it('safeStorageName strips paths and traversal', () => {
    expect(safeStorageName('../../etc/passwd')).toBe('passwd');
    expect(safeStorageName('a\\b\\c..pdf')).toBe('c.pdf');
    expect(safeStorageName('RFP #12 (final).pdf')).toBe('RFP _12 _final_.pdf');
  });
  it('resolveVaultWriteOwner: no header → own', async () => {
    expect(await resolveVaultWriteOwner('o@x.com', headers(), own)).toEqual({ ownerEmail: 'o@x.com', workspace: 'own' });
  });
});
