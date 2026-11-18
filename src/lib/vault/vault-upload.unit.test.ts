import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/sam/pdf-extract', () => ({
  extractPdf: vi.fn(async (b: Buffer) => ({ text: b.toString('utf-8'), pageCount: 1 })),
  extractDocx: vi.fn(async (b: Buffer) => ({ text: b.toString('utf-8') })),
  extractTxt: vi.fn((b: Buffer) => ({ text: b.toString('utf-8') })),
  extractXlsx: vi.fn(async (b: Buffer) => ({ text: b.toString('utf-8') })),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async (_k: string, limit: number) => ({ allowed: true, remaining: limit, limit, resetAt: Math.floor(Date.now() / 1000) + 3600 })),
}));
import { effectiveDocClass, mayCommitToFacts } from './doc-class';
import { saveVaultUpload, resolveVaultWriteOwner, safeStorageName, spreadsheetMarkingBody, ASK_MINDY_UPLOAD_EXTS, VAULT_PANEL_EXTS, type VaultUploadInput } from './upload';
import { xlsxHeaderFooterText, detectProhibitedMarkings } from './marking-detect';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';
import { checkVaultLimit, __resetVaultLocalLimits, VAULT_LIMITS } from './rate-limits';
import { checkRateLimit } from '@/lib/rate-limit';

