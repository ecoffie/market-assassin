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
import { validateDocModel, demoteUncitedFacts, repairDocModelStructure, hardenedAssumptions, DEFAULT_ASSUMPTION_ORIGIN, repeatedSentences, fixtureMarkers } from './validate';
import { keepDash, citationIndex, citeMarker, formatCell, formatColumn, formatChartValue, chartDuplicatesTable, parseInline, NOT_AVAILABLE, fileBaseName } from './format';
import { renderHtml } from './render-html';
import { renderDocx } from './render-docx';
import { renderPdf, pdfOptions } from './render-pdf';
import { renderDocument } from './index';
import { chartToSvg, wrapWords } from './charts';
import { THEMES, THEME_NAMES, DEFAULT_THEME, resolveTheme } from './theme';
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
      // Cited: it is verified — so it must be LABELED a fact, unless it projects forward (A5, 2026-11-17).
      const cited = issuesOf(one(text, { cites: ['s1'] }));
      if (/\b(?:will|expect|planning)/i.test(text)) expect(cited).toEqual([]); // projections and planning premises stay assumptions
      else expect(cited.join(' ')).toMatch(/a cited measurement of the market is a fact, not an assumption \(p\)/);
      const asFact = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text, claim: 'fact', cites: ['s1'] }] }] });
      expect(issuesOf(asFact)).toEqual([]);
    });

    it('a cited OBSERVATION labeled assumption is refused; demotion omits it (never relabels it a fact)', () => {
      const text = 'The market is moderately fragmented: no vendor appears to hold more than about 5% of obligations.';
      expect(issuesOf(one(text, { cites: ['s1'] })).join(' ')).toMatch(/a cited measurement of the market is a fact, not an assumption/);
      const d = demoteUncitedFacts(one(text, { cites: ['s1'] }));
      expect(d.omitted).toEqual(['p']);
      expect(d.model.sections[0].blocks).toEqual([]);
      expect(issuesOf(d.model)).toEqual([]);
    });

    it.each([
      'Obligations may have peaked at $412M in FY2025.',
      'If the data are complete, DHS obligated $3M last year.',
      'The Navy could have awarded 12 contracts in FY2025.',
      'Spending was roughly flat at $24M, and may continue.',
      'No vendor holds more than about 5% of obligations.',
    ])('a hedged or mixed PAST measurement is still an observation → must be a fact: %s', (text) => {
      expect(issuesOf(one(text, { cites: ['s1'] })).join(' ')).toMatch(/a cited measurement of the market is a fact, not an assumption/);
    });

    it.each([
      'We expect $30M in FY2027.',
      'At the current pace, obligations will exceed $500M by FY2028.',
      'Obligations are likely to rise 10% next year.',
      'For planning, assume 5 bidders.',
    ])('a forward projection or explicit planning premise stays a cited assumption: %s', (text) => {
      expect(issuesOf(one(text, { cites: ['s1'] }))).toEqual([]);
    });

    it('a cited PROJECTION stays an assumption (forward-looking, from the evidence)', () => {
      const text = 'At the current pace, roughly $640M a year is likely to be competed again within 24 months as existing contracts expire.';
      expect(issuesOf(one(text, { cites: ['s1'] }))).toEqual([]);
      expect(demoteUncitedFacts(one(text, { cites: ['s1'] })).model.sections[0].blocks[0]).toMatchObject({ claim: 'assumption' });
    });

    it('the fixture labels its cited observations and its reading note as facts, not assumptions', () => {
      const all = SAMPLE_REPORT.sections.flatMap((s) => s.blocks) as Array<{ id: string; claim?: string }>;
      expect(all.find((b) => b.id === 'comp-p2')?.claim).toBe('fact');
      expect(all.find((b) => b.id === 'comp-c1')?.claim).toBe('fact');
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

describe('client-ready numbers (Eric, 2026-11-17)', () => {
  it('dollars read $1.93B · $412.5M · $30M · $850K; never raw', () => {
    expect([1_930_000_000, 1_200_000_000, 412_500_000, 30_000_000, 5_250_000, 850_000, 12_500, 31.4].map((v) => formatCell(v, 'usd')))
      .toEqual(['$1.93B', '$1.2B', '$412.5M', '$30M', '$5.25M', '$850K', '$12.5K', '$31.40']);
    expect(formatCell(0.214, 'pct')).toBe('21.4%');
    expect(formatCell(1234567, 'int')).toBe('1,234,567');
  });

  it('one precision per column: $151.0M beside $412.5M, $24.0M beside $22.9M (A5, v2 review)', () => {
    expect(formatColumn([412_500_000, 151_000_000, 17_500_000, null], 'usd')).toEqual(['$412.5M', '$151.0M', '$17.5M', NOT_AVAILABLE]);
    expect(formatColumn([24_000_000, 22_900_000, 7_500_000], 'usd')).toEqual(['$24.0M', '$22.9M', '$7.5M']);
    expect(formatColumn([1_930_000_000, 412_500_000], 'usd')).toEqual(['$1.93B', '$412.50M']);
    expect(formatColumn([30_000_000, 22_000_000], 'usd')).toEqual(['$30M', '$22M']);
    expect(formatColumn([31.4, 27], 'usd')).toEqual(['$31.40', '$27']);
  });

  it('DOCX and PDF tables use one precision per dollar column', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(SAMPLE_REPORT)))['word/document.xml']);
    const html = renderHtml(SAMPLE_REPORT);
    for (const out of [doc, html]) {
      expect(out).toContain('>$151.0M<');
      expect(out).toContain('>$24.0M<');
      expect(out).not.toMatch(/>\$151M<|>\$24M</);
    }
  });

  it('prose: identifiers are never reformatted — DUNS, phone, ZIP+4, IDIQ, all-digit PIID (A4 MED-1)', () => {
    for (const keep of ['DUNS 080053272', 'DUNS 123456789', 'Call 2157373861', 'ZIP+4 205900001', 'IDIQ 1234567', 'The PIID is 1234567890', 'Reference 9876543 applies.', 'a bare 1234567 with no unit']) {
      expect(parseInline(keep).map((r) => r.text).join('')).toBe(keep);
    }
  });

  it('prose: a raw $412500000, or a bare quantity with a unit or lead-in, is normalized', () => {
    expect(parseInline('Obligations were $412500000 and 30000000 dollars.').map((r) => r.text).join('')).toBe('Obligations were $412.5M and 30,000,000 dollars.');
    expect(parseInline('A total of 2500000 square feet.').map((r) => r.text).join('')).toBe('A total of 2,500,000 square feet.');
    for (const keep of ['NAICS 561720 in FY2026 and 2027.', 'W912PL21C0001 and EX-FIXTURE-1001', 'UEI ABC1234567890', '$1,930,000,000', '$27–$36 per hour']) {
      expect(parseInline(keep).map((r) => r.text).join('')).toBe(keep);
    }
  });

  it('chart values in a data table use the chart format; without one, large numbers still get separators', () => {
    expect(formatChartValue(30_000_000, 'usd')).toBe('$30M');
    expect(formatChartValue(30_000_000)).toBe('30,000,000');
    expect(formatChartValue(41)).toBe('41');
  });
});

