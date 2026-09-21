import { describe, it, expect } from 'vitest';
import { parseGaoRss, resolveDocumentAgency, ingestInstituteDocument, type InstituteDocument } from './sources';
import CODES from '@/data/agency-toptier-codes.json';

const NAMES = Object.keys(CODES as Record<string, unknown>);

const RSS = `<rss><channel>
<item><title>Disaster Risk: Improvements Needed to Enhance FEMA's National Risk Index</title>
<link>https://www.gao.gov/products/gao-26-107894</link>
<pubDate>Thu, 10 Sep 2026 07:26:10 -0400</pubDate>
<description>FEMA — a component within the Department of Homeland Security — ...</description></item>
<item><title>Nuclear Security Enterprise: Strategic Partnership Projects Can Support Mission</title>
<link>https://www.gao.gov/products/gao-26-108229</link>
<pubDate>Thu, 10 Sep 2026 07:15:19 -0400</pubDate>
<description>The National Nuclear Security Administration (NNSA) ...</description></item>
</channel></rss>`;

const doc = (o: Partial<InstituteDocument> = {}): InstituteDocument => ({
  sourceOrg: 'GAO', sourceType: 'gao_report', documentNumber: 'GAO-26-000001',
  title: 'T', url: 'https://www.gao.gov/products/gao-26-000001',
  publicationDate: '2026-09-10', abstract: null, ...o,
});

describe('Institute ingestion — provenance survives', () => {
  it('preserves document number, url, publication date and title', () => {
    const [a] = parseGaoRss(RSS);
    expect(a.documentNumber).toBe('GAO-26-107894');
    expect(a.url).toBe('https://www.gao.gov/products/gao-26-107894');
    expect(a.publicationDate).toBe('2026-09-10');
    expect(a.sourceOrg).toBe('GAO');
    expect(a.title).toMatch(/Disaster Risk/);
  });
});

describe('Institute ingestion — agency identity', () => {
  it('resolves a canonical agency named in the abstract', () => {
    const r = resolveDocumentAgency(parseGaoRss(RSS)[0], NAMES);
    expect(r.canonicalAgency).toBe('Department of Homeland Security');
    expect(r.method).toBe('exact_name');
  });

  it('resolves NNSA via curated phrase → Department of Energy', () => {
    const r = resolveDocumentAgency(parseGaoRss(RSS)[1], NAMES);
    expect(r.resolved).toBe(true);
    expect(r.canonicalAgency).toBe('Department of Energy');
  });

  it('UNRESOLVED STAYS UNRESOLVED when no agency phrase is present', () => {
    const r = resolveDocumentAgency(doc({ title: 'Priority Open Recommendations: Selected Topics', abstract: 'A status report.' }), NAMES);
    expect(r.resolved).toBe(false);
    expect(r.canonicalAgency).toBeNull();
  });

  /** The Potato 0 defect: one document fanning out to several agencies. */
  it('REFUSES when two agencies are named — no fan-out, ever', () => {
    const d = doc({ abstract: 'Both the Department of Energy and the Department of Commerce were reviewed.' });
    expect(resolveDocumentAgency(d, NAMES).resolved).toBe(false);
  });

  /** "ICE" inside "Services", "EPA" inside "Department". */
  it('never resolves on a substring hiding inside a word', () => {
    const d = doc({ title: 'Customer Services Review', abstract: 'Departmental oversight of services.' });
    expect(resolveDocumentAgency(d, NAMES).canonicalAgency).toBeNull();
  });

  it('resolves FAA title to Department of Transportation without force-mapping multi-agency', () => {
    const d = doc({
      title: 'Flight Simulators: FAA Should Take Steps to Ensure Oversight Efforts Address Increased Workload',
      abstract: 'The Federal Aviation Administration (FAA) uses the National Simulator Program.',
    });
    expect(resolveDocumentAgency(d, NAMES).canonicalAgency).toBe('Department of Transportation');
  });
});

function stubDb(exists = false) {
  const ops: string[] = [];
  return {
    ops,
    db: {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain; chain.eq = () => chain;
        chain.maybeSingle = async () => ({ data: exists ? { id: 'src-1' } : null, error: null });
        chain.insert = () => { ops.push(`insert:${table}`); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'src-1' }, error: null }) }) }; };
        return chain;
      },
    } as never,
  };
}

describe('Institute ingestion — idempotency', () => {
  it('inserts once on first sight', async () => {
    const { ops, db } = stubDb(false);
    const r = await ingestInstituteDocument(db, doc(), NAMES);
    expect(r.inserted).toBe(true);
    expect(ops).toContain('insert:institute_sources');
  });

  it('does NOT duplicate an already-stored document', async () => {
    const { ops, db } = stubDb(true);
    const r = await ingestInstituteDocument(db, doc(), NAMES);
    expect(r.inserted).toBe(false);
    expect(r.instituteSourceId).toBe('src-1');
    expect(ops).not.toContain('insert:institute_sources');
  });

  it('keeps an UNRESOLVED document in the corpus (evidence is valuable regardless)', async () => {
    const { ops, db } = stubDb(false);
    const r = await ingestInstituteDocument(db, doc({ title: 'Banking Services: Challenges' }), NAMES);
    expect(r.inserted).toBe(true);
    expect(r.resolution.resolved).toBe(false);
    expect(ops).toContain('insert:institute_sources');
  });
});
