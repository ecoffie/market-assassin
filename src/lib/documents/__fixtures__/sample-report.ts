/**
 * A fixture DocModel sized like a typical ~8-page Ask Mindy research report.
 *
 * ILLUSTRATIVE DATA ONLY. Every company, figure and source below is invented for rendering tests;
 * nothing here is a real customer, contract or federal record, and the document says so on its
 * cover. Used by the unit tests and by scripts/documents/render-fixture.ts.
 */
import { DOC_SCHEMA, type DocModel, type TableBlock } from '../model';

const agencies: TableBlock['rows'] = [
  ['Department of Veterans Affairs', 412_500_000, 0.214, 38],
  ['Department of the Army', 301_200_000, 0.156, 44],
  ['Department of the Navy', 255_900_000, 0.133, 29],
  ['General Services Administration', 198_400_000, 0.103, 52],
  ['Department of the Air Force', 151_000_000, 0.078, 21],
  ['Department of Homeland Security', 122_700_000, 0.064, 17],
  ['Department of Health and Human Services', 96_300_000, 0.05, 23],
  ['Department of the Interior', 71_800_000, 0.037, 31],
  ['Department of Justice', 63_100_000, 0.033, 12],
  ['Department of Agriculture', 55_400_000, 0.029, 26],
  ['Department of Energy', 48_900_000, 0.025, 9],
  ['Department of Transportation', 37_600_000, 0.02, 11],
  ['Department of State', 33_200_000, 0.017, 7],
  ['Smithsonian Institution', 19_800_000, 0.01, 4],
  ['Department of Labor', 17_500_000, null, 6],
].map(([agency, obligations, share, offices]) => ({ agency, obligations, share, offices })) as TableBlock['rows'];

const vendors: TableBlock['rows'] = Array.from({ length: 18 }, (_, i) => ({
  vendor: `Example Facility Services ${String.fromCharCode(65 + i)} LLC`,
  awards: 40 - i * 2,
  obligations: Math.round((92 - i * 4.3) * 1_000_000),
  setAside: ['8(a)', 'SDVOSB', 'HUBZone', 'WOSB', 'Small Business', 'Full and open'][i % 6],
  state: ['VA', 'TX', 'CA', 'FL', 'GA', 'MD', 'NC', 'WA', 'CO'][i % 9],
}));

const expiring: TableBlock['rows'] = Array.from({ length: 16 }, (_, i) => ({
  piid: `EX-FIXTURE-${String(1001 + i)}`,
  agency: ['VA', 'Army', 'Navy', 'GSA', 'Air Force', 'DHS', 'HHS', 'DOI'][i % 8],
  incumbent: `Example Facility Services ${String.fromCharCode(65 + (i % 18))} LLC`,
  value: Math.round((24 - i * 1.1) * 1_000_000),
  ends: `2027-${String((i % 12) + 1).padStart(2, '0')}-28`,
}));

const longText = (topic: string) =>
  `This section summarizes ${topic} from the research gathered in the conversation. ` +
  'The figures are drawn from the cited records and are reported as recorded; where a value was not available in the source it is shown as "Not available" rather than as zero. ' +
  'Readers should treat the numbered citations as the authority for every stated fact, and should read statements labeled as assumptions or recommendations as Mindy\'s analysis, not as recorded data.';