describe('per-section boilerplate is a producer signal, never a cut (A4 MED-2)', () => {
  const boiler = 'The figures are drawn from the cited records and are reported as recorded without adjustment.';

  it('uncited repeats across sections are REPORTED for the producer, and nothing is refused or cut', () => {
    const m = tiny({ sections: [
      { id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p1', text: `First point. ${boiler}`, claim: 'recommendation' }] },
      { id: 'b', heading: 'B', blocks: [{ type: 'paragraph', id: 'p2', text: `Second point. ${boiler}`, claim: 'recommendation' }] },
    ] });
    expect(repeatedSentences(m)).toEqual([{ sentence: boiler, where: ['p1', 'p2'] }]);
    expect(issuesOf(m)).toEqual([]);
    expect(demoteUncitedFacts(m).model).toEqual(m);
  });

  it('a cited fact true of two bullets is valid and untouched', () => {
    const fact = 'No procurement forecast has been published by this office in the last 24 months.';
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'bullets', id: 'b', items: [
      { text: `NAVFAC Southeast. ${fact}`, claim: 'fact', cites: ['s1'] },
      { text: `USACE Savannah District. ${fact}`, claim: 'fact', cites: ['s1'] },
    ] }] }] });
    expect(issuesOf(m)).toEqual([]);
    expect(repeatedSentences(m)).toEqual([]);
    expect(demoteUncitedFacts(m).model).toEqual(m);
  });

  it('a cited caveat repeated next to each claim it qualifies is valid and untouched', () => {
    const caveat = 'Figures exclude classified obligations, which the source does not report by office.';
    const m = tiny({ sections: [
      { id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p1', text: `Navy spent $5M. ${caveat}`, claim: 'fact', cites: ['s1'] }] },
      { id: 'b', heading: 'B', blocks: [{ type: 'paragraph', id: 'p2', text: `Army spent $3M. ${caveat}`, claim: 'fact', cites: ['s1'] }] },
    ] });
    expect(issuesOf(m)).toEqual([]);
    expect(demoteUncitedFacts(m).model).toEqual(m);
  });

  it('the fixture report no longer repeats its method paragraph', () => {
    const texts = SAMPLE_REPORT.sections.flatMap((s) => s.blocks).map((b) => (b as { text?: string }).text ?? '');
    expect(texts.filter((x) => /drawn from the cited records/.test(x))).toEqual([]);
  });
});

