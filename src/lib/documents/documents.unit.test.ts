/**
 * Document engine: model validation (incl. FACTS MUST CITE), shared formatting, both renderers,
 * the never-silent PDF degrade, extraction, and the module boundary.
 *
 * Hermetic: no network, no database, no browser. Chromium is stubbed; the real-browser render is
 * exercised by scripts/documents/render-fixture.ts and on the preview deployment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const pdfState = vi.hoisted(() => ({ result: { pdf: null as Buffer | null, error: 'no browser' as string | null }, calls: [] as Array<{ html: string; opts: Record<string, unknown>; options?: Record<string, unknown> }> }));
vi.mock('@/lib/pdf/launch-browser', () => ({
  htmlToPdf: async (html: string, opts: Record<string, unknown>, options?: Record<string, unknown>) => { pdfState.calls.push({ html, opts, options }); return pdfState.result; },
}));

import { SAMPLE_REPORT } from './__fixtures__/sample-report';
import { DOC_SCHEMA, type DocModel } from './model';
import { validateDocModel, demoteUncitedFacts, hardenedAssumptions, DEFAULT_ASSUMPTION_ORIGIN } from './validate';
import { citationIndex, citeMarker, formatCell, parseInline, NOT_AVAILABLE, fileBaseName } from './format';
import { renderHtml } from './render-html';
import { renderDocx } from './render-docx';
import { renderPdf, pdfOptions } from './render-pdf';
import { renderDocument } from './index';
import { chartToSvg } from './charts';
import { inferKind, extractByKind, extractDocx } from './extract';

const clone = (): DocModel => JSON.parse(JSON.stringify(SAMPLE_REPORT));
const tiny = (over: Partial<DocModel> = {}): DocModel => ({
  schema: DOC_SCHEMA,
  title: 'Tiny',
  date: '2026-11-17',
  sources: [{ id: 's1', kind: 'web', label: 'Source one', url: 'https://example.com/a' }],
  sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'Hello', claim: 'fact', cites: ['s1'] }] }],
  ...over,
});
const issuesOf = (m: unknown) => { const r = validateDocModel(m); return r.ok ? [] : r.issues.map((i) => i.message); };

beforeEach(() => { pdfState.calls = []; pdfState.result = { pdf: null, error: 'no browser' }; });

describe('validateDocModel', () => {
  it('accepts the fixture report', () => {
    expect(issuesOf(SAMPLE_REPORT)).toEqual([]);
  });

  it('FACTS MUST CITE: an uncited fact is rejected', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'Spend was $5M.', claim: 'fact' }] }] });
    expect(issuesOf(m).join(' ')).toMatch(/a fact must cite at least one source/);
  });

  it('FACTS MUST CITE: a fact citing only an unknown source is rejected', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'fact', cites: ['nope'] }] }] });
    const msgs = issuesOf(m).join(' ');
    expect(msgs).toMatch(/unknown source\(s\) nope/);
    expect(msgs).toMatch(/a fact must cite/);
  });

  it('FACTS MUST CITE: applies to each bullet, table, chart and callout', () => {
    const m = tiny({
      sections: [{
        id: 'a', heading: 'A', blocks: [
          { type: 'bullets', id: 'b', items: [{ text: 'ok', claim: 'fact', cites: ['s1'] }, { text: 'bad', claim: 'fact' }] },
          { type: 'table', id: 't', claim: 'fact', columns: [{ key: 'k', label: 'K' }], rows: [{ k: 1 }] },
          { type: 'chart', id: 'c', kind: 'bar', claim: 'fact', series: [{ name: 'n', points: [{ x: 'a', y: 1 }] }] },
          { type: 'callout', id: 'co', tone: 'note', text: 't', claim: 'fact' },
        ],
      }],
    });
    const msgs = issuesOf(m);
    expect(msgs.filter((x) => /a fact must cite/.test(x))).toHaveLength(4);
    expect(msgs.join(' ')).toMatch(/b\[1\]/);
  });

  it('assumptions, recommendations, unverified and context need no citation', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Likely', claim: 'assumption', origin: 'Stated for planning; not verified.' },
      { type: 'paragraph', id: 'p2', text: 'Do this', claim: 'recommendation' },
      { type: 'paragraph', id: 'p3', text: 'Untraced', claim: 'unverified' },
    ] }, { id: 'm', heading: 'Method', role: 'about', blocks: [
      { type: 'paragraph', id: 'p4', text: 'This report covers buyers and how to read it.', claim: 'context' },
    ] }] });
    expect(issuesOf(m)).toEqual([]);
  });

  it('context is allowed only in an "about" section (cover / how to read / method)', () => {
    const body = tiny({ sections: [{ id: 'a', heading: 'Competition', blocks: [
      { type: 'paragraph', id: 'p', text: 'The incumbent is Acme and the award was sole-source.', claim: 'context' },
      { type: 'paragraph', id: 'q', text: 'SDVOSB only.', claim: 'context' },
    ] }] });
    expect(issuesOf(body).filter((x) => /context is allowed only in a section with role 'about'/.test(x))).toHaveLength(2);
  });

  it('context with a number written in WORDS is rejected, even in an about section', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'Method', role: 'about', blocks: [
      { type: 'paragraph', id: 'p', text: 'The market is worth forty-two million dollars.', claim: 'context' },
    ] }] });
    expect(issuesOf(m).join(' ')).toMatch(/context may not contain numbers \(in digits or words\)/);
  });

  it('unverified + critical set directly by the model is rejected by the validator', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p', text: 'Proposals due 12 Dec.', claim: 'unverified', critical: true },
    ] }] });
    expect(issuesOf(m).join(' ')).toMatch(/decision-critical statement cannot be unverified/);
  });

  it('a recommendation or assumption stating a count/amount (digits or words) must cite', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'r1', text: 'Track the eight VA recompetes.', claim: 'recommendation' },
      { type: 'paragraph', id: 'r2', text: 'Expect $640M a year to recompete.', claim: 'assumption' },
      { type: 'paragraph', id: 'ok1', text: 'Track the eight VA recompetes.', claim: 'recommendation', cites: ['s1'] },
      { type: 'paragraph', id: 'ok2', text: 'Pursue teaming with an 8(a) firm for FY26 Q3 set-asides.', claim: 'recommendation' },
      { type: 'paragraph', id: 'ok3', text: 'Call one of the buying offices first.', claim: 'recommendation' },
    ] }] });
    const msgs = issuesOf(m).filter((x) => /must cite its source/.test(x));
    expect(msgs.map((x) => x.match(/\((\w+)\)$/)?.[1])).toEqual(['r1', 'r2']);
  });

  // Eric, 2026-11-17: strategic assumptions are allowed when labeled ASSUMPTION and may state a planning
  // figure; an unsupported FACTUAL claim must be cited, shown "Unverified — no source", or omitted.
  describe('ASSUMPTION: may plan, may not assert', () => {
    const planning = [
      'We assume a ~$2M annual budget for planning.',
      'Budget roughly 5% for travel.',
      'For planning, assume three FTEs on the transition team.',
      'We will target two proposals a quarter.',
      'Fourth-quarter spikes suggest year-end buying; expect the largest award volume in July through September.',
      'Vendor rankings reflect obligations, not win rates.',
      // Customer-environment planning figures, framed as premises: strategic assumptions (Eric's rule,
      // settled 2026-11-17 — allowed, pinned so a later tightening cannot silently reject them).
      'Assume the program has 250 users across 12 sites.',
      'We assume 400 employees for planning.',
      'For planning, assume a 10% win rate.',
      'We assume the RFP drops in Q2 FY2027 for planning.',
    ];
    const factual: Array<[string, string]> = [
      ['award value about a named company', 'We assume Acme Federal holds a $40M ceiling.'],
      ['obligation figure', 'We assume the agency obligated $12M last year.'],
      ['contract ceiling', 'Assume a $250M ceiling on the follow-on contract.'],
      ['count of buyers', 'We assume 12 offices buy this service.'],
      ['count of bidders', 'For planning, assume 5 bidders.'],
      ['contract number', 'Assume W912PL21C0001 runs $8M a year.'],
      ['incumbent (no figure)', 'We assume Delta Corp is the incumbent.'],
      ['specific date', 'We assume the RFP releases March 15.'],
      ['deadline', 'Assume proposals are due by the end of the quarter.'],
      ['unframed figure', 'Expect $640M a year to recompete.'],
      // A4 round 2 probes — verb forms, agency names, a winner with no figure:
      ['agency + "spends" (verb)', 'We assume the VA spends $5M a year on janitorial services.'],
      ['agency + "buys" + share', 'Assume GSA buys 40% of this work.'],
      ['obligated (verb), named service', 'We assume the Navy obligated $12M.'],
      ['agency acronym + count of orders', 'We assume NASA will issue two task orders.'],
      ['"went to" a company, no figure', 'Assume the contract went to Acme.'],
    ];
    const ORIGIN = "This analysis models these figures; they were not verified against the customer's records.";
    const one = (text: string, extra: Record<string, unknown> = {}) =>
      tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text, claim: 'assumption', origin: ORIGIN, ...extra }] }] });

    it.each(planning)('a planning assumption passes uncited: %s', (text) => {
      expect(issuesOf(one(text))).toEqual([]);
      expect(demoteUncitedFacts(one(text)).unverified).toEqual([]);
    });

    it.each(factual)('a factual claim dressed as an assumption must cite (%s)', (_why, text) => {
      expect(issuesOf(one(text)).join(' ')).toMatch(/an assumption may state a planning figure, but a factual claim .* must cite its source \(p\)/);
      expect(issuesOf(one(text, { cites: ['s1'] }))).toEqual([]); // verified: cited to a source in the doc
    });

    it('demotion: an uncited factual assumption becomes "Unverified — no source"; a critical one is omitted', () => {
      const d = demoteUncitedFacts(one('We assume Acme Federal holds a $40M ceiling.'));
      expect(d.unverified).toEqual(['p']);
      expect(d.model.sections[0].blocks[0]).toMatchObject({ claim: 'unverified' });
      expect(issuesOf(d.model)).toEqual([]);
      const c = demoteUncitedFacts(one('Assume proposals are due by the end of the quarter.', { critical: true }));
      expect(c.omitted).toEqual(['p']);
      expect(c.model.sections[0].blocks).toEqual([]);
      const keep = demoteUncitedFacts(one('We assume a ~$2M annual budget for planning.'));
      expect(keep.model.sections[0].blocks[0]).toMatchObject({ claim: 'assumption' });
    });

    // Eric's qualification (2026-11-17), rule 1: origin must be explicit.
    it('an uncited assumption must state its origin; demotion supplies the honest default', () => {
      const bare = one('Assume the program has 250 users across 12 sites.', { origin: undefined });
      expect(issuesOf(bare).join(' ')).toMatch(/an uncited assumption must state its origin \(p\)/);
      const d = demoteUncitedFacts(bare);
      expect(d.model.sections[0].blocks[0]).toMatchObject({ claim: 'assumption', origin: DEFAULT_ASSUMPTION_ORIGIN });
      expect(issuesOf(d.model)).toEqual([]);
      expect(issuesOf(one('Assume the program has 250 users across 12 sites.', { origin: undefined, cites: ['s1'] }))).toEqual([]); // cited: the source is the origin
    });

    it('renders as "Planning assumption" with its origin stated (HTML and DOCX)', async () => {
      const m = one('Assume the program has 250 users across 12 sites.');
      const html = renderHtml(m);
      expect(html).toContain('class="label assumption">Planning assumption</span>Assume the program has 250 users across 12 sites.');
      expect(html).toContain(`<span class="origin">${ORIGIN.replace("'", '&#39;')}</span>`);
      const files = unzipSync(new Uint8Array(await renderDocx(m)));
      const doc = strFromU8(files['word/document.xml']);
      expect(doc).toContain('PLANNING ASSUMPTION');
      expect(doc).toContain('were not verified against the customer');
    });

    it('the unlabeled factual form of a customer figure must cite (fact), or is shown Unverified', () => {
      const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'The customer operates 12 sites serving 250 users.', claim: 'fact' }] }] });
      expect(issuesOf(m).join(' ')).toMatch(/a fact must cite/);
      expect(demoteUncitedFacts(m).model.sections[0].blocks[0]).toMatchObject({ claim: 'unverified' });
    });

    it('origin belongs to assumptions only, and is bounded', () => {
      const f = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'fact', cites: ['s1'], origin: 'y' } as never] }] });
      expect(issuesOf(f).join(' ')).toMatch(/origin applies only to an assumption/);
      expect(issuesOf(one('Assume a modest budget.', { origin: 'z'.repeat(301) })).join(' ')).toMatch(/origin is limited to 300 characters/);
    });

    // Rule 2: never an assumption — cite as a fact, or omit. Never "unverified", never kept as a premise.
    const never: Array<[string, string]> = [
      ['certification', 'We assume the firm holds an active 8(a) certification.'],
      ['certification (SDVOSB)', 'Assume we are SDVOSB-certified for this pursuit.'],
      ['contract award', 'We assume DHS awarded $3M for this work last year.'],
      ['contract award, no figure', 'Assume the Army awarded it to Acme last year.'],
      ['won', 'Assume Acme won the last recompete.'],
      ['past performance', 'We assume strong past performance with the VA.'],
      ['set-aside status', 'Assume the follow-on will be a small-business set-aside.'],
      ['eligibility', 'For planning, assume we are eligible for the HUBZone price preference.'],
      ['size status', 'Assume we qualify as a small business under 541512.'],
      // A4 round 2 misses — spelled-out statuses, natural past-performance phrasing, vehicle holding:
      ['SDVOSB spelled out', 'Assume we are a service-disabled veteran-owned small business.'],
      ['WOSB spelled out', 'We assume we are a woman-owned small business.'],
      ['past performance: previously supported', 'We assume we previously supported the Navy on this requirement.'],
      ['past performance: have performed', 'Assume we have performed three similar contracts for VA.'],
      ['past performance: were the prime', 'Assume we were the prime on the last task order.'],
      ['vehicle holding', 'Assume we hold a GSA MAS contract.'],
      ['SBA-certified company', 'We assume our company is SBA-certified.'],
      ['economically disadvantaged', 'Assume our firm is an economically disadvantaged small business.'],
    ];

    // Over-omission would silently DELETE planning content (demotion omits these), so the false
    // positives are pinned as hard as the misses (A4 round 2).
    const notNever = [
      'We assume certified payroll reporting adds 2 hours a week.',
      'For planning, assume only eligible travel costs are reimbursed.',
      'We assume staff will complete Security+ certification by Q2.',
      'We assume the proposal team qualifies for overtime pay.',
      'We assume we will deliver the draft for review in two weeks.',
      'We assume the agency will use an IDIQ vehicle.',
    ];
    it.each(notNever)('planning that only sounds like a never-topic is kept: %s', (text) => {
      expect(issuesOf(one(text)).join(' ')).not.toMatch(/can never be an assumption/);
      expect(demoteUncitedFacts(one(text)).omitted).toEqual([]);
    });
    it.each(never)('never an assumption (%s): rejected even when cited; demotion OMITS it', (_why, text) => {
      expect(issuesOf(one(text)).join(' ')).toMatch(/can never be an assumption \(p\); label it fact and cite a source, or omit it/);
      expect(issuesOf(one(text, { cites: ['s1'] })).join(' ')).toMatch(/can never be an assumption/);
      for (const m of [one(text), one(text, { cites: ['s1'] })]) {
        const d = demoteUncitedFacts(m);
        expect(d.omitted).toEqual(['p']);
        expect(d.unverified).toEqual([]);
        expect(d.model.sections[0].blocks).toEqual([]);
        expect(issuesOf(d.model)).toEqual([]);
      }
    });

    it('the same topic as a cited FACT is fine (that is the sanctioned form)', () => {
      const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'DHS awarded $3M for this work in FY2025.', claim: 'fact', cites: ['s1'] }] }] });
      expect(issuesOf(m)).toEqual([]);
    });

    // Rule 3: assumptions never harden into facts across revisions.
    it('demotion never turns an assumption into a fact', () => {
      const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
        { type: 'paragraph', id: 'c', text: 'We assume a ~$2M annual budget for planning.', claim: 'assumption', cites: ['s1'] },
        { type: 'paragraph', id: 'u', text: 'We assume a ~$2M annual budget for planning.', claim: 'assumption' },
        { type: 'paragraph', id: 'f', text: 'We assume the agency obligated $12M.', claim: 'assumption' },
      ] }] });
      const claims = demoteUncitedFacts(m).model.sections[0].blocks.map((b) => (b as { claim?: string }).claim);
      expect(claims).toEqual(['assumption', 'assumption', 'unverified']);
    });

    it('hardenedAssumptions flags a revision that re-emits an assumption as a fact (by id or by text)', () => {
      const prev = one('Assume the program has 250 users across 12 sites.');
      const sameId = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'The program has 250 users across 12 sites.', claim: 'fact', cites: ['s1'] }] }] });
      const sameText = tiny({ sections: [{ id: 'b', heading: 'B', blocks: [{ type: 'bullets', id: 'x', items: [{ text: 'Assume the program has 250 users across 12 sites.', claim: 'fact', cites: ['s1'] }] }] }] });
      expect(hardenedAssumptions(prev, sameId)).toEqual(['p']);
      expect(hardenedAssumptions(prev, sameText)).toEqual(['x[0]']);
      expect(hardenedAssumptions(prev, prev)).toEqual([]); // kept as an assumption
      expect(hardenedAssumptions(prev, demoteUncitedFacts(one('Assume the agency obligated $12M.')).model)).toEqual([]); // unverified is not hardening
      const dropped = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'other', text: 'Something else entirely.', claim: 'fact', cites: ['s1'] }] }] });
      expect(hardenedAssumptions(prev, dropped)).toEqual([]); // dropped is not hardening
    });
  });

  it('context in an ABOUT section cannot carry a decision-critical claim (Agent 4 probes, round 4)', () => {
    const probe = (text: string) => issuesOf(tiny({ sections: [{ id: 'm', heading: 'Method', role: 'about', blocks: [{ type: 'paragraph', id: 'p', text, claim: 'context' }] }] }));
    for (const text of [
      'The incumbent is Acme Federal, and the agency intends a sole-source award.',
      'This work is set aside for SDVOSB firms only.',
      'Only 8(a) firms are eligible.',
      'Proposals are due by the end of March.',
      'Delta Corp holds the current contract.',
      'The deadline cannot move.',
    ]) expect(probe(text).join(' '), text).toMatch(/context may not name a company, an incumbent or award, eligibility or set-aside terms, or a date/);
  });

  it('ordinary method/how-to-read prose still passes as context', () => {
    const ok = tiny({ sections: [{ id: 'm', heading: 'How to read', role: 'about', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Readers may treat cited statements as recorded data and should check assumptions before relying on them.', claim: 'context' },
      { type: 'paragraph', id: 'p2', text: 'Coverage is limited to the listed sources; a buyer absent from a table may still buy under another classification.', claim: 'context' },
    ] }] });
    expect(issuesOf(ok)).toEqual([]);
  });

  it('an about section holds at most 4 context blocks of at most 600 chars', () => {
    const blocks = Array.from({ length: 5 }, (_, i) => ({ type: 'paragraph' as const, id: `p${i}`, text: 'How to read this report.', claim: 'context' as const }));
    expect(issuesOf(tiny({ sections: [{ id: 'm', heading: 'M', role: 'about', blocks }] })).join(' ')).toMatch(/at most 4 context blocks/);
    const long = tiny({ sections: [{ id: 'm', heading: 'M', role: 'about', blocks: [{ type: 'paragraph', id: 'p', text: 'word '.repeat(130), claim: 'context' }] }] });
    expect(issuesOf(long).join(' ')).toMatch(/limited to 600 characters/);
  });

  it('fraction words are figures: a recommendation/assumption stating a proportion must cite', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'f1', text: 'Target the offices that place half of all obligations.', claim: 'recommendation' },
      { type: 'paragraph', id: 'f2', text: 'A third of buyers will recompete early.', claim: 'assumption' },
      { type: 'paragraph', id: 'f3', text: 'Focus where most buyers use set-asides.', claim: 'recommendation' },
      { type: 'paragraph', id: 'f4', text: 'A quarter of spending goes to two vendors.', claim: 'assumption' },
      { type: 'paragraph', id: 'f5', text: 'Three quarters of awards are set aside.', claim: 'recommendation' },
      { type: 'paragraph', id: 'ok', text: 'Expect fourth-quarter buying to peak.', claim: 'assumption' },
      { type: 'paragraph', id: 'ok2', text: 'Plan outreach before the third quarter ends.', claim: 'recommendation' },
    ] }] });
    const msgs = issuesOf(m).filter((x) => /must cite its source/.test(x));
    expect(msgs.map((x) => x.match(/\((\w+)\)$/)?.[1])).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('demoteUncitedFacts output always validates (misplaced context, uncited figures, critical+unverified)', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'c1', text: 'Incumbent is Acme.', claim: 'context' },
      { type: 'paragraph', id: 'r1', text: 'Track the eight recompetes.', claim: 'recommendation' },
      { type: 'paragraph', id: 'u1', text: 'Due 12 Dec.', claim: 'unverified', critical: true },
      { type: 'paragraph', id: 'r2', text: 'Introduce yourself early.', claim: 'recommendation' },
    ] }] });
    const { model, unverified, omitted } = demoteUncitedFacts(m);
    expect(unverified).toEqual(['c1', 'r1']);
    expect(omitted).toEqual(['u1']);
    expect(issuesOf(model)).toEqual([]);
  });

  it('an unverified statement carries no cites ("no source" beside [n] contradicts itself)', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'The office buys cleaning.', claim: 'unverified', cites: ['s1'] },
      { type: 'bullets', id: 'b', items: [{ text: 'x', claim: 'unverified', cites: ['s1'] }] },
    ] }] });
    expect(issuesOf(m).filter((x) => /unverified statement carries no cites/.test(x))).toHaveLength(2);
  });

  it('demoteUncitedFacts drops dangling cite ids so its output validates', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'only', text: 'Only a hallucinated source.', claim: 'fact', cites: ['s9'] },
      { type: 'paragraph', id: 'mixed', text: 'One real, one not.', claim: 'fact', cites: ['s1', 's9'] },
      { type: 'paragraph', id: 'uv', text: 'Producer doubts it.', claim: 'unverified', cites: ['s1'] },
    ] }] });
    expect(issuesOf(m)).not.toEqual([]);
    const { model, unverified, omitted, droppedCites } = demoteUncitedFacts(m);
    expect(unverified).toEqual(['only']);
    expect(omitted).toEqual([]);
    // Reported, not silent — including 'mixed', which stays a fact on its real source.
    expect(droppedCites).toEqual([{ where: 'only', ids: ['s9'] }, { where: 'mixed', ids: ['s9'] }]);
    const [only, mixed, uv] = model.sections[0].blocks as Array<{ claim?: string; cites?: string[] }>;
    expect(only).toMatchObject({ claim: 'unverified' });
    expect(only.cites).toBeUndefined();
    expect(mixed).toMatchObject({ claim: 'fact', cites: ['s1'] });
    expect(uv).toMatchObject({ claim: 'unverified' });
    expect(uv.cites).toBeUndefined();
    expect(issuesOf(model)).toEqual([]);
    expect(renderHtml(model)).not.toMatch(/Producer doubts it\.<sup/);
  });

  it('M1: an UNLABELED block or bullet item is rejected (it used to skip facts-must-cite)', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Spend was $5M.' },
      { type: 'bullets', id: 'b', items: [{ text: 'ok', claim: 'fact', cites: ['s1'] }, { text: 'Awarded to Acme.' }] },
      { type: 'table', id: 't', columns: [{ key: 'k', label: 'K' }], rows: [{ k: 1 }] },
    ] }] });
    const msgs = issuesOf(m).filter((x) => /a claim label is required/.test(x));
    expect(msgs).toHaveLength(3);
    expect(msgs.join(' ')).toMatch(/b\[1\]/);
  });

  it('M2: there is no "estimate" label', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'estimate' as never }] }] });
    expect(issuesOf(m).join(' ')).toMatch(/unknown claim "estimate".*no estimate label/);
  });

  it('context may not carry a number, a table or a chart (a figure is a claim)', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p', text: 'The market is $2B.', claim: 'context' },
      { type: 'table', id: 't', claim: 'context', columns: [{ key: 'k', label: 'K' }], rows: [] },
    ] }] });
    expect(issuesOf(m).filter((x) => /context may not contain/.test(x))).toHaveLength(2);
  });

  it('rejects structural problems', () => {
    expect(issuesOf({})).not.toEqual([]);
    expect(issuesOf(tiny({ schema: 'other' as never })).join(' ')).toMatch(/mindy\.doc\/1/);
    expect(issuesOf(tiny({ date: '11/17/2026' })).join(' ')).toMatch(/YYYY-MM-DD/);
    expect(issuesOf(tiny({ sections: [] })).join(' ')).toMatch(/at least one section/);
    const dup = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'a', text: 'x', claim: 'context' }] }] });
    expect(issuesOf(dup).join(' ')).toMatch(/duplicate id "a"/);
    const badType = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'script', id: 'x' } as never] }] });
    expect(issuesOf(badType).join(' ')).toMatch(/unknown block type/);
  });

  it('table values must be declared, finite or null; missing is null, never NaN', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'table', id: 't', columns: [{ key: 'k', label: 'K' }], rows: [{ k: Number.NaN }, { other: 'x' }] }] }] });
    const msgs = issuesOf(m).join(' ');
    expect(msgs).toMatch(/finite number or null/);
    expect(msgs).toMatch(/not a declared column/);
  });

  it('a pie chart has exactly one series and no negative values', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'chart', id: 'c', kind: 'pie', series: [{ name: 'a', points: [{ x: 'x', y: -1 }] }, { name: 'b', points: [{ x: 'x', y: 1 }] }] }] }] });
    const msgs = issuesOf(m).join(' ');
    expect(msgs).toMatch(/exactly one series/);
    expect(msgs).toMatch(/cannot be negative/);
  });

  it('source urls must be http(s)', () => {
    expect(issuesOf(tiny({ sources: [{ id: 's1', kind: 'web', label: 'x', url: 'javascript:alert(1)' }] })).join(' ')).toMatch(/http\(s\) URL/);
  });

  it('demoteUncitedFacts: non-critical → "unverified" (text kept); never relabels as estimate or assumption', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Uncited', claim: 'fact' },
      { type: 'bullets', id: 'b', items: [{ text: 'cited', claim: 'fact', cites: ['s1'] }, { text: 'bad', claim: 'fact', cites: ['zzz'] }] },
    ] }] });
    const { model, unverified, omitted } = demoteUncitedFacts(m);
    expect(unverified).toEqual(['p1', 'b[1]']);
    expect(omitted).toEqual([]);
    expect(issuesOf(model)).toEqual([]); // the dangling "zzz" is dropped, so the repaired model validates
    expect(demoteUncitedFacts(m).droppedCites).toEqual([{ where: 'b[1]', ids: ['zzz'] }]);
    const p1 = model.sections[0].blocks[0];
    expect(p1.type === 'paragraph' && p1.claim).toBe('unverified');
    expect(p1.type === 'paragraph' && p1.text).toBe('Uncited');
    expect(JSON.stringify(model)).not.toMatch(/estimate|assumption/);
  });

  it('demoteUncitedFacts: a decision-critical uncited statement is OMITTED, not labeled', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Proposals are due 12 Dec.', claim: 'fact', critical: true },
      { type: 'paragraph', id: 'p2', text: 'Cited and critical', claim: 'fact', critical: true, cites: ['s1'] },
      { type: 'bullets', id: 'b', items: [{ text: 'Ceiling is $40M', claim: 'fact', critical: true }] },
      { type: 'paragraph', id: 'p3', text: 'Unlabeled, uncited' },
    ] }] });
    const { model, unverified, omitted } = demoteUncitedFacts(m);
    expect(omitted).toEqual(['p1', 'b[0]']);
    expect(unverified).toEqual(['p3']);
    const ids = model.sections[0].blocks.map((b) => b.id);
    expect(ids).toEqual(['p2', 'p3']); // all-omitted bullets block removed
    expect(JSON.stringify(model)).not.toMatch(/12 Dec|\$40M/);
    expect(issuesOf(model)).toEqual([]);
  });
});

describe('format helpers', () => {
  it('a missing value is "Not available", never 0', () => {
    expect(formatCell(null, 'usd')).toBe(NOT_AVAILABLE);
    expect(formatCell('', 'int')).toBe(NOT_AVAILABLE);
    expect(formatCell(0, 'usd')).toBe('$0');
  });
  it('formats money, integers and percentages', () => {
    expect(formatCell(412_500_000, 'usd')).toBe('$412.5M');
    expect(formatCell(1_930_000_000, 'usd')).toBe('$1.93B');
    expect(formatCell(12_345, 'int')).toBe('12,345');
    expect(formatCell(0.214, 'pct')).toBe('21.4%');
  });
  it('parses only **bold** and _italic_', () => {
    expect(parseInline('a **b** _c_ snake_case')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' snake_case' }]);
  });
  it('numbers sources by first citation; uncited sources follow', () => {
    const { ordered, numberOf } = citationIndex(SAMPLE_REPORT);
    expect(ordered.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(citeMarker(['s3', 's1', 's1'], numberOf)).toBe('[1, 3]');
    expect(citeMarker(['missing'], numberOf)).toBe('');
  });
  it('file names are filesystem-safe', () => {
    expect(fileBaseName('A/B: "report" <2026>')).toBe('A-B-report-2026');
    expect(fileBaseName('///')).toBe('Mindy-document');
  });
});

describe('render-html', () => {
  it('escapes every model string; a model is data, never markup', () => {
    const m = tiny({ title: '<script>alert(1)</script>', sections: [{ id: 'a', heading: '<img src=x onerror=1>', blocks: [{ type: 'paragraph', id: 'p', text: '**<b>x</b>**', claim: 'assumption' }] }] });
    const html = renderHtml(m);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('makes no network requests: no external scripts, stylesheets, fonts or images', () => {
    const html = renderHtml(SAMPLE_REPORT);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it('shows labels, citations, Not available and a numbered Sources section', () => {
    const html = renderHtml(SAMPLE_REPORT);
    expect(html).toContain('class="label assumption">Planning assumption</span>');
    expect(html).toContain('<span class="origin">This is how to read the ranking, not a measured win rate.</span>');
    expect(html).not.toMatch(/Estimate/);
    expect(html).toContain('class="label recommendation">Recommendation</span>');
    expect(html).toContain('<sup class="cite">[1]</sup>');
    expect(html).toContain(NOT_AVAILABLE);
    expect(html).toMatch(/<h2>Sources<\/h2><ol><li>Example award data extract/);
    expect(html).toContain('<h2>Contents</h2>');
    expect((html.match(/<svg /g) || []).length).toBe(4);
  });
});

describe('charts', () => {
  it('draws bar, line and pie as standalone SVG with escaped labels', () => {
    for (const kind of ['bar', 'line', 'pie'] as const) {
      const svg = chartToSvg({ type: 'chart', id: 'c', kind, caption: 'A & <B>', series: [{ name: 'S', points: [{ x: 'x<1>', y: 3 }, { x: 'y', y: 5 }] }] });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toContain('<1>');
      expect(svg).toContain('aria-label="A &amp; &lt;B&gt;"');
    }
  });
});

describe('line chart x labels do not overlap', () => {
  it('quarterly labels are spaced by their width (FY26 Q3 / FY26 Q4 never collide)', () => {
    const quarters = ['FY24 Q1', 'FY24 Q2', 'FY24 Q3', 'FY24 Q4', 'FY25 Q1', 'FY25 Q2', 'FY25 Q3', 'FY25 Q4', 'FY26 Q1', 'FY26 Q2', 'FY26 Q3', 'FY26 Q4'];
    const svg = chartToSvg({ type: 'chart', id: 'c', kind: 'line', claim: 'fact', cites: ['s1'], series: [{ name: 's', points: quarters.map((x, i) => ({ x, y: i + 1 })) }] }, 560);
    const labels = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="10" text-anchor="(start|middle|end)" fill="[^"]+">(FY\d\d Q\d)<\/text>/g)]
      .map((m) => { const x = Number(m[1]); const w = m[3].length * 6; const l = m[2] === 'start' ? x : m[2] === 'end' ? x - w : x - w / 2; return { l, r: l + w, t: m[3] }; });
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.some((l) => l.t === 'FY26 Q4')).toBe(true);
    for (let i = 1; i < labels.length; i++) expect(labels[i].l, `${labels[i - 1].t} vs ${labels[i].t}`).toBeGreaterThanOrEqual(labels[i - 1].r);
  });
});

describe('chart axis titles', () => {
  const chart = (kind: 'bar' | 'line') => ({ type: 'chart' as const, id: 'c', kind, claim: 'fact' as const, cites: ['s1'], xLabel: 'Department', yLabel: 'Obligations ($M)', series: [{ name: 'FY26', points: [{ x: 'VA', y: 3 }, { x: 'Army', y: 2 }] }] });
  it('bar and line SVGs render both axis titles', () => {
    for (const k of ['bar', 'line'] as const) {
      const svg = chartToSvg(chart(k));
      expect(svg, k).toContain('>Department</text>');
      expect(svg, k).toContain('>Obligations ($M)</text>');
    }
  });
  it('DOCX chart data table uses the axis titles as column headers', async () => {
    const files = unzipSync(new Uint8Array(await renderDocx(tiny({ sections: [{ id: 'a', heading: 'A', blocks: [chart('bar')] }] }))));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('Department');
    expect(doc).toContain('FY26 (Obligations ($M))');
  });
});

describe('HTML Content-Security-Policy', () => {
  it('the CSP meta is the FIRST element of <head> (it must govern prefetch/preconnect links too)', () => {
    const html = renderHtml(SAMPLE_REPORT);
    const head = html.slice(html.indexOf('<head>') + '<head>'.length);
    expect(head.startsWith(`<meta http-equiv="Content-Security-Policy" content="${"default-src 'none'; style-src 'unsafe-inline'; img-src data:"}">`)).toBe(true);
    expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  it('model text cannot inject a second policy or a prefetch link', () => {
    const m = clone();
    m.title = '<meta http-equiv="Content-Security-Policy" content="default-src *"><link rel="prefetch" href="https://evil.example/">';
    const html = renderHtml(m);
    expect(html.match(/<meta http-equiv/g)).toHaveLength(1);
    expect(html).not.toMatch(/<link rel="prefetch"/);
  });
});

describe('unverified statements', () => {
  const m = () => tiny({ sections: [{ id: 'a', heading: 'Buyers', blocks: [
    { type: 'paragraph', id: 'p1', text: 'VA buys the most.', claim: 'unverified' },
    { type: 'paragraph', id: 'p2', text: 'Cited.', claim: 'fact', cites: ['s1'] },
  ] }] });
  it('HTML: labeled inline and listed in an "Unverified statements" section before Sources', () => {
    const html = renderHtml(m());
    expect(html).toContain('class="label unverified">Unverified — no source</span>');
    expect(html).toMatch(/<h2>Unverified statements<\/h2>[\s\S]*Buyers:<\/span> VA buys the most\.[\s\S]*<h2>Sources<\/h2>/);
  });
  it('HTML: no section when nothing is unverified', () => {
    expect(renderHtml(tiny())).not.toContain('Unverified statements');
  });
  it('DOCX: labeled inline and listed', async () => {
    const files = unzipSync(new Uint8Array(await renderDocx(m())));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('UNVERIFIED — NO SOURCE');
    expect(doc).toContain('Unverified statements');
    expect(doc).toContain('Buyers: ');
  });
});

describe('render-docx', () => {
  it('styles.xml has NO duplicate styleIds (Title/Heading1-3 customize the built-ins)', async () => {
    const files = unzipSync(new Uint8Array(await renderDocx(SAMPLE_REPORT)));
    const xml = strFromU8(files['word/styles.xml']);
    const ids = [...xml.matchAll(/w:styleId="([^"]+)"/g)].map((x) => x[1]);
    expect(ids.length - new Set(ids).size).toBe(0);
    const h1 = xml.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(h1).toContain('1E3A8A');
  });

  it('produces a valid DOCX with styles, header/footer page numbers, repeating table headers and citations', async () => {
    const buf = await renderDocx(SAMPLE_REPORT);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const files = unzipSync(new Uint8Array(buf));
    const doc = strFromU8(files['word/document.xml']);
    const footer = Object.keys(files).filter((k) => /^word\/footer\d*\.xml$/.test(k)).map((k) => strFromU8(files[k])).join('');
    const header = Object.keys(files).filter((k) => /^word\/header\d*\.xml$/.test(k)).map((k) => strFromU8(files[k])).join('');
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
    expect(header).toContain('Prepared with Mindy');
    expect(doc).toContain('w:tblHeader');
    expect(doc).toContain('w:val="Heading1"');
    expect(doc).toContain('PLANNING ASSUMPTION');
    expect(doc).toContain('This is how to read the ranking, not a measured win rate.');
    expect(doc).not.toContain('ESTIMATE');
    expect(doc).toContain('RECOMMENDATION');
    expect(doc).toContain(NOT_AVAILABLE);
    expect(doc).toContain('Chart data.');
  });

  it('round-trips through the shared extractor (same pipeline as uploads)', async () => {
    const buf = await renderDocx(SAMPLE_REPORT);
    const { text } = await extractDocx(buf);
    expect(text).toContain('Federal Janitorial Services Market');
    expect(text).toContain('Sources');
    expect(text).toContain('[1]');
    expect(text).toContain('Department of Veterans Affairs');
  });
});

describe('render-pdf', () => {
  it('asks Chromium for Letter with a header and a "Page X of Y" footer', () => {
    const o = pdfOptions(SAMPLE_REPORT);
    expect(o.format).toBe('Letter');
    expect(o.displayHeaderFooter).toBe(true);
    expect(String(o.footerTemplate)).toContain('class="pageNumber"');
    expect(String(o.footerTemplate)).toContain('class="totalPages"');
    expect(String(pdfOptions(tiny({ title: '<b>' })).headerTemplate)).toContain('&lt;b&gt;');
  });

  it('returns the PDF when the browser renders', async () => {
    pdfState.result = { pdf: Buffer.from('%PDF-1.7 test'), error: null };
    const r = await renderPdf(SAMPLE_REPORT);
    expect(r.pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.error).toBeNull();
    expect(pdfState.calls[0].html).toContain('<h2>Executive summary</h2>');
  });

  it('renders the PDF locked down (JavaScript off, network blocked) — the HTML carries LLM/upload text', async () => {
    pdfState.result = { pdf: Buffer.from('%PDF-1.7 test'), error: null };
    await renderPdf(SAMPLE_REPORT);
    expect(pdfState.calls[0].options).toMatchObject({ lockdown: true });
  });

  it('never silent: no browser → null PDF, the reason, and the printable HTML', async () => {
    pdfState.result = { pdf: null, error: 'Error: Could not find Chrome' };
    const r = await renderPdf(SAMPLE_REPORT);
    expect(r.pdf).toBeNull();
    expect(r.error).toBe('Error: Could not find Chrome');
    expect(r.html).toContain('<!doctype html>');
  });
});

describe('renderDocument', () => {
  it('refuses an invalid model with its issues', async () => {
    const r = await renderDocument({ schema: DOC_SCHEMA }, 'pdf');
    expect(r.ok).toBe(false);
    expect(pdfState.calls).toHaveLength(0);
  });

  it('DOCX: bytes, mime and a safe filename', async () => {
    const r = await renderDocument(SAMPLE_REPORT, 'docx');
    expect(r.ok && r.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(r.ok && r.filename).toBe('Federal-Janitorial-Services-Market-Research-Report-Fixture.docx');
  });

  it('PDF degrade is explicit: format html + degraded reason', async () => {
    pdfState.result = { pdf: null, error: 'boom' };
    const r = await renderDocument(clone(), 'pdf');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.format).toBe('html');
    expect(r.degraded).toEqual({ requested: 'pdf', reason: 'boom' });
    expect(r.mime).toMatch(/^text\/html/);
  });
});

describe('extract (moved from proposal/upload, unchanged)', () => {
  it('infers kind from MIME or extension', () => {
    expect(inferKind('a.PDF', '')).toBe('pdf');
    expect(inferKind('x', 'application/pdf')).toBe('pdf');
    expect(inferKind('a.docx', '')).toBe('docx');
    expect(inferKind('a.xls', '')).toBe('xlsx');
    expect(inferKind('a.xlsx', '')).toBe('xlsx');
    expect(inferKind('a.txt', '')).toBe('txt');
    expect(inferKind('a.csv', 'text/csv')).toBeNull();
    expect(inferKind('a.exe', 'application/octet-stream')).toBeNull();
  });
  it('reads text files as UTF-8', async () => {
    expect((await extractByKind('txt', Buffer.from('héllo'))).text).toBe('héllo');
  });
});

describe('module boundary', () => {
  it('the engine imports no Proposal AI, gov-buyer or MRR business logic', () => {
    const dir = __dirname;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.endsWith('.unit.test.ts')) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // Static `from`, side-effect `import '…'`, dynamic `import('…')` and `require('…')` alike.
      const forbidden = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:@\/lib\/|\.\.\/)(proposal|gov-buyer|mrr)\//;
      expect(src, f).not.toMatch(forbidden);
    }
  });

  it('the boundary pattern catches side-effect, dynamic and require imports (self-test)', () => {
    const forbidden = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:@\/lib\/|\.\.\/)(proposal|gov-buyer|mrr)\//;
    for (const bad of [
      "import x from '@/lib/proposal/v2';",
      "import '@/lib/proposal/side-effect';",
      "const m = await import('@/lib/mrr/assemble');",
      "const g = require('../gov-buyer/x');",
    ]) expect(bad).toMatch(forbidden);
    expect("import { x } from '@/lib/pdf/launch-browser';").not.toMatch(forbidden);
  });

  it('transitively write-free: no engine module (or the PDF launcher) writes to a database, bucket or KV', () => {
    const files: string[] = [join(process.cwd(), 'src/lib/pdf/launch-browser.ts')];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.includes('.test.')) files.push(p);
      }
    };
    walk(__dirname);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/supabase|@vercel\/kv|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.storage\b|writeFile|appendFile/);
    }
  });
});
