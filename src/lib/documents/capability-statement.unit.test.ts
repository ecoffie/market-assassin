import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { CAPABILITY_STATEMENT, CAPABILITY_STATEMENT_AS_WRITTEN } from './__fixtures__/capability-statement';
import { SAMPLE_REPORT } from './__fixtures__/sample-report';
import { capRole, companyName, extractCapability, isCapabilityStatement, PAST_PERFORMANCE_PLACEHOLDER } from './capability-statement';
import { renderHtml } from './render-html';
import { renderDocx } from './render-docx';
import type { DocModel } from './model';

const clone = (): DocModel => JSON.parse(JSON.stringify(CAPABILITY_STATEMENT));
const visible = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/\s+/g, ' ');

describe('capability statement: selection', () => {
  it('kind selects the layout; a title saying "capability statement" is the fallback; reports are unchanged', () => {
    expect(isCapabilityStatement(CAPABILITY_STATEMENT)).toBe(true);
    expect(isCapabilityStatement({ title: 'Acme Corp: Capability Statement' })).toBe(true);
    expect(isCapabilityStatement({ title: 'Federal Janitorial Services Market' })).toBe(false);
    expect(renderHtml(SAMPLE_REPORT)).not.toContain('class="cs"');
    expect(renderHtml(CAPABILITY_STATEMENT)).toContain('<main class="cs">');
  });
  it('section roles come from headings; the company name comes from the title', () => {
    expect(capRole('Core Competencies')).toBe('competencies');
    expect(capRole('Past Performance')).toBe('past_performance');
    expect(capRole('Differentiators')).toBe('differentiators');
    expect(capRole('Company Data')).toBe('company_data');
    expect(capRole('Point of Contact')).toBe('contact');
    expect(companyName('Ridgeline Facility Services LLC Capability Statement')).toBe('Ridgeline Facility Services LLC');
    expect(companyName('Capability Statement: Acme Corp')).toBe('Acme Corp');
  });
});