describe('repairDocModelStructure (comprehensive-report shape)', () => {
  it('uniquifies duplicate section and block ids so validation passes', () => {
    const m = tiny({
      sections: [
        { id: 'sec', heading: 'One', blocks: [{ type: 'paragraph', id: 'p', text: 'A', claim: 'fact', cites: ['s1'] }] },
        { id: 'sec', heading: 'Two', blocks: [{ type: 'paragraph', id: 'p', text: 'B', claim: 'fact', cites: ['s1'] }] },
      ],
    });
    expect(issuesOf(m).some((x) => /duplicate id/.test(x))).toBe(true);
    const { model, changes } = repairDocModelStructure(m);
    expect(changes.length).toBeGreaterThan(0);
    expect(validateDocModel(model).ok).toBe(true);
    expect(model.sections.map((s) => s.id)).toEqual(['sec', 'sec-2']);
    expect(model.sections.flatMap((s) => s.blocks.map((b) => b.id))).toEqual(['p', 'p-2']);
  });

  it('infers table columns from row keys when columns are missing', () => {
    const m = tiny({
      sections: [{
        id: 't',
        heading: 'Awards',
        blocks: [{
          type: 'table',
          id: 'tbl',
          claim: 'fact',
          cites: ['s1'],
          columns: [],
          rows: [
            { award: 'N62478', dollars: 1_190_000_000, office: 'NAVFAC Hawaii' },
            { award: 'W9128A', dollars: 824_530_000, office: 'USACE Honolulu' },
          ],
        }],
      }],
    });
    expect(issuesOf(m).some((x) => /at least one column/.test(x))).toBe(true);
    const { model, changes } = repairDocModelStructure(m);
    expect(changes.some((c) => /inferred/.test(c))).toBe(true);
    expect(validateDocModel(model).ok).toBe(true);
    const tbl = model.sections[0].blocks[0] as { columns: Array<{ key: string }> };
    expect(tbl.columns.map((c) => c.key).sort()).toEqual(['award', 'dollars', 'office']);
  });
});

