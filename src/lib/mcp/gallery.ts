/**
 * "Mindy in your AI" gallery — the finished results Mindy hands back inside Claude, ChatGPT or
 * any MCP agent. Public data: titles, what you get, and a sample of the finished result.
 *
 * The PROMPTS are not here on purpose. They live in gallery-prompts.ts, which only the signed-in
 * API route imports, so a signed-out visitor never receives them (not even in page source).
 * Credits are deliberately not shown anywhere on the gallery.
 *
 * Every preview is a SAMPLE: the companies are made up and the figures are illustrative. The
 * page says so. A real run returns live federal data.
 */

export type GalleryCategory = 'find' | 'compete' | 'buyer' | 'win';

export const GALLERY_CATEGORIES: Array<{ id: GalleryCategory; label: string }> = [
  { id: 'find', label: 'Find work' },
  { id: 'compete', label: 'Know the competition' },
  { id: 'buyer', label: 'Know the buyer' },
  { id: 'win', label: 'Win the bid' },
];

export type GalleryPreview =
  | { kind: 'horizons'; columns: Array<{ label: string; count: string; items: string[] }> }
  | { kind: 'table'; columns: string[]; rows: string[][]; highlight?: number }
  | { kind: 'bars'; headline: string; sub: string; bars: Array<{ label: string; value: string; pct: number }> }
  | { kind: 'dossier'; badge: string; fields: Array<[string, string]>; note: string }
  | { kind: 'people'; office: string; people: Array<{ name: string; role: string }> }
  | { kind: 'verdict'; verdict: string; score: number; reasons: Array<{ ok: boolean; text: string }> }
  | { kind: 'matrix'; rows: Array<{ ref: string; req: string; section: string; status: 'ok' | 'gap' }> }
  | { kind: 'doc'; heading: string; paragraphs: string[] }
  | { kind: 'list'; items: Array<{ title: string; meta: string; tag?: string }> };

export interface GalleryItem {
  id: string;
  category: GalleryCategory;
  title: string;
  /** One line: what lands in the chat. */
  result: string;
  /** Shown on the card face. */
  docTitle: string;
  /** Shown large at the top of the page; the rest are listed below. */
  featured?: boolean;
  preview: GalleryPreview;
}