export const SAMPLE_REPORT: DocModel = {
  schema: DOC_SCHEMA,
  title: 'Federal Janitorial Services Market — Research Report (Fixture)',
  subtitle: 'Illustrative fixture data for rendering tests. Not real federal records.',
  preparedFor: 'Example Company (fixture)',
  date: '2026-11-17',
  meta: { generatedBy: 'fixture', version: 1 },
  sources: [
    { id: 's1', kind: 'usaspending', label: 'Example award data extract, NAICS 561720, FY2024–FY2026 (fixture)', url: 'https://example.com/fixture/awards', retrievedAt: '2026-11-17' },
    { id: 's2', kind: 'sam_notice', label: 'Example open solicitations, NAICS 561720 (fixture)', url: 'https://example.com/fixture/notices', retrievedAt: '2026-11-17' },
    { id: 's3', kind: 'tool', label: 'Example expiring-contracts query (fixture)', recordId: 'EX-QUERY-1' },
    { id: 's4', kind: 'upload', label: 'Uploaded file: example-pricing-notes.xlsx (fixture)' },
    { id: 's5', kind: 'web', label: 'Example labor-rate reference (fixture)', url: 'https://example.com/fixture/rates' },
  ],
  sections: [
    {
      id: 'exec',
      heading: 'Executive summary',
      blocks: [
        { type: 'paragraph', id: 'exec-p1', claim: 'fact', cites: ['s1'], text: 'Federal agencies obligated an illustrative **$1.93B** for janitorial services across the three fiscal years in scope, spread over 15 departments and 330 buying offices.' },
        { type: 'paragraph', id: 'exec-p2', claim: 'fact', cites: ['s1', 's2'], text: 'Spending is concentrated: the top three departments account for about half of all obligations, and 46 solicitations are open now.' },
        { type: 'callout', id: 'exec-c1', tone: 'key_finding', claim: 'assumption', cites: ['s1', 's3'], text: 'At the current pace, roughly **$640M** a year is likely to be competed again within 24 months as existing contracts expire.' },
        {
          type: 'bullets', id: 'exec-b1', items: [
            { text: 'Veterans Affairs is the largest buyer and runs the most small-business set-asides.', claim: 'fact', cites: ['s1'] },
            { text: 'Sixteen contracts worth more than $5M each end within the next year.', claim: 'fact', cites: ['s3'] },
            { text: 'Prioritize VA and Army offices in the Mid-Atlantic, where your past performance is strongest.', claim: 'recommendation' },
          ],
        },
      ],
    },
    {
      id: 'market',
      heading: 'Market size and trend',
      blocks: [
        { type: 'paragraph', id: 'market-p1', claim: 'fact', cites: ['s1'], text: longText('the size and direction of the market') },
        {
          type: 'chart', id: 'market-c1', kind: 'line', caption: 'Quarterly obligations, illustrative ($)', claim: 'fact', cites: ['s1'], yLabel: 'Obligations',
          series: [{ name: 'Obligations', points: ['FY24 Q1', 'FY24 Q2', 'FY24 Q3', 'FY24 Q4', 'FY25 Q1', 'FY25 Q2', 'FY25 Q3', 'FY25 Q4', 'FY26 Q1', 'FY26 Q2', 'FY26 Q3', 'FY26 Q4'].map((x, i) => ({ x, y: Math.round((140 + i * 6 + (i % 4 === 3 ? 40 : 0)) * 1_000_000) })) }],
        },
        { type: 'paragraph', id: 'market-p2', claim: 'assumption', text: 'Fourth-quarter spikes suggest year-end buying; expect the largest award volume in July through September.' },
        {
          type: 'chart', id: 'market-c2', kind: 'pie', caption: 'Obligations by set-aside type, illustrative', claim: 'fact', cites: ['s1'],
          series: [{ name: 'Share', points: [{ x: 'Small business', y: 41 }, { x: 'Full and open', y: 27 }, { x: '8(a)', y: 13 }, { x: 'SDVOSB', y: 10 }, { x: 'HUBZone', y: 6 }, { x: 'WOSB', y: 3 }] }],
        },
      ],
    },
    {
      id: 'buyers',
      heading: 'Who buys',
      blocks: [
        { type: 'paragraph', id: 'buyers-p1', claim: 'fact', cites: ['s1'], text: longText('the departments that buy these services') },
        {
          type: 'table', id: 'buyers-t1', caption: 'Obligations by department, FY2024–FY2026 (illustrative)', claim: 'fact', cites: ['s1'],
          columns: [
            { key: 'agency', label: 'Department' },
            { key: 'obligations', label: 'Obligations', format: 'usd' },
            { key: 'share', label: 'Share', format: 'pct' },
            { key: 'offices', label: 'Buying offices', format: 'int' },
          ],
          rows: agencies,
        },
        {
          type: 'chart', id: 'buyers-c1', kind: 'bar', caption: 'Top departments by obligations, illustrative', claim: 'fact', cites: ['s1'],
          series: [{ name: 'Obligations', points: agencies.slice(0, 8).map((r) => ({ x: String(r.agency), y: Number(r.obligations) })) }],
        },
      ],
    },
    {
      id: 'competition',
      heading: 'Competition',
      blocks: [
        { type: 'paragraph', id: 'comp-p1', claim: 'fact', cites: ['s1'], text: longText('the firms that win this work') },
        {
          type: 'table', id: 'comp-t1', caption: 'Leading vendors by obligations (illustrative)', claim: 'fact', cites: ['s1'],
          columns: [
            { key: 'vendor', label: 'Vendor' },
            { key: 'awards', label: 'Awards', format: 'int' },
            { key: 'obligations', label: 'Obligations', format: 'usd' },
            { key: 'setAside', label: 'Typical set-aside' },
            { key: 'state', label: 'HQ state' },
          ],
          rows: vendors,
        },
        { type: 'callout', id: 'comp-c1', tone: 'warning', claim: 'assumption', text: 'Vendor rankings reflect obligations, not win rates. A firm with fewer, larger awards can rank above a firm that wins more often.' },
        { type: 'paragraph', id: 'comp-p2', claim: 'assumption', cites: ['s1'], text: 'The market is moderately fragmented: no vendor appears to hold more than about 5% of obligations.' },
      ],
    },
    {
      id: 'pipeline',
      heading: 'Upcoming recompetes',
      blocks: [
        { type: 'paragraph', id: 'pipe-p1', claim: 'fact', cites: ['s3'], text: 'The contracts below end within the next 12 months and are the most likely to be competed again.' },
        {
          type: 'table', id: 'pipe-t1', caption: 'Contracts ending within 12 months (illustrative)', claim: 'fact', cites: ['s3'],
          columns: [
            { key: 'piid', label: 'Contract' },
            { key: 'agency', label: 'Agency' },
            { key: 'incumbent', label: 'Incumbent' },
            { key: 'value', label: 'Value', format: 'usd' },
            { key: 'ends', label: 'Ends', format: 'date' },
          ],
          rows: expiring,
        },
        {
          type: 'chart', id: 'pipe-c1', kind: 'bar', caption: 'Expiring value by agency, illustrative', claim: 'fact', cites: ['s3'],
          series: [
            { name: 'Next 6 months', points: ['VA', 'Army', 'Navy', 'GSA', 'Air Force'].map((x, i) => ({ x, y: (30 - i * 4) * 1_000_000 })) },
            { name: '6–12 months', points: ['VA', 'Army', 'Navy', 'GSA', 'Air Force'].map((x, i) => ({ x, y: (22 - i * 3) * 1_000_000 })) },
          ],
        },
      ],
    },
    {
      id: 'pricing',
      heading: 'Pricing context',
      blocks: [
        { type: 'paragraph', id: 'price-p1', claim: 'fact', cites: ['s4'], text: 'Your uploaded pricing notes list a loaded labor rate of $31.40 per hour for custodial staff and $38.75 for supervisors.' },
        { type: 'paragraph', id: 'price-p2', claim: 'fact', cites: ['s5'], text: 'The reference range for comparable federal custodial labor is $27–$36 per hour, before wage-determination adjustments.' },
        { type: 'paragraph', id: 'price-p3', claim: 'assumption', cites: ['s4', 's5'], text: 'Your custodial rate sits in the upper third of the reference range, which is competitive for best-value awards but may lose lowest-price, technically acceptable competitions.' },
        {
          type: 'table', id: 'price-t1', caption: 'Rate comparison (illustrative)', claim: 'fact', cites: ['s4', 's5'],
          columns: [{ key: 'role', label: 'Labor category' }, { key: 'yours', label: 'Your rate', align: 'right' }, { key: 'low', label: 'Reference low', align: 'right' }, { key: 'high', label: 'Reference high', align: 'right' }],
          rows: [
            { role: 'Custodial worker', yours: '$31.40', low: '$27.00', high: '$36.00' },
            { role: 'Floor care technician', yours: '$33.10', low: '$28.50', high: '$37.20' },
            { role: 'Supervisor', yours: '$38.75', low: '$33.00', high: '$44.00' },
            { role: 'Project manager', yours: null, low: '$45.00', high: '$62.00' },
          ],
        },
      ],
    },
    {
      id: 'recommendations',
      heading: 'Recommendations',
      blocks: [
        {
          type: 'bullets', id: 'rec-b1', ordered: true, items: [
            { claim: 'recommendation', cites: ['s3'], text: 'Track the **eight** VA and Army recompetes ending in the next six months and request each office\'s current statement of work.' },
            { claim: 'recommendation', cites: ['s1'], text: 'Introduce your firm to the small-business specialists at the three largest buying offices before solicitations post.' },
            { claim: 'recommendation', text: 'Prepare a lowest-price variant of your rate card for LPTA competitions.' },
            { claim: 'recommendation', text: 'Pursue teaming with an 8(a) or SDVOSB firm for set-asides you cannot bid directly.' },
          ],
        },
        { type: 'paragraph', id: 'rec-p1', claim: 'fact', cites: ['s1'], text: longText('the recommended next steps and their rationale') },
      ],
    },
    {
      id: 'method',
      heading: 'Method and limitations',
      role: 'about',
      blocks: [
        { type: 'paragraph', id: 'method-p1', claim: 'context', text: 'This report was assembled by Mindy from the research in one conversation. Facts are taken from the cited sources as recorded. Assumptions are premises stated by the author and are labeled. Recommendations are suggested actions and are labeled.' },
        { type: 'paragraph', id: 'method-p2', claim: 'context', text: 'Coverage is limited to the sources listed. A department or vendor absent from a table may still buy or sell these services under a different classification.' },
      ],
    },
  ],
};