describe('fixture safeguard', () => {
  it('the fixture identifies itself, and only tests and the local render script import it', () => {
    expect(fixtureMarkers(SAMPLE_REPORT).length).toBeGreaterThan(0);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!/\.(ts|tsx|js|mjs)$/.test(name) || /\.test\.|__fixtures__/.test(p)) continue;
        if (/__fixtures__\/sample-report|sample-report['"]/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });

  it('example.com sources and "(fixture)" labels are fixture markers; a real source is not', () => {
    expect(fixtureMarkers({ sources: [{ url: 'https://www.example.com/x', label: 'x' }] })).toHaveLength(1);
    expect(fixtureMarkers({ sources: [{ url: 'https://www.usaspending.gov/x', label: 'USAspending award data' }] })).toEqual([]);
    expect(fixtureMarkers({ sources: [{ url: 'https://notexample.com/x', label: 'x' }] })).toEqual([]);
  });
});

describe('theme layer (Eric, 2026-11-17: styling must be flexible)', () => {
  const briefing = (): DocModel => ({ ...clone(), theme: 'briefing' });

  it('presets: mindy (default) and briefing; unknown or missing falls back to mindy and never blocks a render', async () => {
    expect(THEME_NAMES).toEqual(['mindy', 'briefing']);
    expect(DEFAULT_THEME).toBe('mindy');
    expect(resolveTheme(undefined).name).toBe('mindy');
    expect(resolveTheme('briefing').name).toBe('briefing');
    expect(resolveTheme('neon').name).toBe('mindy');
    expect(resolveTheme(42).name).toBe('mindy');
    expect(resolveTheme('__proto__').name).toBe('mindy');
    const odd = { ...clone(), theme: 'neon' };
    expect(issuesOf(odd)).toEqual([]);
    expect((await renderDocument(odd, 'docx')).ok).toBe(true);
    expect(renderHtml(odd)).toBe(renderHtml(clone()));
  });

  it('no hard-coded colors in the render paths: every color comes from theme.ts', () => {
    for (const f of ['render-html.ts', 'render-docx.ts', 'charts.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib/documents', f), 'utf8');
      expect(src.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|'[0-9A-Fa-f]{6}'/g) ?? [], f).toEqual([]);
    }
  });

  it('both renderers read the tokens: changing a preset restyles HTML, SVG and DOCX', async () => {
    const m = clone();
    const html = renderHtml(m);
    expect(html).toContain('#1e3a8a');
    const docxBefore = strFromU8(unzipSync(new Uint8Array(await renderDocx(m)))['word/document.xml']);
    const saved = THEMES.mindy.colors.tableHeaderBg;
    try {
      (THEMES.mindy.colors as { tableHeaderBg: string }).tableHeaderBg = 'ABCDEF';
      expect(renderHtml(m)).toContain('th { text-align: left; background: #abcdef;');
      const docx = strFromU8(unzipSync(new Uint8Array(await renderDocx(m)))['word/document.xml']);
      expect(docx).toContain('w:fill="ABCDEF"');
      expect(docxBefore).not.toContain('w:fill="ABCDEF"');
    } finally {
      (THEMES.mindy.colors as { tableHeaderBg: string }).tableHeaderBg = saved;
    }
  });

  it('labels keep their exact wording and the assumption chip stays amber in EVERY theme', async () => {
    for (const m of [clone(), briefing()]) {
      const html = renderHtml(m);
      expect(html).toContain('class="label assumption">Planning assumption</span>');
      expect(html).toContain('class="label recommendation">Recommendation</span>');
      expect(html).toMatch(/\.label\.assumption \{ background: #fef3c7; color: #92400e; \}/);
      const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(m)))['word/document.xml']);
      expect(doc).toContain('PLANNING ASSUMPTION');
      expect(doc).toContain('RECOMMENDATION');
      expect(doc).toMatch(/w:fill="FEF3C7"/);
    }
  });

  it("mindy (PDF): brand band (gradient, M mark, tagline, brand contact lines), metadata card, numbered headings, rounded headers, soft page", () => {
    const html = renderHtml(clone());
    expect(html).toMatch(/\.brandband \{[^}]*background: linear-gradient\(90deg, #1e3a8a, #7c3aed\);/);
    expect(html).toContain('<span class="mark">M</span>');
    expect(html).toContain('FEDERAL MARKET INTELLIGENCE');
    expect(html).toContain('support@getmindy.ai');
    expect(html).toMatch(/<dl class="card"><dt>Prepared for<\/dt><dd>Example Company \(fixture\)<\/dd><dt>Prepared by<\/dt><dd>Mindy<\/dd><dt>What this is<\/dt>/);
    expect(html).not.toContain('<dt>Attention</dt>'); // only from the model's own metadata
    expect(renderHtml({ ...clone(), meta: { attention: 'Contracting officer' } })).toContain('<dt>Attention</dt><dd>Contracting officer</dd>');
    expect(html).toContain('<h2><span class="num">2.</span>Market size and trend</h2>');
    expect(html).toMatch(/th:first-child \{ border-top-left-radius: 6px; \}/);
    expect(html).toMatch(/td:first-child \{ font-weight: 600; color: #1e3a8a; \}/);
    // White page in PDF: a tinted page prints as a framed panel inside Chromium's unpainted margins.
    expect(html).toMatch(/body \{[^}]*background: #ffffff;/);
    expect(html).not.toContain('#f7f7fb');
  });

  it('briefing (PDF): navy title + gold rule, full-width navy bands in white uppercase, uppercase headers, blue-gray rows, no numbering', () => {
    const html = renderHtml(briefing());
    expect(html).toMatch(/\.cover\.rule \.titleblock \{ border-bottom: 2px solid #b8892a;/);
    expect(html).toMatch(/\.cover h1 \{[^}]*color: #0b2545; \}/);
    expect(html).toMatch(/h2 \{ background: #0b2545; color: #ffffff; text-transform: uppercase;/);
    expect(html).toContain('<h2>Market size and trend</h2>');
    expect(html).toMatch(/th \{[^}]*text-transform: uppercase;/);
    expect(html).toMatch(/tbody tr:nth-child\(even\) td \{ background: #eef2f7; \}/);
    expect(html).toMatch(/\.callout\.warning \{ border-color: #b91c1c; background: #fbe9e9; color: #7f1d1d; font-weight: 700; \}/);
    expect(html).toMatch(/\.label\.recommendation \{ background: #fbf3e0; color: #8c6418;/);
    expect(html).not.toContain('class="brandband"');
  });

  it('DOCX per preset: mindy = brand band + numbered rule headings + bold first column; briefing = navy band headings in caps + gold rule + caps headers', async () => {
    const parts = async (m: DocModel) => { const f = unzipSync(new Uint8Array(await renderDocx(m))); return { doc: strFromU8(f['word/document.xml']), styles: strFromU8(f['word/styles.xml']) }; };
    const h1 = (styles: string) => styles.slice(styles.indexOf('w:styleId="Heading1"'), styles.indexOf('</w:style>', styles.indexOf('w:styleId="Heading1"')));
    const mi = await parts(clone());
    expect(mi.doc).toContain('FEDERAL MARKET INTELLIGENCE');
    expect(mi.doc).toContain('>1. Executive summary<');
    expect(h1(mi.styles)).not.toMatch(/w:fill=/);
    expect(h1(mi.styles)).toMatch(/w:bottom/);
    const vendorCell = mi.doc.slice(mi.doc.lastIndexOf('<w:r>', mi.doc.indexOf('>Example Facility Services A LLC<')), mi.doc.indexOf('>Example Facility Services A LLC<'));
    expect(vendorCell).toMatch(/<w:b\/>/);
    const br = await parts(briefing());
    expect(br.doc).not.toContain('FEDERAL MARKET INTELLIGENCE');
    expect(br.doc).toContain('>Executive summary<');
    expect(h1(br.styles)).toMatch(/w:fill="0B2545"/);
    expect(h1(br.styles)).toMatch(/<w:caps\/>|<w:caps w:val="true"\/>/);
    expect(br.doc).toMatch(/w:color="B8892A"/);
    expect(br.doc).toMatch(/w:fill="EEF2F7"/);
    expect(br.doc).toContain('w:rFonts w:ascii="Arial"');
  });

  it('DOCX callouts (briefing): caution = red fill + bold dark-red text; key message = blue-gray, larger', async () => {
    const m = tiny({ theme: 'briefing', sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'callout', id: 'w', tone: 'warning', text: 'Proposals are due Friday.', claim: 'fact', cites: ['s1'] },
      { type: 'callout', id: 'k', tone: 'key_finding', text: 'The market is concentrated.', claim: 'fact', cites: ['s1'] },
    ] }] });
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(m)))['word/document.xml']);
    expect(doc).toMatch(/w:fill="FBE9E9"/);
    const warnRun = doc.slice(doc.lastIndexOf('<w:r>', doc.indexOf('Proposals are due Friday.')), doc.indexOf('Proposals are due Friday.'));
    expect(warnRun).toMatch(/<w:b\/>/);
    expect(warnRun).toMatch(/w:val="7F1D1D"/);
    const keyRun = doc.slice(doc.lastIndexOf('<w:r>', doc.indexOf('The market is concentrated.')), doc.indexOf('The market is concentrated.'));
    expect(keyRun).toMatch(/w:sz w:val="23"/);
  });
});

describe('titles keep a dash with the word before it (A5, v5)', () => {
  it('keepDash turns the space before an em/en dash into a non-breaking space, nothing else', () => {
    expect(keepDash('Federal Janitorial Services Market — Research Report')).toBe('Federal Janitorial Services Market — Research Report');
    expect(keepDash('FY2024 – FY2026 trend')).toBe('FY2024 – FY2026 trend');
    expect(keepDash('Pre-award work-up')).toBe('Pre-award work-up');
  });

  it('PDF/HTML and DOCX titles and headings carry the non-breaking space', async () => {
    const m = { ...clone(), sections: [...clone().sections, { id: 'extra', heading: 'Next steps — 90 days', blocks: [{ type: 'paragraph' as const, id: 'x1', text: 'Act.', claim: 'recommendation' as const }] }] };
    const html = renderHtml(m);
    expect(html).toContain('<h1>Federal Janitorial Services Market — Research Report (Fixture)</h1>');
    expect(html).toContain('Next steps — 90 days</h2>');
    expect(html).not.toMatch(/Market — Research/);
    expect(String(pdfOptions(m).headerTemplate)).toContain('Market — Research');
    const files = unzipSync(new Uint8Array(await renderDocx(m)));
    const doc = strFromU8(files['word/document.xml']);
    const header = Object.keys(files).filter((k) => /^word\/header\d*\.xml$/.test(k)).map((k) => strFromU8(files[k])).join('');
    expect(doc).toContain('Market — Research Report (Fixture)');
    expect(doc).toContain('Next steps — 90 days');
    expect(doc).not.toContain('Market — Research');
    expect(header).toContain('Market — Research');
  });
});

describe('cover "Attention" line is bounded (A4 LOW)', () => {
  const withAttention = (attention: unknown) => ({ ...tiny(), meta: { attention } as never });
  it('accepts a short single line (trimmed length up to 120)', () => {
    expect(issuesOf(withAttention('Contracting officer, Region 4'))).toEqual([]);
    expect(issuesOf(withAttention(`  ${'a'.repeat(120)}  `))).toEqual([]);
  });
  it('rejects longer than 120 characters, multi-line or control characters, and non-strings', () => {
    expect(issuesOf(withAttention('a'.repeat(121))).join(' ')).toMatch(/meta\.attention|longer than 120 chars/);
    expect(issuesOf(withAttention('Line one\nLine two')).join(' ')).toMatch(/single line of plain text/);
    expect(issuesOf(withAttention(42)).join(' ')).toMatch(/must be a string/);
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
    expect(html).toContain('<span class="origin">This is Mindy&#39;s reading of the monthly pattern above, not a forecast from the agencies.</span>');
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
    const labels = [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="10" text-anchor="(start|middle|end)" fill="[^"]+"><tspan[^>]*>(FY\d\d Q\d)<\/tspan><\/text>/g)]
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
    expect(doc).toContain('reading of the monthly pattern above, not a forecast from the agencies.');
    expect(doc).not.toContain('ESTIMATE');
    expect(doc).toContain('RECOMMENDATION');
    expect(doc).toContain(NOT_AVAILABLE);
    // Eric's review (2026-11-17): no duplicate chart-data table, nothing raw, captions above tables.
    expect(doc).not.toContain('Chart data.');
    expect(doc).not.toMatch(/>(?:412500000|30000000|301200000|22000000)</);
    expect(doc).toContain('>$412.5M<');
    expect(doc).toContain('>$30M<');
  });

  it('DOCX: a chart whose values an adjacent table already shows is omitted; any other chart is ONE formatted table', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(SAMPLE_REPORT)))['word/document.xml']);
    // "Who buys": the department table shows every plotted value → the bar chart adds nothing in Word.
    expect(doc).not.toContain('Top departments by obligations, illustrative');
    expect(doc.match(/Obligations by department, FY2024–FY2026/g)).toHaveLength(1);
    // "Upcoming recompetes": the per-agency chart is NOT in the contract table → kept, formatted.
    expect(doc).toContain('Expiring value by agency, illustrative');
    expect(doc.indexOf('Expiring value by agency')).toBeLessThan(doc.indexOf('>Next 6 months<')); // caption ABOVE its table
    expect(doc).toContain('>Agency<');
    expect(doc).toContain('>$22M<');
  });

  it('chartDuplicatesTable: only when EVERY plotted value is in the table', () => {
    const t = { type: 'table', id: 't', columns: [{ key: 'a', label: 'A' }, { key: 'v', label: 'V', format: 'usd' }], rows: [{ a: 'X', v: 5 }, { a: 'Y', v: 7 }] } as never;
    const chart = (pts: Array<[string, number]>) => ({ type: 'chart', id: 'c', kind: 'bar', series: [{ name: 's', points: pts.map(([x, y]) => ({ x, y })) }] }) as never;
    expect(chartDuplicatesTable(chart([['X', 5], ['Y', 7]]), t)).toBe(true);
    expect(chartDuplicatesTable(chart([['X', 5], ['Y', 8]]), t)).toBe(false);
    expect(chartDuplicatesTable(chart([['X', 5], ['Z', 7]]), t)).toBe(false);
  });

  it('chart labels are never truncated: long names wrap onto more lines (A5, v3 review)', () => {
    const svgText = (svg: string) => svg.replace(/<tspan[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const long = 'Department of Health and Human Services, Office of the Assistant Secretary';
    const bar = chartToSvg({ type: 'chart', id: 'c', kind: 'bar', xLabel: 'A very long category axis title for departments', series: [{ name: 'A very long series name that used to be cut', points: [{ x: long, y: 5 }, { x: 'General Services Administration', y: 3 }] }, { name: 'Second', points: [{ x: long, y: 1 }, { x: 'General Services Administration', y: 2 }] }] });
    const line = chartToSvg({ type: 'chart', id: 'l', kind: 'line', series: [{ name: 'Department of Veterans Affairs obligations', points: [{ x: 'FY2026 first quarter (Oct–Dec)', y: 1 }, { x: 'FY2026 second quarter', y: 2 }] }, { name: 'Second', points: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }] }] });
    const pie = chartToSvg({ type: 'chart', id: 'p', kind: 'pie', series: [{ name: 's', points: [{ x: long, y: 2 }, { x: 'Small business', y: 1 }] }] });
    for (const svg of [bar, line, pie]) expect(svg).not.toContain('…');
    expect(svgText(bar)).toContain(long);
    expect(svgText(bar)).toContain('General Services Administration');
    expect(svgText(bar)).toContain('A very long series name that used to be cut');
    expect(svgText(bar)).toContain('A very long category axis title for departments');
    expect(svgText(line)).toContain('FY2026 first quarter (Oct–Dec)');
    expect(svgText(line)).toContain('Department of Veterans Affairs obligations');
    expect(svgText(pie)).toContain(long);
    expect(svgText(renderHtml(SAMPLE_REPORT))).not.toContain('…');
  });

  it('wrapWords breaks at word boundaries and never drops text', () => {
    expect(wrapWords('General Services Administration', 26)).toEqual(['General Services', 'Administration']);
    expect(wrapWords('VA', 26)).toEqual(['VA']);
    expect(wrapWords('Supercalifragilisticexpialidocious word', 10)).toEqual(['Supercalifragilisticexpialidocious', 'word']);
  });

  it('DOCX columns get room for their content: a long vendor name is wider than a dollar column', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(SAMPLE_REPORT)))['word/document.xml']);
    const i = doc.indexOf('>Vendor<');
    const grid = doc.slice(doc.lastIndexOf('<w:tblGrid>', i), doc.indexOf('</w:tblGrid>', doc.lastIndexOf('<w:tblGrid>', i)));
    const widths = [...grid.matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(5); // Vendor, Awards, Obligations, Typical set-aside, HQ state
    expect(widths[0]).toBeGreaterThan(widths[2] * 2.5);
    // ~31 characters at 9pt fits on one line (~0.065in/char → ~2.9in ≈ 4200 dxa).
    expect(widths[0]).toBeGreaterThanOrEqual(4000);
  });

  it('PDF/HTML: chart values are formatted ($), captions sit above tables and charts', () => {
    const html = renderHtml(SAMPLE_REPORT);
    expect(html).toMatch(/>\$412\.5M</);
    expect(html).not.toMatch(/>(?:412500000|30000000|30\.0M)</);
    expect(html).toMatch(/<div class="tablewrap"><div class="caption">.*Obligations by department/);
    expect(html).toMatch(/<figure><figcaption class="caption">/);
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
    expect(pdfState.calls[0].html).toContain('<h2><span class="num">1.</span>Executive summary</h2>'); // default theme numbers sections
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