export const GALLERY_ITEMS: GalleryItem[] = [
  {
    id: 'where-the-money-is',
    featured: true,
    category: 'find',
    title: 'Where the money is for what you sell',
    result: 'Open bids, contracts coming back and planned buys for your work, in one answer.',
    docTitle: 'Janitorial services · Florida',
    preview: {
      kind: 'horizons',
      columns: [
        { label: 'Open now', count: '38', items: ['VA Tampa custodial', 'NAS Jax janitorial', 'USCG Miami cleaning'] },
        { label: 'Coming back', count: '21', items: ['MacDill AFB, ends Mar', 'Orlando VAMC, ends Jun'] },
        { label: 'Coming soon', count: '9', items: ['GSA Region 4 forecast', 'DHS Miami forecast'] },
      ],
    },
  },
  {
    id: 'expiring-contracts',
    category: 'find',
    title: 'Contracts coming back up for bid',
    result: 'Contracts in your market that end in the next 12 months, with the current holder and value.',
    docTitle: 'Recompetes · next 12 months',
    preview: {
      kind: 'table',
      columns: ['Contract', 'Holder', 'Ends'],
      rows: [
        ['Base facilities support', 'Harbor Point Svcs', 'Feb 2027'],
        ['Grounds maintenance', 'Tri-County Green', 'Apr 2027'],
        ['HVAC O&M', 'Summit Mechanical', 'Jun 2027'],
        ['Custodial, 4 bldgs', 'BrightPath LLC', 'Sep 2027'],
      ],
    },
  },
  {
    id: 'agency-forecasts',
    category: 'find',
    title: 'What agencies plan to buy next year',
    result: 'Agency buying plans 6 to 18 months before the solicitation posts.',
    docTitle: 'Forecasts · IT services',
    preview: {
      kind: 'list',
      items: [
        { title: 'Help desk modernization', meta: 'Dept. of Energy · Q2 FY27', tag: 'Small business' },
        { title: 'Cloud migration support', meta: 'Dept. of the Interior · Q3 FY27', tag: '8(a)' },
        { title: 'Cybersecurity assessments', meta: 'Dept. of Justice · Q1 FY27', tag: 'Full & open' },
      ],
    },
  },
  {
    id: 'matched-to-my-company',
    category: 'find',
    title: 'Work matched to your company',
    result: 'Open bids that fit your registration, certifications and past awards, from just your UEI.',
    docTitle: 'Matches · from your UEI',
    preview: {
      kind: 'list',
      items: [
        { title: 'Grounds maintenance, Fort Moore', meta: 'Army · closes in 12 days', tag: 'Fits your NAICS' },
        { title: 'Landscaping BPA, VA Atlanta', meta: 'VA · closes in 19 days', tag: 'SDVOSB' },
        { title: 'Tree removal, Robins AFB', meta: 'Air Force · closes in 26 days', tag: 'Past work' },
      ],
    },
  },
  {
    id: 'who-holds-it',
    featured: true,
    category: 'compete',
    title: 'Who holds this contract now',
    result: 'The likely incumbent, what the contract is worth, when it ends and how it was awarded.',
    docTitle: 'Incumbent check',
    preview: {
      kind: 'dossier',
      badge: 'High confidence',
      fields: [
        ['Incumbent', 'Ridgeline Defense'],
        ['Ceiling', '$14.2M'],
        ['Ends', 'Jun 30, 2027'],
        ['Vehicle', 'GSA MAS'],
        ['Set-aside', 'SDVOSB'],
      ],
      note: 'Matched on the predecessor contract number in the notice.',
    },
  },
  {
    id: 'who-wins',
    category: 'compete',
    title: 'Who wins in your market',
    result: 'The companies taking the most federal money for your kind of work, ranked.',
    docTitle: 'Top winners · roofing',
    preview: {
      kind: 'bars',
      headline: '$1.3B',
      sub: 'roofing awards, last 3 years',
      bars: [
        { label: 'Cardinal Roofing', value: '$84M', pct: 100 },
        { label: 'Apex Envelope', value: '$61M', pct: 73 },
        { label: 'Gulf Coast Roof Co', value: '$47M', pct: 56 },
        { label: 'Summit Builders', value: '$33M', pct: 39 },
      ],
    },
  },
  {
    id: 'teaming-partners',
    category: 'compete',
    title: 'Teaming partners for a bid',
    result: 'Small businesses already winning this work, with their certifications and past awards.',
    docTitle: 'Partners · HUBZone · GA',
    preview: {
      kind: 'table',
      columns: ['Company', 'Certs', 'Won'],
      rows: [
        ['Peachstate Systems', 'HUBZone, WOSB', '$12M'],
        ['Altamaha Aero', 'SDVOSB', '$9M'],
        ['Fort Valley Logistics', 'HUBZone', '$6M'],
        ['Coastal Plains Maint.', '8(a)', '$4M'],
      ],
    },
  },
  {
    id: 'who-buys-it',
    category: 'buyer',
    title: 'Who actually buys this',
    result: 'The contracting officers and specialists at the buying office, with how to reach them.',
    docTitle: 'Buying office roster',
    preview: {
      kind: 'people',
      office: 'Army Corps of Engineers · LA District',
      people: [
        { name: 'Contracting Officer', role: 'Construction & A-E' },
        { name: 'Contract Specialist', role: 'Small-business set-asides' },
        { name: 'Small Business Specialist', role: 'Outreach and capability briefings' },
      ],
    },
  },
  {
    id: 'agency-priorities',
    category: 'buyer',
    title: 'What an agency is struggling with',
    result: 'Its stated priorities and problems, from GAO reports and budget documents, with sources.',
    docTitle: 'Agency brief · VA',
    preview: {
      kind: 'list',
      items: [
        { title: 'Facility maintenance backlog', meta: 'GAO high-risk list', tag: 'Priority' },
        { title: 'EHR modernization delays', meta: 'Budget justification', tag: 'Priority' },
        { title: 'Community care scheduling', meta: 'OIG report', tag: 'Problem' },
      ],
    },
  },
  {
    id: 'meet-the-buyers',
    category: 'buyer',
    title: 'Where to meet the buyers in person',
    result: 'Industry days, outreach events and conferences for your agencies, with dates.',
    docTitle: 'Events · Navy · Southeast',
    preview: {
      kind: 'list',
      items: [
        { title: 'NAVFAC Southeast industry day', meta: 'Jacksonville, FL · Dec 9', tag: 'In person' },
        { title: 'Small business outreach session', meta: 'Virtual · Dec 14', tag: 'Online' },
        { title: 'SAME Small Business Conference', meta: 'Tampa, FL · Jan 21', tag: 'Conference' },
      ],
    },
  },
  {
    id: 'labor-rates',
    category: 'buyer',
    title: 'Fair labor rates to price your bid',
    result: 'What the government already pays for each labor category, low to high.',
    docTitle: 'Labor rates · GSA schedule',
    preview: {
      kind: 'table',
      columns: ['Role', 'Low', 'Median', 'High'],
      rows: [
        ['Project Manager', '$98', '$134', '$181'],
        ['Sr. Software Engineer', '$112', '$148', '$196'],
        ['Help Desk Tier 2', '$46', '$62', '$84'],
        ['Cyber Analyst', '$89', '$121', '$163'],
      ],
      highlight: 2,
    },
  },
  {
    id: 'bid-no-bid',
    featured: true,
    category: 'win',
    title: 'Should you bid on this?',
    result: 'A bid or no-bid call with the reasons, before you spend a week on a proposal.',
    docTitle: 'Bid decision',
    preview: {
      kind: 'verdict',
      verdict: 'Bid',
      score: 78,
      reasons: [
        { ok: true, text: 'Your NAICS and set-aside match' },
        { ok: true, text: 'Incumbent ends its term in June' },
        { ok: false, text: 'No past work with this agency yet' },
      ],
    },
  },
  {
    id: 'compliance-matrix',
    category: 'win',
    title: 'Compliance matrix from the RFP',
    result: 'Every "shall" in the solicitation, mapped to where your proposal answers it.',
    docTitle: 'Compliance matrix',
    preview: {
      kind: 'matrix',
      rows: [
        { ref: 'L.4.1', req: 'Technical approach, 10 pages max', section: 'Vol I §2', status: 'ok' },
        { ref: 'L.4.2', req: 'Key personnel resumes', section: 'Vol I §4', status: 'ok' },
        { ref: 'M.2', req: 'Three past performance refs', section: 'Vol III', status: 'gap' },
        { ref: 'C.5.3', req: 'Quality control plan', section: 'Vol I §5', status: 'ok' },
      ],
    },
  },
  {
    id: 'proposal-draft',
    category: 'win',
    title: 'A first draft of your proposal',
    result: 'A full draft written from the RFP and your own past work, ready for you to edit.',
    docTitle: 'Volume I · Technical approach',
    preview: {
      kind: 'doc',
      heading: '2.1 Understanding the requirement',
      paragraphs: [
        'The Government requires continuous custodial coverage across four buildings with surge support during inspection windows.',
        'Our approach assigns a dedicated site lead, a trained floater crew and a quality-control checklist reviewed weekly with the COR.',
      ],
    },
  },
  {
    id: 'market-report',
    featured: true,
    category: 'win',
    title: 'A market report you can send a client',
    result: 'A branded report with a share link: market size, top buyers, top winners and what to do next.',
    docTitle: 'Market report · drones',
    preview: {
      kind: 'bars',
      headline: '$243M',
      sub: 'spent on drones across 42 NAICS codes',
      bars: [
        { label: 'Army', value: '$71M', pct: 100 },
        { label: 'Air Force', value: '$52M', pct: 73 },
        { label: 'Navy', value: '$38M', pct: 54 },
        { label: 'DHS', value: '$21M', pct: 30 },
      ],
    },
  },
];
