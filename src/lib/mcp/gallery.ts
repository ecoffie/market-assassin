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
  {
    id: 'event-action-plan',
    category: 'buyer',
    title: 'An action plan before you attend an event',
    result: 'Who will be in the room, what they are buying, who to meet and what to ask, before you walk in.',
    docTitle: 'Action plan · NAVFAC SE industry day',
    preview: {
      kind: 'list',
      items: [
        { title: 'Meet the small business specialist first', meta: 'Bring your capability statement', tag: 'Before' },
        { title: 'Ask about the base operations recompete', meta: 'Current contract ends Jun 2027', tag: 'In the room' },
        { title: 'Introduce yourself to Ridgeline Defense', meta: 'Likely prime, needs an 8(a) sub', tag: 'In the room' },
        { title: 'Send a 3-line follow-up within 48 hours', meta: 'Reference the question you asked', tag: 'After' },
      ],
    },
  },
  {
    id: 'go-to-market',
    category: 'find',
    title: 'A go-to-market strategy: where to start',
    result: 'The buyer, contract type and set-aside where a company like yours has the best first shot, and why.',
    docTitle: 'Go-to-market · janitorial · Florida',
    preview: {
      kind: 'dossier',
      badge: 'Start here',
      fields: [
        ['First buyer', 'VA Sunshine Healthcare'],
        ['Why', '14 small buys a year, under $250K'],
        ['Your edge', 'SDVOSB set-aside'],
        ['Vehicle to get on', 'VA FSS 36 (later)'],
        ['90-day goal', '2 bids, 1 capability brief'],
      ],
      note: 'Skip DoD for now: most of its spend here is bundled into large base contracts.',
    },
  },
  {
    id: 'whos-winning-near-me',
    category: 'compete',
    title: "Who's winning around you",
    result: 'The companies winning federal work near you, how much, and from which agencies.',
    docTitle: 'Situational awareness · 50 mi of Tampa',
    preview: {
      kind: 'bars',
      headline: '$412M',
      sub: 'awarded within 50 miles of Tampa, last 12 months',
      bars: [
        { label: 'Bay Area Facility Svcs', value: '$38M', pct: 100 },
        { label: 'Gulfline Construction', value: '$27M', pct: 71 },
        { label: 'Suncoast IT Group', value: '$19M', pct: 50 },
        { label: 'Harbor Point Services', value: '$12M', pct: 32 },
      ],
    },
  },
  {
    id: 'teaming-plan',
    category: 'compete',
    title: 'How to team with a specific firm',
    result: 'Why they would want you, the role you should ask for, and how to open the conversation.',
    docTitle: 'Teaming plan · Ridgeline Defense',
    preview: {
      kind: 'dossier',
      badge: 'Good fit',
      fields: [
        ['Their gap', 'No 8(a) on the recompete team'],
        ['Your role', 'Sub for custodial + grounds'],
        ['Ask for', '30% of the work, named in the bid'],
        ['Who to contact', 'Capture manager, Air Force'],
        ['Open with', 'Your Robins AFB past work'],
      ],
      note: 'They won the last two task orders with large-business subs only.',
    },
  },
  {
    id: 'elevator-pitch',
    category: 'buyer',
    title: 'Your elevator pitch for a customer',
    result: 'What to say to a contracting officer or program manager in 30 seconds, built from their priorities.',
    docTitle: 'Elevator pitch · VA facilities',
    preview: {
      kind: 'doc',
      heading: '30 seconds with the facilities chief',
      paragraphs: [
        'We keep VA clinics inspection-ready. Our crews already cover three VA sites in Florida with zero missed walkthroughs this year.',
        "With your maintenance backlog on the GAO list, I'd like to show how we cut work-order time by a third at Orlando. Can I send you a one-page summary?",
      ],
    },
  },
  {
    id: 'competitor-dossier',
    category: 'compete',
    title: 'A dossier on a competitor',
    result: 'What a rival wins, from which agencies, which of its contracts end soon, and its finances if it is public.',
    docTitle: 'Competitor dossier · Gulfline Construction',
    preview: {
      kind: 'dossier',
      badge: 'Watch',
      fields: [
        ['Won last 3 years', '$84M across 31 awards'],
        ['Top buyer', 'Army Corps, Jacksonville'],
        ['Ending in 12 months', '4 contracts, $22M'],
        ['Set-aside used', 'Small business, HUBZone'],
        ['Public company', 'No (private)'],
      ],
      note: 'Two of its expiring contracts were sole bids. Those are the ones to chase.',
    },
  },
  {
    id: 'prime-outreach',
    category: 'compete',
    title: 'Who to email at the big primes',
    result: 'The small business liaison at each prime in your space, with a short email to send each one.',
    docTitle: 'Prime outreach list · facilities',
    preview: {
      kind: 'people',
      office: 'Small business liaisons at 4 primes',
      people: [
        { name: 'Ridgeline Defense', role: 'Supplier diversity manager' },
        { name: 'Atlas Base Services', role: 'Small business liaison officer' },
        { name: 'Corvane Federal', role: 'Subcontracts program lead' },
        { name: 'Northgate Logistics', role: 'Small business liaison officer' },
      ],
    },
  },
  {
    id: 'agency-one-pager',
    category: 'buyer',
    title: 'A one-pager on any agency',
    result: 'What one buyer is buying, what it is struggling with, and who to call, on one page.',
    docTitle: 'Agency one-pager · VA Sunshine Healthcare',
    preview: {
      kind: 'dossier',
      badge: 'Buyer brief',
      fields: [
        ['Buys most', 'Facilities, medical equipment, IT'],
        ['Struggling with', 'Maintenance backlog (GAO)'],
        ['Small business share', '41% of spend'],
        ['Open right now', '22 notices'],
        ['Call first', 'Small business specialist'],
      ],
      note: 'Most buys under $250K go out as small business set-asides.',
    },
  },
  {
    id: 'past-performance',
    category: 'win',
    title: 'Past performance write-ups from your UEI',
    result: 'Proposal-ready summaries of your federal contracts, built from your own award history.',
    docTitle: 'Past performance · Peachstate Systems',
    preview: {
      kind: 'doc',
      heading: 'VA Atlanta network modernization',
      paragraphs: [
        'Peachstate Systems redesigned the network at three VA Atlanta sites under a $3.2M task order, finishing two weeks early.',
        'We moved 1,400 users to zero-trust access with no unplanned outages and passed the ATO review on the first attempt.',
      ],
    },
  },
  {
    id: 'price-to-win',
    category: 'win',
    title: 'A price-to-win sheet',
    result: 'What the government pays for each labor role, so your rates land in range.',
    docTitle: 'Price-to-win · facilities team',
    preview: {
      kind: 'table',
      columns: ['Role', 'Low', 'Typical', 'High'],
      rows: [
        ['Site manager', '$48', '$62', '$81'],
        ['HVAC technician', '$34', '$44', '$58'],
        ['Custodial lead', '$22', '$28', '$36'],
        ['Grounds worker', '$19', '$24', '$31'],
      ],
      highlight: 1,
    },
  },
  {
    id: 'capture-plan',
    category: 'win',
    title: 'A capture plan for one pursuit',
    result: 'The incumbent, the buyer, the likely competitors and your next steps on a single opportunity.',
    docTitle: 'Capture plan · Robins AFB grounds',
    preview: {
      kind: 'list',
      items: [
        { title: 'Incumbent: Harbor Point Services', meta: '$6.1M, ends Mar 2027', tag: 'Who' },
        { title: 'Likely bidders: 4 small businesses', meta: '2 have won here before', tag: 'Who' },
        { title: 'Meet the contracting officer', meta: 'Before the draft RFP', tag: 'Next' },
        { title: 'Line up an 8(a) teaming partner', meta: 'Fills the snow-removal gap', tag: 'Next' },
      ],
    },
  },
  {
    id: 'rfi-response',
    category: 'win',
    title: 'A response to a sources sought notice',
    result: 'A drafted reply to a market research notice, so the buyer knows you exist before the RFP.',
    docTitle: 'Sources sought response · NAVFAC SE',
    preview: {
      kind: 'doc',
      heading: 'Response to sources sought N69450-27-R-0012',
      paragraphs: [
        'Bay Area Facility Services is a HUBZone small business with five years of base operations work at MacDill AFB and NAS Jacksonville.',
        'We can perform all of the work described and recommend a small business set-aside. Our capability statement is attached.',
      ],
    },
  },
  {
    id: 'prime-sub-split',
    category: 'compete',
    title: 'How a big contract is split up',
    result: 'Who the prime pays as subs on a large contract, and where a small business fits in.',
    docTitle: 'Prime and sub split · base operations',
    preview: {
      kind: 'bars',
      headline: '$48M',
      sub: 'paid to subcontractors on one base operations contract',
      bars: [
        { label: 'Custodial', value: '$17M', pct: 100 },
        { label: 'Grounds', value: '$12M', pct: 71 },
        { label: 'HVAC repair', value: '$11M', pct: 65 },
        { label: 'Pest control', value: '$8M', pct: 47 },
      ],
    },
  },
  {
    id: 'weekly-pipeline',
    category: 'find',
    title: 'A Monday pipeline email',
    result: 'A saved search that sends you new matching work every week, without opening anything.',
    docTitle: 'Every Monday · janitorial · FL + GA',
    preview: {
      kind: 'list',
      items: [
        { title: 'VA Tampa custodial services', meta: 'Bids due Dec 4', tag: 'New' },
        { title: 'Fort Moore grounds maintenance', meta: 'Sources sought, replies due Nov 28', tag: 'New' },
        { title: 'MacDill AFB janitorial', meta: 'Draft RFP posted', tag: 'Changed' },
        { title: 'Orlando VA Medical Center', meta: 'Deadline moved to Dec 12', tag: 'Changed' },
      ],
    },
  },
  {
    id: 'event-calendar',
    category: 'buyer',
    title: 'Your event calendar for the year',
    result: 'The industry days and outreach events for your market, as a file you add to your calendar.',
    docTitle: 'Event calendar · Navy · Southeast',
    preview: {
      kind: 'list',
      items: [
        { title: 'NAVFAC SE industry day', meta: 'Jan 14 · Jacksonville, FL', tag: 'In person' },
        { title: 'Navy small business forum', meta: 'Feb 3 · online', tag: 'Online' },
        { title: 'SAME Jacksonville post meeting', meta: 'Mar 10 · Jacksonville, FL', tag: 'In person' },
        { title: 'NAVSUP outreach session', meta: 'Apr 22 · Mechanicsburg, PA', tag: 'In person' },
      ],
    },
  },
  {
    id: 'grant-finder',
    category: 'find',
    title: 'Federal grants that fit you',
    result: 'Open federal grants that match what you do, with the agency, amount and deadline.',
    docTitle: 'Grants · workforce training',
    preview: {
      kind: 'table',
      columns: ['Grant', 'Agency', 'Up to', 'Due'],
      rows: [
        ['Apprenticeship expansion', 'Labor', '$4M', 'Jan 30'],
        ['Rural workforce program', 'USDA', '$1.5M', 'Feb 14'],
        ['Veteran job training', 'VA', '$750K', 'Mar 3'],
      ],
    },
  },
  {
    id: 'path-to-contract',
    category: 'find',
    title: 'Your path into government contracts',
    result: 'Which way in suits you (GSA Schedule, SBIR, set-asides or subcontracting), with the evidence.',
    docTitle: 'Path to contract · Peachstate Systems',
    preview: {
      kind: 'verdict',
      verdict: 'Start with set-asides',
      score: 78,
      reasons: [
        { ok: true, text: 'Your SDVOSB status matches 31 open set-asides' },
        { ok: true, text: 'Subcontracting first builds past performance' },
        { ok: false, text: 'GSA Schedule needs 2 years of revenue first' },
        { ok: false, text: 'SBIR fits research work, not IT operations' },
      ],
    },
  },
  {
    id: 'set-aside-goals',
    category: 'buyer',
    title: 'Which agencies need firms like yours',
    result: 'Agencies behind on their small business goals, so they are looking for companies like yours.',
    docTitle: 'Small business goals · women-owned',
    preview: {
      kind: 'bars',
      headline: '5%',
      sub: 'federal goal for women-owned small businesses, by agency',
      bars: [
        { label: 'Energy', value: '2.1%', pct: 42 },
        { label: 'NASA', value: '3.0%', pct: 60 },
        { label: 'Army', value: '3.8%', pct: 76 },
        { label: 'Interior', value: '5.6%', pct: 100 },
      ],
    },
  },
  {
    id: 'market-research-memo',
    category: 'buyer',
    title: 'A market research memo for buyers',
    result: 'For contracting officers: how many capable small businesses exist for a requirement, with sources.',
    docTitle: 'Market research · custodial · Tampa',
    preview: {
      kind: 'verdict',
      verdict: 'Set aside for small business',
      score: 92,
      reasons: [
        { ok: true, text: '14 small businesses have done this work nearby' },
        { ok: true, text: '6 have won federal custodial work in Florida' },
        { ok: true, text: 'At least 2 can bid at a fair price' },
        { ok: false, text: 'Only 1 is HUBZone, too few for a HUBZone set-aside' },
      ],
    },
  },
  {
    id: 'lessons-from-winners',
    category: 'win',
    title: 'Advice from people who won',
    result: 'What GovCon Giants podcast guests did in your situation, in their own words.',
    docTitle: 'Lessons from winners · first contract',
    preview: {
      kind: 'list',
      items: [
        { title: 'Call the small business office before you bid', meta: 'Guest who won a $2M VA contract', tag: 'Lesson' },
        { title: 'Your first win is usually a sub', meta: 'Guest who grew to $40M', tag: 'Lesson' },
        { title: 'Pick one agency and go deep', meta: 'Guest who won 12 Army awards', tag: 'Lesson' },
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
  'Build me an action plan for the NAVFAC industry day:',
  'Where should a small janitorial company in Florida start',
  "Who's winning federal work within 50 miles of",
  'How do I team with Ridgeline Defense on the',
  'Write me a 30-second elevator pitch for the VA',
  'Build me a dossier on Gulfline Construction: what it',
  'Who is the small business liaison at each prime',
  'Give me a one-pager on VA Sunshine Healthcare: what',
  'Write past performance summaries from my federal award',
  'What does the government pay per hour for a site',
  'Build me a capture plan for the Robins AFB grounds',
  'Draft my response to this sources sought notice from',
  'Every Monday, send me new janitorial work in Florida',
  'Which agencies are behind on their women-owned small business',
];


// Deep links into the gallery live in gallery-links.ts (kept apart so the pricing page can import
// them without bundling every example).
export { GALLERY_EXAMPLE_PARAM, galleryExampleHref, PRICING_TASK_EXAMPLES } from './gallery-links';
