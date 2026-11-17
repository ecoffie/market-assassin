/**
 * Marking detection against REAL file bytes, no extractor mocks:
 *   - a DOCX whose banners are ONLY in the page header/footer (review HIGH, 2026-11-17):
 *     the shared body extractor drops them, the marking check must not;
 *   - the pinned false-negative and false-positive cases from that review;
 *   - an unmarked DoD RFP as the false-positive control.
 */
import { describe, it, expect, vi } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Header, Footer } from 'docx';
import { extractDocx } from '@/lib/sam/pdf-extract';
import { detectProhibitedMarkings, docxHeaderFooterText } from './marking-detect';
import { saveVaultUpload } from './upload';
import { DOD_RFP_SAMPLE } from './__fixtures__/dod-rfp-sample';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';

async function docxWith(opts: { header?: string; footer?: string; body: string[] }): Promise<Buffer> {
  const p = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const doc = new Document({
    sections: [{
      headers: opts.header ? { default: new Header({ children: [p(opts.header)] }) } : undefined,
      footers: opts.footer ? { default: new Footer({ children: [p(opts.footer)] }) } : undefined,
      children: opts.body.map(p),
    }],
  });
  return Packer.toBuffer(doc);
}

describe('DOCX header/footer banners (real bytes)', () => {
  it('the shared body extractor drops headers/footers (why the separate read exists)', async () => {
    const buf = await docxWith({ header: 'CUI', footer: 'CUI//SP-PRVCY', body: ['Statement of Work', 'The contractor shall mow lawns.'] });
    const { text } = await extractDocx(buf);
    expect(text).not.toMatch(/CUI/);
    expect(detectProhibitedMarkings(text).blocked).toBe(false);
    const hf = await docxHeaderFooterText(buf);
    expect(hf).toContain('CUI');
    expect(detectProhibitedMarkings({ body: text, headerFooter: hf })).toMatchObject({ blocked: true, kind: 'cui' });
  });

  it('header-only classification banner is caught', async () => {
    const buf = await docxWith({ header: 'SECRET//NOFORN', body: ['Mission overview'] });
    const hf = await docxHeaderFooterText(buf);
    expect(detectProhibitedMarkings({ body: (await extractDocx(buf)).text, headerFooter: hf }).kind).toBe('classified');
  });

  it('spelled-out banner in a header counts once (a header repeats on every page)', async () => {
    const buf = await docxWith({ header: 'CONTROLLED UNCLASSIFIED INFORMATION', body: ['Roster'] });
    expect(detectProhibitedMarkings({ body: 'Roster', headerFooter: await docxHeaderFooterText(buf) }).kind).toBe('cui');
  });

  it('a non-DOCX buffer yields empty header text, never a throw', async () => {
    expect(await docxHeaderFooterText(Buffer.from('not a zip'))).toBe('');
  });

  it('saveVaultUpload refuses a header-banner DOCX and stores NOTHING', async () => {
    const buf = await docxWith({ header: 'CUI', body: ['Plain body text for a statement of work.'] });
    const uploads: string[] = [];
    const inserts: unknown[] = [];
    const storage = {
      listBuckets: vi.fn(async () => ({ data: [{ name: 'vault-assets' }] })),
      createBucket: vi.fn(async () => ({ error: null })),
      from: vi.fn(() => ({
        upload: vi.fn(async (p: string) => { uploads.push(p); return { error: null }; }),
        remove: vi.fn(async () => ({ error: null })),
      })),
    };
    const db = { from: vi.fn(() => ({ insert: (r: unknown) => { inserts.push(r); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'x' }, error: null }) }) }; } })) };
    const own = async (email: string): Promise<ChatActingScope> => ({ kind: 'own', email });
    const r = await saveVaultUpload(
      { callerEmail: 'o@x.com', request: { headers: { get: () => null } }, file: { name: 'sow.docx', size: buf.length, buffer: buf }, docClass: 'reference', source: 'ask_mindy' },
      { db, storage, resolveScope: own },
    );
    expect(r).toMatchObject({ ok: false, code: 'prohibited_marking', markingKind: 'cui' });
    expect(uploads).toEqual([]);
    expect(inserts).toEqual([]);
    expect(storage.listBuckets).not.toHaveBeenCalled();
  });
});

describe('pinned false negatives (must block)', () => {
  const long = 'x'.repeat(250);
  const cases: Array<[string, string, 'classified' | 'cui']> = [
    ['banner merged into a body line (PDF extraction)', 'CUI Page 1 of 12 Statement of Work for Base Operations', 'cui'],
    ['page number then banner', 'Contract W912PL-27-C-0001 Page 3 of 9 SECRET', 'classified'],
    ['classification banner merged with page number', 'SECRET Page 2 of 40 Mission Overview', 'classified'],
    ['control marking on a line over 200 chars', `${long} SECRET//NOFORN ${long}`, 'classified'],
    ['CUI control marking on a long line', `${long} CUI//SP-PRVCY ${long}`, 'cui'],
    ['level + control token mid-sentence', 'The briefing is marked TOP SECRET//HCS at the header.', 'classified'],
  ];
  for (const [name, text, kind] of cases) {
    it(name, () => expect(detectProhibitedMarkings(text)).toMatchObject({ blocked: true, kind }));
  }
});

describe('pinned false positives (must pass)', () => {
  const cases: Array<[string, string]> = [
    ['"Controlled by:" + CUI mentioned in DFARS prose', 'Controlled by: the program office\nThe contractor shall safeguard CUI per DFARS 252.204-7012.'],
    ['spelled-out CUI heading appearing once in the body', 'C.3 SECURITY\nCONTROLLED UNCLASSIFIED INFORMATION\nThe contractor shall protect CUI.'],
    ['COMPANY CONFIDENTIAL//PROPRIETARY proposal stamp', 'COMPANY CONFIDENTIAL//PROPRIETARY'],
    ['TRADE SECRET//PROPRIETARY proposal stamp', 'TRADE SECRET//PROPRIETARY'],
    ['doubled slash inside a URL', 'See HTTPS://WWW.SAM.GOV//SI for details.'],
    ['URL path with a control-looking segment', 'Download from https://example.mil//NOFORN/readme'],
    ['"SECRET clearance" at line start', 'SECRET clearance required for all on-site staff.'],
    ['Secretary of the Army', 'The Secretary of the Army approved the plan.'],
  ];
  for (const [name, text] of cases) {
    it(name, () => expect(detectProhibitedMarkings(text).blocked).toBe(false));
  }

  it('CONTROL: an unmarked DoD RFP (CUI prose, clearances, headings, URLs, outlines) is accepted', () => {
    expect(detectProhibitedMarkings(DOD_RFP_SAMPLE)).toEqual({ blocked: false });
  });

  it('the same RFP WITH a repeated spelled-out banner is refused (control is sensitive)', () => {
    const marked = `CONTROLLED UNCLASSIFIED INFORMATION\n${DOD_RFP_SAMPLE}\nCONTROLLED UNCLASSIFIED INFORMATION`;
    expect(detectProhibitedMarkings(marked).kind).toBe('cui');
  });
});