// ── spreadsheet marking scan ────────────────────────────────────────────────
describe('spreadsheetMarkingBody', () => {
  it('exposes bare banner cells hidden by CSV padding', () => {
    const cuiBody = spreadsheetMarkingBody('=== Sheet: S ===\nCUI,,\nName,SSN,Role');
    expect(cuiBody.split('\n')).toContain('CUI');
    expect(detectProhibitedMarkings(cuiBody)).toMatchObject({ blocked: true, kind: 'cui' });
    expect(detectProhibitedMarkings(spreadsheetMarkingBody('SECRET,,\na,b,c'))).toMatchObject({
      blocked: true, kind: 'classified',
    });
    expect(detectProhibitedMarkings(spreadsheetMarkingBody(',,CUI,,\na,b,c'))).toMatchObject({
      blocked: true, kind: 'cui',
    });
  });

  it('does not treat a clearance/data cell as a document banner', () => {
    const staffing = spreadsheetMarkingBody(
      '=== Sheet: Rates ===\nLCAT,Clearance,Rate\nSys Engineer,SECRET,150\nAnalyst,TOP SECRET,175',
    );
    expect(detectProhibitedMarkings(staffing)).toMatchObject({ blocked: false });
    expect(detectProhibitedMarkings(spreadsheetMarkingBody('R1,CUI\nR2,Public'))).toMatchObject({
      blocked: false,
    });
  });
});

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
    'CONTROLLED UNCLASSIFIED INFORMATION\nbody\nCONTROLLED UNCLASSIFIED INFORMATION',
    'CONTROLLED\nbody\nCONTROLLED',
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

  it('xlsx/xls/csv spreadsheets extract and store (Ask W1 parity)', async () => {
    for (const n of ['pricing.xlsx', 'legacy.xls', 'rates.csv']) {
      s.calls.uploads = []; s.calls.inserts = [];
      const r = await saveVaultUpload(
        input({ file: file(n, 'CLIN,Qty\n0001,2'), allowedExts: ASK_MINDY_UPLOAD_EXTS }),
        { db: s.db, storage: s.storage, resolveScope: own, now: () => 7 },
      );
      expect(r).toMatchObject({ ok: true });
      expect(s.calls.uploads).toHaveLength(1);
      expect(s.calls.inserts).toHaveLength(1);
    }
  });

  it('Vault panel allow-list refuses spreadsheet types (A4: no fleet xlsx on merge)', async () => {
    for (const n of ['pricing.xlsx', 'rates.csv']) {
      const r = await saveVaultUpload(
        input({ file: file(n, 'CLIN,Qty\n0001,2'), allowedExts: VAULT_PANEL_EXTS, source: 'vault', docClass: 'company' }),
        { db: s.db, storage: s.storage, resolveScope: own },
      );
      expect(r).toMatchObject({ ok: false, code: 'unsupported_type', status: 415 });
    }
    expect(s.calls.uploads).toHaveLength(0);
  });

  it('CUI in a CSV is refused before write', async () => {
    const r = await saveVaultUpload(
      input({ file: file('roster.csv', 'CUI\nName,SSN'), allowedExts: ASK_MINDY_UPLOAD_EXTS }),
      { db: s.db, storage: s.storage, resolveScope: own },
    );
    expect(r).toMatchObject({ ok: false, code: 'prohibited_marking', status: 422 });
    expect(s.calls.uploads).toHaveLength(0);
  });

  it('padded spreadsheet banner cells still refuse (CUI,/SECRET,,)', async () => {
    // Real extractXlsx pads short rows — marking scan must see bare CUI/SECRET cells.
    const pdf = await import('@/lib/sam/pdf-extract');
    vi.mocked(pdf.extractXlsx).mockImplementation(async (b: Buffer) => {
      // Simulate padded CSV body the real extractor produces for a 3-col sheet
      const raw = b.toString('utf-8');
      if (raw.startsWith('CUI')) return { text: '=== Sheet: Sheet1 ===\nCUI,,\nName,SSN,Role\nA,1,x' };
      if (raw.startsWith('SECRET')) return { text: '=== Sheet: Sheet1 ===\nSECRET,,\nName,SSN,Role\nA,1,x' };
      return { text: raw };
    });
    for (const [name, body] of [['cui.xlsx', 'CUI'], ['sec.xlsx', 'SECRET']] as const) {
      s.calls.uploads = []; s.calls.inserts = [];
      const r = await saveVaultUpload(
        input({ file: file(name, body), allowedExts: ASK_MINDY_UPLOAD_EXTS }),
        { db: s.db, storage: s.storage, resolveScope: own },
      );
      expect(r, name).toMatchObject({ ok: false, code: 'prohibited_marking', status: 422 });
      expect(s.calls.uploads, name).toHaveLength(0);
    }
  });

  async function xlsxWithOddHeader(headerXml: string): Promise<Buffer> {
    const { zipSync, strToU8 } = await import('fflate');
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><headerFooter><oddHeader>${headerXml}</oddHeader><oddFooter></oddFooter></headerFooter><sheetData/></worksheet>`;
    return Buffer.from(zipSync({
      'xl/worksheets/sheet1.xml': strToU8(sheet),
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    }));
  }

  it('xlsx print-header CUI is refused (A4)', async () => {
    const cases: Array<{ header: string; kind: 'cui' | 'classified'; name: string }> = [
      { name: 'center-plain', header: '&amp;C CUI', kind: 'cui' },
      { name: 'bold-font', header: '&amp;C&amp;"-,Bold"CUI', kind: 'cui' },
      { name: 'font-size', header: '&amp;C&amp;"Arial,Bold"&amp;14CUI', kind: 'cui' },
      { name: 'red-color', header: '&amp;C&amp;KFF0000CUI', kind: 'cui' },
      { name: 'left-with-page', header: '&amp;LCUI&amp;RPage &amp;P of &amp;N', kind: 'cui' },
      { name: 'secret-control', header: '&amp;CSECRET//NOFORN', kind: 'classified' },
    ];
    for (const c of cases) {
      const buf = await xlsxWithOddHeader(c.header);
      const hf = await xlsxHeaderFooterText(buf);
      expect(hf, c.name).toMatch(c.kind === 'cui' ? /CUI/ : /SECRET/);
      expect(detectProhibitedMarkings({ body: 'Agency,Rate\nVA,10', headerFooter: hf }), c.name)
        .toMatchObject({ blocked: true, kind: c.kind });
    }
    // Cell extract alone is clean — styled print header must still refuse the upload
    const pdf = await import('@/lib/sam/pdf-extract');
    vi.mocked(pdf.extractXlsx).mockResolvedValue({ text: 'Agency,Rate\nVA,10' });
    const buf = await xlsxWithOddHeader('&amp;C&amp;"-,Bold"CUI');
    const r = await saveVaultUpload(
      input({ file: { name: 'marked.xlsx', size: buf.length, buffer: buf }, allowedExts: ASK_MINDY_UPLOAD_EXTS }),
      { db: s.db, storage: s.storage, resolveScope: own },
    );
    expect(r).toMatchObject({ ok: false, code: 'prohibited_marking', status: 422 });
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

describe('C15 rate limits', () => {
  beforeEach(() => __resetVaultLocalLimits());

  it('over the upload limit: 429, nothing extracted or stored, scope never resolved', async () => {
    const s = stubs();
    const resolveScope = vi.fn(own);
    const limit = vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 120, message: 'slow down' }));
    const r = await saveVaultUpload(input(), { db: s.db, storage: s.storage, resolveScope, limit });
    expect(r).toMatchObject({ ok: false, status: 429, code: 'rate_limited', retryAfterSeconds: 120 });
    expect(limit).toHaveBeenCalledWith('upload', 'owner@x.com');
    expect(resolveScope).not.toHaveBeenCalled();
    expect(s.calls.uploads).toHaveLength(0);
    expect(s.calls.inserts).toHaveLength(0);
  });

  it('keys on the verified caller, per kind', async () => {
    await checkVaultLimit('upload', 'Coach@Firm.com');
    await checkVaultLimit('parse', 'coach@firm.com');
    const keys = vi.mocked(checkRateLimit).mock.calls.slice(-2).map((c) => [c[0], c[1], c[2]]);
    expect(keys).toEqual([
      ['vaultupload:coach@firm.com', VAULT_LIMITS.upload.limit, 3600],
      ['vaultparse:coach@firm.com', VAULT_LIMITS.parse.limit, 3600],
    ]);
  });

  it('KV down (limiter allows) → per-instance backstop still caps uploads', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < VAULT_LIMITS.upload.limit + 1; i++) results.push((await checkVaultLimit('upload', 'a@x.com')).allowed);
    expect(results.slice(0, VAULT_LIMITS.upload.limit).every(Boolean)).toBe(true);
    expect(results[VAULT_LIMITS.upload.limit]).toBe(false);
  });

  it('KV says over the limit → refused with a retry time', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 20, resetAt: Math.floor(Date.now() / 1000) + 90 });
    const r = await checkVaultLimit('parse', 'b@x.com');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
});
