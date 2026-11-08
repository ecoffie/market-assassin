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
  | { kind: 'list'; items: Array<{ title: string; meta: string; tag?: string }> }
  | {
      kind: 'capability';
      company: string;
      tagline: string;
      competencies: string[];
      differentiators: string[];
      pastPerformance: Array<{ agency: string; work: string; value: string }>;
      naics: string[];
      certs: string[];
      data: Array<[string, string]>;
    }
  | {
      kind: 'report';
      headline: string;
      sub: string;
      agencies: Array<{ label: string; value: string; pct: number }>;
      winners: Array<{ label: string; value: string; pct: number }>;
      setAside: Array<{ label: string; pct: number }>;
    }
  | { kind: 'map'; region: string; legend: Array<{ label: string; count: string }>; pins: Array<{ x: number; y: number; s: 0 | 1 | 2 }>; cities: Array<{ x: number; y: number; name: string }> }
  | { kind: 'landscape'; headline: string; sub: string; shares: Array<{ label: string; pct: number }>; smallPct: number; trend: number[] };

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
    id: 'capability-statement',
    featured: true,
    category: 'win',
    title: 'A capability statement from your UEI',
    result: 'A one-page capability statement built from your SAM registration and award history, ready to send.',
    docTitle: 'Capability statement',
    preview: {
      kind: 'capability',
      company: 'Peachstate Systems',
      tagline: 'Cybersecurity and IT operations for federal health and defense',
      competencies: ['Zero-trust network design', 'RMF and ATO support', '24/7 security operations', 'Help desk, Tier 1–3'],
      differentiators: ['Cleared staff in 4 states', 'CMMC Level 2 certified', 'On-site within 48 hours'],
      pastPerformance: [
        { agency: 'VA', work: 'Network modernization', value: '$4.2M' },
        { agency: 'Army', work: 'SOC support', value: '$2.8M' },
        { agency: 'DHS', work: 'Help desk', value: '$1.1M' },
      ],
      naics: ['541512', '541519', '541513'],
      certs: ['WOSB', 'HUBZone', 'Small business'],
      data: [['UEI', 'EXAMPLE12345'], ['CAGE', '7XX12'], ['Location', 'Macon, GA']],
    },
  },
  {
    id: 'money-map',
    featured: true,
    category: 'find',
    title: 'A map of where the money is',
    result: 'Open bids, contracts coming back and planned buys for your work, pinned on a map of your area.',
    docTitle: 'Map · facilities work · Florida',
    preview: {
      kind: 'map',
      region: 'Florida',
      legend: [
        { label: 'Open now', count: '38' },
        { label: 'Coming back', count: '21' },
        { label: 'Coming soon', count: '9' },
      ],
      cities: [
        { x: 132, y: 52, name: 'Jacksonville' },
        { x: 112, y: 128, name: 'Orlando' },
        { x: 70, y: 150, name: 'Tampa' },
        { x: 152, y: 232, name: 'Miami' },
        { x: 18, y: 40, name: 'Pensacola' },
      ],
      pins: [
        { x: 136, y: 58, s: 0 }, { x: 128, y: 64, s: 1 }, { x: 140, y: 70, s: 0 }, { x: 116, y: 132, s: 0 },
        { x: 108, y: 124, s: 2 }, { x: 122, y: 140, s: 1 }, { x: 74, y: 156, s: 0 }, { x: 66, y: 146, s: 1 },
        { x: 80, y: 162, s: 0 }, { x: 156, y: 226, s: 0 }, { x: 150, y: 238, s: 1 }, { x: 160, y: 214, s: 2 },
        { x: 22, y: 46, s: 0 }, { x: 30, y: 40, s: 1 }, { x: 96, y: 100, s: 2 }, { x: 144, y: 180, s: 0 },
        { x: 120, y: 200, s: 1 }, { x: 60, y: 44, s: 0 },
      ],
    },
  },
  {
    id: 'where-the-money-is',
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
    featured: true,
    category: 'compete',
    title: 'Who wins your market',
    result: 'Every company taking federal money for your kind of work, its share, and how much goes to small businesses.',
    docTitle: 'Competitive landscape · roofing',
    preview: {
      kind: 'landscape',
      headline: '$1.3B',
      sub: 'federal roofing awards, last 3 fiscal years',
      shares: [
        { label: 'Cardinal Roofing', pct: 22 },
        { label: 'Apex Envelope', pct: 16 },
        { label: 'Gulf Coast Roof Co', pct: 12 },
        { label: 'Summit Builders', pct: 9 },
        { label: '412 other firms', pct: 41 },
      ],
      smallPct: 63,
      trend: [38, 41, 44, 40, 47, 52, 49, 58, 61, 57, 66, 72],
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
    result: 'A branded report with a share link: market size, who buys, who wins and how much is set aside.',
    docTitle: 'Market report · drones',
    preview: {
      kind: 'report',
      headline: '$243M',
      sub: 'spent on drones across 42 NAICS codes, FY24',
      agencies: [
        { label: 'Army', value: '$71M', pct: 29 },
        { label: 'Air Force', value: '$52M', pct: 21 },
        { label: 'Navy', value: '$38M', pct: 16 },
        { label: 'DHS', value: '$21M', pct: 9 },
        { label: 'Other', value: '$61M', pct: 25 },
      ],
      winners: [
        { label: 'Skyline UAS', value: '$31M', pct: 100 },
        { label: 'Vector Aerial', value: '$22M', pct: 71 },
        { label: 'Northwind Robotics', value: '$14M', pct: 45 },
      ],
      setAside: [
        { label: 'Small business', pct: 34 },
        { label: '8(a)', pct: 11 },
        { label: 'SDVOSB', pct: 7 },
        { label: 'Full & open', pct: 48 },
      ],
    },
  },
];

/**
 * The openings typed into the bottom prompt bar. Deliberately only the first few words: the
 * full prompts stay signed-in only (gallery-prompts.ts).
 */
export const GALLERY_STARTERS = [
  'Build a capability statement for my company from',
  'Where is the money right now for a janitorial company in',
  'Show me on a map where the federal facilities work is',
  'Who wins federal roofing work, and how much goes to',
  'Build me a market report on drone spending that I can',
  'Who holds this contract now, and when does it',
  'Should my company bid on this solicitation? Give me',
  'Find HUBZone small businesses in Georgia that have already',
  'Who at the Army Corps LA District actually buys',
];