describe('capability statement: the face of the page (HTML/PDF)', () => {
  const html = renderHtml(CAPABILITY_STATEMENT);
  const text = visible(html);

  it('is not a report: no cover, contents, "How to read this", citation markers, Sources list or claim labels', () => {
    expect(html).not.toMatch(/class="cover|class="toc|class="reading|class="sources|class="cite|class="label /);
    expect(text).not.toMatch(/How to read|Contents|Sources|Recommendation|Unverified/);
  });

  it('header band, then Core Competencies, Past Performance, Differentiators; Company Data then Point of Contact on the right', () => {
    expect(html).toContain('<h1>Ridgeline Facility Services LLC</h1>');
    expect(html).toContain('Custodial, grounds and light HVAC maintenance');
    const at = ['Core Competencies', 'Past Performance', 'Differentiators', 'Company Data', 'Point of Contact'].map((h) => html.indexOf(`<h2>${h}</h2>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html.indexOf('class="cs-box"')).toBeLessThan(html.indexOf('<h2>Company Data</h2>'));
  });

  it('Company Data shows only sourced fields (an unsourced HUBZone line is left off), NAICS keeps the primary first', () => {
    expect(text).toContain('RDGLN0000TEST');
    expect(text).toContain('561720 (primary), 561730, 238220');
    expect(text).not.toContain('HUBZone');
    const cap = extractCapability(CAPABILITY_STATEMENT);
    expect(cap.companyData.map((f) => f.label)).toEqual(['UEI', 'CAGE', 'NAICS', 'PSC', 'Socioeconomic']);
    expect(cap.trimmed).toContain('unsourced company data, left off: HUBZone');
  });

  it('an unverified item is left off the page and logged', () => {
    expect(text).not.toContain('Trusted by every agency');
    expect(extractCapability(CAPABILITY_STATEMENT).trimmed.some((t) => t.startsWith('unverified, left off: Trusted by every agency'))).toBe(true);
  });

  it('past performance entries keep agency, work and value; a one-line provenance footer names where company data comes from', () => {
    expect(text).toContain('USDA Forest Service, Francis Marion District · Janitorial services for district office and visitor center · $412,000');
    expect(html).toContain('<footer class="cs-foot">Company data from the SAM.gov registration and the company’s own materials.</footer>');
  });

  it('no em dashes and no dates on the face', () => {
    const m = clone();
    m.subtitle = 'Facilities support — on site in 48 hours';
    const t = visible(renderHtml(m));
    expect(t).not.toContain('—');
    expect(t).not.toMatch(/\b20\d\d-\d\d-\d\d\b|November 27, 2026|Page \d+ of/);
  });

  it('trims to the item limits rather than spilling: the tightest step keeps the top items and logs the rest', () => {
    const m = clone();
    const comp = m.sections[0].blocks[0] as { items: Array<{ text: string; claim: 'fact'; cites: string[] }> };
    for (let i = 0; i < 12; i++) comp.items.push({ text: `Extra competency ${i + 1}`, claim: 'fact', cites: ['s-upload'] });
    const cap = extractCapability(m, { competencies: 5, pastPerformance: 2, differentiators: 3, other: 0, itemChars: 140 });
    expect(cap.competencies).toHaveLength(5);
    expect(cap.pastPerformance).toHaveLength(2);
    expect(cap.competencies[0].text).toMatch(/^Daily and periodic custodial/);
    expect(cap.trimmed.some((t) => /core competencies: kept 5 of/.test(t))).toBe(true);
  });
});

describe('capability statement: Word', () => {
  it('same structure, editable: header band, two-column table, Company Data box, no Sources list, no dates', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(CAPABILITY_STATEMENT)))['word/document.xml']);
    for (const s of ['CAPABILITY STATEMENT', 'Ridgeline Facility Services LLC', 'CORE COMPETENCIES', 'PAST PERFORMANCE', 'DIFFERENTIATORS', 'COMPANY DATA', 'POINT OF CONTACT', 'RDGLN0000TEST']) expect(doc).toContain(s);
    const order = ['CORE COMPETENCIES', 'PAST PERFORMANCE', 'DIFFERENTIATORS', 'COMPANY DATA', 'POINT OF CONTACT'].map((h) => doc.indexOf(h));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(doc).not.toMatch(/>Sources<|How to read|HUBZone|Trusted by every agency|November 27, 2026/);
    expect(doc).toContain('w:w="12240"');
  });
});

describe('capability statement as the model actually writes it (Eric’s screenshots, 2026-11-27)', () => {
  const html = renderHtml(CAPABILITY_STATEMENT_AS_WRITTEN);
  const text = visible(html);

  it('the title alone selects the layout, even on the briefing theme: no REPORT kicker, cover meta, gold rule, How to read or section bars', () => {
    expect(html).toContain('<main class="cs">');
    expect(html).toContain('<div class="kick">Capability Statement</div>');
    expect(text).not.toMatch(/\bReport\b|Prepared for|Prepared with|cited sources|How to read/);
    expect(html).not.toMatch(/class="cover|class="titleblock|class="reading/);
  });

  it('overview leads; Core Capabilities, Past Performance, Differentiators, then Leadership; Company Data and Contact on the right', () => {
    expect(html).toContain('<p class="cs-lead">Harborline Build is a small general contractor');
    const at = ['Core Competencies', 'Past Performance', 'Differentiators', 'Leadership and Team', 'Company Data', 'Point of Contact'].map((h) => html.indexOf(`<h2>${h}</h2>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the coaching NOTE is not printed; Past Performance keeps the honest framing plus a [bracketed] placeholder', () => {
    expect(text).not.toContain('Add your first completed project here');
    expect(text).toContain('a Coastline Holdings LLC contract, not a Harborline Build contract');
    expect(text).toContain(PAST_PERFORMANCE_PLACEHOLDER);
  });

  it('Company Data becomes a label:value box (no FIELD/VALUE header row); the registration expiry date stays; contact lines one per line', () => {
    expect(text).not.toMatch(/\bField\b.*\bValue\b/);
    expect(html).toContain('<dt>Registration expires</dt><dd>2027-05-14</dd>');
    for (const l of ['Kai Example, Owner', '(555) 010-0142', 'kai@example.com']) expect(html).toContain(`<dd class="line">${l}</dd>`);
  });

  it('no Sources section, no citation markers, no internal upload id anywhere on the page', () => {
    expect(html).not.toMatch(/<h2>Sources<\/h2>|class="cite"/);
    expect(html).not.toContain('67e4223f');
  });

  it('Word follows the same rules', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(CAPABILITY_STATEMENT_AS_WRITTEN)))['word/document.xml']);
    expect(doc).toContain('CAPABILITY STATEMENT');
    expect(doc).not.toMatch(/Add your first completed project|67e4223f|How to read|>Sources</);
    expect(doc).toContain(PAST_PERFORMANCE_PLACEHOLDER.replace(/&/g, '&amp;'));
    expect(doc).toContain('Registration expires'.toUpperCase());
  });
});

describe('capability statement palette (Eric, 2026-11-27: "I like the other color, not the Mindy colors")', () => {
  it('the default (mindy) theme prints in the navy and gold briefing palette: solid navy band, no purple gradient', () => {
    expect(CAPABILITY_STATEMENT.theme ?? 'mindy').toBe('mindy');
    const html = renderHtml(CAPABILITY_STATEMENT);
    expect(html).toContain('linear-gradient(90deg, #0b2545, #0b2545)');
    expect(html).not.toMatch(/#7c3aed|#1e3a8a/i);
    expect(html).toContain('#b8892a'); // gold accent on the section rules
  });
  it('Word uses the same navy for the header band and the data box rule', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(CAPABILITY_STATEMENT)))['word/document.xml']);
    expect(doc).toContain('w:fill="0B2545"');
    expect(doc).not.toMatch(/7C3AED|1E3A8A/i);
  });
  it('a report keeps the Mindy theme (only the capability statement layout changes palette)', () => {
    expect(renderHtml(SAMPLE_REPORT)).toMatch(/#1e3a8a/i);
  });
});
