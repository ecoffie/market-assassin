/**
 * Mindy GovCon Glossary — 60+ federal contracting terms.
 *
 * Ported from govcon-funnels (/src/content/glossary.ts) with Mindy-first
 * branding. Definitions are factual and intentionally tight (50–150 words)
 * so they double as Google "definition" rich results via DefinedTerm JSON-LD.
 *
 * `mindyUse` is the 1–2 sentence "How Mindy uses this term" callout that
 * appears on the detail page. Used to contextualize each term inside the
 * product so the glossary doubles as a soft conversion surface.
 *
 * `related` is an optional list of other glossary slugs to surface as
 * "Related terms." If omitted, the detail page falls back to terms that
 * share the same first letter, then a small set of evergreen anchors.
 *
 * `productLink` (optional) lets a term deep-link into the actual Mindy
 * feature that uses the concept — e.g. "Recompete" → /expiring-contracts,
 * "Forecast" → /forecasts.
 */
export interface GlossaryTerm {
  term: string;
  slug: string;
  definition: string;
  mindyUse: string;
  related?: string[];
  productLink?: {
    label: string;
    href: string;
  };
}

export const glossaryTerms: GlossaryTerm[] = [
  {
    term: '8(a) Program',
    slug: '8a-program',
    definition:
      "The SBA's 8(a) Business Development Program for socially and economically disadvantaged small businesses. Provides access to sole-source contracts up to $4.5M (services) or $8M (manufacturing), mentoring, and a nine-year development period.",
    mindyUse:
      'Mindy filters set-aside opportunities by your certifications, so 8(a) holders see 8(a)-eligible work first in every daily briefing.',
    related: ['sba', 'set-aside', 'sole-source', 'mentor-protege'],
  },
  {
    term: 'APEX Accelerator',
    slug: 'apex-accelerator',
    definition:
      'Formerly known as PTACs (Procurement Technical Assistance Centers). Free DoD-funded consulting programs that help businesses understand and compete for government contracts. Services include registration assistance, bid matching, proposal review, and training. Find your local APEX at apexaccelerators.us.',
    mindyUse:
      'APEX counselors and Mindy pair well: counselors help you register and respond, Mindy finds the opportunities to respond to.',
    related: ['sam-gov', 'sba', 'osdbu'],
  },
  {
    term: 'Best Value',
    slug: 'best-value',
    definition:
      'An evaluation approach where the government considers factors in addition to price when making an award decision. The government selects the proposal that offers the greatest overall benefit, which may not be the lowest-priced offer.',
    mindyUse:
      'Mindy flags each opportunity as Best Value or LPTA in your briefing so you can prioritize the ones where your differentiation actually counts.',
    related: ['lpta', 'rfp', 'past-performance'],
  },
  {
    term: 'Bid/No-Bid Decision',
    slug: 'bid-no-bid',
    definition:
      'The strategic analysis a contractor performs to decide whether to pursue a specific contract opportunity. Considers factors like competitive landscape, past performance fit, resource availability, and probability of win.',
    mindyUse:
      "Every Mindy opportunity card includes a fit score and incumbent context so the bid/no-bid call takes 60 seconds instead of an afternoon of research.",
    related: ['capture-manager', 'past-performance', 'rfp'],
  },
  {
    term: 'CAGE Code',
    slug: 'cage-code',
    definition:
      'Commercial and Government Entity code — a unique five-character alphanumeric identifier assigned by the Defense Logistics Agency (DLA) to entities doing business with the federal government. Obtained automatically through SAM.gov registration.',
    mindyUse:
      'Mindy stores your CAGE code on your profile so contractor lookups, capability statement exports, and pursuit briefs are pre-filled.',
    related: ['sam-gov', 'uei', 'ncage-code'],
  },
  {
    term: 'Capability Statement',
    slug: 'capability-statement',
    definition:
      'A one- to two-page document that serves as a business resume for government buyers. Includes core competencies, past performance, differentiators, and company data (UEI, CAGE code, NAICS codes, certifications).',
    mindyUse:
      'Mindy keeps the data points that belong on your capability statement (NAICS, UEI, CAGE, set-asides) in one place so the doc is never stale.',
    related: ['cage-code', 'uei', 'naics-code', 'past-performance'],
  },
  {
    term: 'CO (Contracting Officer)',
    slug: 'contracting-officer',
    definition:
      'The government official with legal authority to enter into, administer, and terminate contracts on behalf of the government. Only COs can bind the government to a contractual agreement.',
    mindyUse:
      'Every Mindy opportunity card surfaces the named Contracting Officer so you can research them on LinkedIn before submitting a question.',
    related: ['cor', 'rfp', 'point-of-contact'],
  },
  {
    term: 'Compliance Matrix',
    slug: 'compliance-matrix',
    definition:
      'A document that maps every requirement in a solicitation to the corresponding section of your proposal. Ensures no requirements are missed and demonstrates full responsiveness to evaluators.',
    mindyUse:
      'Mindy parses solicitation requirements out of each RFP attachment so you can start your compliance matrix from a structured list, not a PDF wall.',
    related: ['rfp', 'sow', 'pws', 'proposal-manager'],
  },
  {
    term: 'COR (Contracting Officer Representative)',
    slug: 'cor',
    definition:
      "A government employee designated by the Contracting Officer to assist in managing contract performance. CORs monitor day-to-day work, review deliverables, and report to the CO, but cannot modify contract terms.",
    mindyUse:
      'Once you win work, Mindy tracks the CO and COR on each active contract so you have the right names ready for any modification or question.',
    related: ['contracting-officer', 'point-of-contact'],
  },
  {
    term: 'CPARS',
    slug: 'cpars',
    definition:
      "Contractor Performance Assessment Reporting System — the government's database for recording contractor performance evaluations. Past performance ratings in CPARS directly affect your ability to win future contracts.",
    mindyUse:
      "Mindy's pursuit briefs include incumbent CPARS context where available so you know whether the incumbent is vulnerable or entrenched.",
    related: ['past-performance', 'ppq', 'debriefing'],
  },
  {
    term: 'EDWOSB',
    slug: 'edwosb',
    definition:
      'Economically Disadvantaged Women-Owned Small Business — an SBA certification for women-owned businesses whose owners meet additional economic disadvantage thresholds. Provides access to set-asides in a broader range of NAICS codes than standard WOSB certification.',
    mindyUse:
      'Mindy filters EDWOSB-eligible set-asides into a dedicated stream so you only see work your certification actually unlocks.',
    related: ['wosb', 'sba', 'set-aside'],
  },
  {
    term: 'EFT (Electronic Funds Transfer)',
    slug: 'eft',
    definition:
      'The method by which the government pays contractors. Banking information for EFT must be provided during SAM.gov registration. All federal contract payments are made electronically.',
    mindyUse:
      "Mindy doesn't touch your EFT info — that lives in SAM.gov. But Mindy will remind you when your SAM.gov registration is approaching its annual renewal so EFT details don't lapse.",
    related: ['sam-gov', 'uei'],
  },
  {
    term: 'FAR (Federal Acquisition Regulation)',
    slug: 'far',
    definition:
      'The primary set of rules governing how the federal government purchases goods and services. The FAR covers everything from competition requirements and contract types to payment terms and dispute resolution. Available at acquisition.gov.',
    mindyUse:
      'Mindy explains the FAR clause behind each opportunity in plain English so you can answer "why is this a set-aside?" without reading 50 pages.',
    related: ['rule-of-two', 'dcaa', 'far-part-12', 'set-aside'],
  },
  {
    term: 'Full and Open Competition',
    slug: 'full-and-open',
    definition:
      'A procurement where any responsible business — large or small — can submit a proposal. This is the default method for federal acquisitions above the simplified acquisition threshold, unless a set-aside or exception applies.',
    mindyUse:
      'Mindy tags every opportunity as set-aside or full-and-open so you can filter out the work that requires going head-to-head with billion-dollar primes.',
    related: ['set-aside', 'rule-of-two', 'simplified-acquisition-threshold'],
  },
  {
    term: 'GSA Schedule',
    slug: 'gsa-schedule',
    definition:
      'A long-term, government-wide contract with pre-negotiated pricing administered by the General Services Administration. Also called MAS (Multiple Award Schedule). Gives agencies a streamlined way to buy from pre-approved vendors.',
    mindyUse:
      'Mindy surfaces GSA-eligible task orders separately from open-market RFPs so Schedule holders can see the work that only they can win.',
    related: ['gwac', 'idiq', 'iff', 'sin'],
  },
  {
    term: 'GWAC',
    slug: 'gwac',
    definition:
      'Government-Wide Acquisition Contract — a pre-competed contract vehicle available to multiple federal agencies, typically for IT services. Examples include Alliant 2 and 8(a) STARS III.',
    mindyUse:
      'Mindy tracks GWAC task orders alongside open SAM.gov opportunities so vehicle holders see every order their contract qualifies for.',
    related: ['gsa-schedule', 'idiq', 'idv', 'task-order'],
  },
  {
    term: 'HUBZone',
    slug: 'hubzone',
    definition:
      'Historically Underutilized Business Zone — an SBA program for businesses with principal offices and 35%+ employees in designated economically distressed areas. Benefits include set-asides, sole-source contracts, and a 10% price evaluation preference.',
    mindyUse:
      'Mindy filters HUBZone set-asides into your daily briefing and flags the 10% price preference on Best Value evaluations.',
    related: ['set-aside', 'sba', 'sole-source', '8a-program'],
  },
  {
    term: 'IDIQ',
    slug: 'idiq',
    definition:
      'Indefinite Delivery/Indefinite Quantity — a contract type that provides for an indefinite quantity of services or supplies during a fixed period. Work is ordered through individual task orders or delivery orders, each competed among IDIQ holders.',
    mindyUse:
      "Mindy tracks both IDIQ awards (your shot at getting on the vehicle) and downstream task orders (your shot at winning real work), so you don't miss either layer.",
    related: ['idv', 'gwac', 'task-order', 'gsa-schedule'],
  },
  {
    term: 'IDV (Indefinite Delivery Vehicle)',
    slug: 'idv',
    definition:
      'A contract that allows the government to acquire supplies or services by issuing individual orders. Includes IDIQ contracts, requirements contracts, definite-quantity contracts, and GSA Schedules.',
    mindyUse:
      'Mindy maps every task order back to its parent IDV so you can spot which vehicles are actually generating work in your NAICS codes.',
    related: ['idiq', 'gwac', 'gsa-schedule', 'task-order'],
  },
  {
    term: 'IFF (Industrial Funding Fee)',
    slug: 'iff',
    definition:
      "A fee paid by GSA Schedule holders on their schedule sales, currently 0.75%. This fee funds GSA's Federal Acquisition Service operations. Paid quarterly based on reported sales.",
    mindyUse:
      "Mindy doesn't process IFF payments — that lives in your GSA Schedule reporting. But Mindy tracks your Schedule task orders so you have a sales reconciliation reference.",
    related: ['gsa-schedule', 'sin'],
  },
  {
    term: 'LPTA',
    slug: 'lpta',
    definition:
      'Lowest Price Technically Acceptable — an evaluation method where the government awards to the lowest-priced proposal that meets all technical requirements. Price is the deciding factor once technical acceptability is established.',
    mindyUse:
      'Mindy flags LPTA opportunities in red so you can skip them if your pricing model depends on Best Value differentiation.',
    related: ['best-value', 'rfp', 'firm-fixed-price'],
  },
  {
    term: 'Mentor-Protege Program',
    slug: 'mentor-protege',
    definition:
      'SBA program that pairs experienced government contractors (mentors) with small businesses (proteges). Enables joint ventures on contracts, with the mentor providing business development, technical, and financial assistance.',
    mindyUse:
      "Mindy's contractor database makes it easier to identify potential mentors winning the work you want — so cold outreach starts with real data.",
    related: ['8a-program', 'teaming-agreement', 'prime-contract', 'sba'],
  },
  {
    term: 'Micro-Purchase Threshold',
    slug: 'micro-purchase',
    definition:
      'The dollar amount below which the government can make purchases without formal solicitation procedures — currently $10,000 for most agencies. Government purchase card (credit card) transactions typically fall under this threshold.',
    mindyUse:
      "Micro-purchases rarely show up in SAM.gov. Mindy focuses your briefing on the threshold-and-above work where the real federal pipeline lives.",
    related: ['simplified-acquisition-threshold', 'bpa'],
  },
  {
    term: 'NAICS Code',
    slug: 'naics-code',
    definition:
      'North American Industry Classification System code — a six-digit code that classifies every type of business activity. Used to categorize solicitations and determine small business size standards. Each NAICS code has a specific revenue or employee count threshold.',
    mindyUse:
      'NAICS codes are how Mindy decides which opportunities land in your inbox. Add more codes, see more matches — Pro unlocks unlimited codes per account.',
    related: ['psc', 'set-aside', 'sam-gov'],
    productLink: {
      label: 'Tune your NAICS codes',
      href: '/onboarding',
    },
  },
  {
    term: 'NCAGE Code',
    slug: 'ncage-code',
    definition:
      "NATO Commercial and Government Entity code — the international equivalent of a CAGE code, assigned to non-U.S. entities through their country's national codification bureau. Required before foreign entities can register on SAM.gov.",
    mindyUse:
      "Mindy supports international contractors. If your registration uses an NCAGE instead of a CAGE, briefings still land — the matching logic doesn't care which one you carry.",
    related: ['cage-code', 'sam-gov', 'uei'],
  },
  {
    term: 'OSDBU',
    slug: 'osdbu',
    definition:
      'Office of Small and Disadvantaged Business Utilization — every major federal agency has one. OSDBUs help small businesses connect with procurement opportunities and advocate for small business participation within their agency.',
    mindyUse:
      "Mindy's agency profiles include the OSDBU contact and event calendar so you know where to plug in for relationships, not just opportunities.",
    related: ['sba', 'set-aside', 'capability-statement'],
  },
  {
    term: 'Past Performance',
    slug: 'past-performance',
    definition:
      "A contractor's track record of delivering quality work on previous contracts. Evaluated as part of most federal proposals. Includes relevance, quality, schedule adherence, and customer satisfaction. Documented in CPARS for federal contracts.",
    mindyUse:
      "Mindy stores your past-performance profiles in one place so the right references attach to the right pursuit — no scrambling the week before submission.",
    related: ['cpars', 'ppq', 'rfp', 'debriefing'],
  },
  {
    term: 'PPQ (Past Performance Questionnaire)',
    slug: 'ppq',
    definition:
      'A form sent to your references during proposal evaluation asking them to rate your performance on previous contracts. The government uses PPQ responses to assess the risk of awarding you a new contract.',
    mindyUse:
      "Mindy's pursuit briefs flag when an RFP requires PPQs so you can warn references early — chasing signatures the day before submission is how good proposals die.",
    related: ['past-performance', 'cpars', 'rfp'],
  },
  {
    term: 'Prime Contract',
    slug: 'prime-contract',
    definition:
      'A contract awarded directly by a government agency to a business. The prime contractor is responsible for overall contract performance and may use subcontractors to perform portions of the work.',
    mindyUse:
      'Mindy shows both prime and subcontracting paths on every opportunity so you can decide whether to lead or team up before the solicitation closes.',
    related: ['teaming-agreement', 'subcontracting-plan', 'mentor-protege'],
  },
  {
    term: 'PSC (Product Service Code)',
    slug: 'psc',
    definition:
      'A four-character code used by the government to categorize the type of product or service being purchased. Similar to NAICS codes but used specifically for federal procurement classification.',
    mindyUse:
      'Mindy matches opportunities by both NAICS and PSC, so you catch work that uses the right product code even if the NAICS feels off.',
    related: ['naics-code', 'sam-gov'],
  },
  {
    term: 'RFI (Request for Information)',
    slug: 'rfi',
    definition:
      'A pre-solicitation document where an agency asks industry for information to help plan a future procurement. Not a solicitation — no contract will be awarded from an RFI. Responding demonstrates interest and helps shape the eventual requirement.',
    mindyUse:
      "Mindy surfaces RFIs and Sources Sought separately from RFPs because the strategy is different — RFIs are about shaping the requirement, not pricing it.",
    related: ['sources-sought', 'rfp', 'rfq'],
  },
  {
    term: 'RFP (Request for Proposal)',
    slug: 'rfp',
    definition:
      'A formal solicitation asking contractors to submit detailed proposals including technical approach, management plan, past performance, and pricing. Evaluated based on stated criteria in the solicitation.',
    mindyUse:
      'Mindy parses each RFP into a structured opportunity card — agency, due date, set-aside, incumbent, NAICS, attachments — so you can triage in under a minute.',
    related: ['rfq', 'rfi', 'sources-sought', 'compliance-matrix'],
  },
  {
    term: 'RFQ (Request for Quote)',
    slug: 'rfq',
    definition:
      'A solicitation asking contractors to submit price quotes for specific goods or services. Typically used for simplified acquisitions or orders under existing contract vehicles like GSA Schedules.',
    mindyUse:
      "RFQs move fast. Mindy's same-day alerts mean you see them when they post — not on Friday when the response window has already closed.",
    related: ['rfp', 'gsa-schedule', 'simplified-acquisition-threshold'],
  },
  {
    term: 'Rule of Two',
    slug: 'rule-of-two',
    definition:
      'The FAR requirement that a contracting officer must set aside a procurement for small businesses if there is a reasonable expectation that at least two qualified small businesses will submit competitive offers at fair market prices.',
    mindyUse:
      "When Mindy spots an RFI or Sources Sought, she nudges you to respond — your response is what proves the Rule of Two and triggers a set-aside.",
    related: ['set-aside', 'sources-sought', 'rfi', 'far'],
  },
  {
    term: 'SAM.gov',
    slug: 'sam-gov',
    definition:
      'System for Award Management — the official U.S. government website for entity registration, contract opportunities, contract data, and wage determinations. Registration is free and mandatory for any business seeking federal contracts.',
    mindyUse:
      "Mindy reads SAM.gov for you and adds the intelligence layer it lacks — incumbents, recompete timing, fit scoring, personalization. You still submit through SAM.gov.",
    related: ['cage-code', 'uei', 'naics-code', 'eft'],
    productLink: {
      label: 'See how Mindy beats SAM.gov alerts',
      href: '/compare/sam-gov',
    },
  },
  {
    term: 'SBA',
    slug: 'sba',
    definition:
      'Small Business Administration — the federal agency that supports small businesses through programs including 8(a), SDVOSB, HUBZone, and WOSB certifications, lending programs, counseling, and advocacy.',
    mindyUse:
      'Mindy maps every SBA certification to the set-asides it unlocks, so the program names on your profile drive what shows up in your briefing.',
    related: ['8a-program', 'sdvosb', 'hubzone', 'wosb', 'edwosb'],
  },
  {
    term: 'SDVOSB',
    slug: 'sdvosb',
    definition:
      'Service-Disabled Veteran-Owned Small Business — an SBA certification for businesses 51%+ owned and controlled by veterans with service-connected disabilities. Provides access to set-asides, sole-source contracts, and VA Veterans First priority.',
    mindyUse:
      "Mindy surfaces SDVOSB set-asides agency-wide plus VA Veterans First opportunities in a dedicated stream so you don't miss work your certification was built for.",
    related: ['vosb', 'set-aside', 'sole-source', 'sba'],
  },
  {
    term: 'Set-Aside',
    slug: 'set-aside',
    definition:
      'A procurement restricted to specific categories of small businesses. Types include small business set-asides, 8(a), SDVOSB, HUBZone, and WOSB set-asides. Large businesses are excluded from competing on set-aside contracts.',
    mindyUse:
      "Set-asides are the single highest-leverage filter in federal contracting. Mindy applies your certifications to every opportunity so you only see work you're eligible to win.",
    related: ['8a-program', 'sdvosb', 'hubzone', 'wosb', 'rule-of-two'],
  },
  {
    term: 'Simplified Acquisition Threshold',
    slug: 'simplified-acquisition-threshold',
    definition:
      'The dollar amount below which agencies can use streamlined purchasing procedures — currently $250,000. Procurements below this threshold have less paperwork, faster timelines, and are generally reserved for small businesses.',
    mindyUse:
      'Mindy lets you filter by contract size so you can focus on sub-SAT work (fast, low-overhead) or above-SAT work (bigger, longer cycles) — your call.',
    related: ['micro-purchase', 'rfq', 'set-aside'],
  },
  {
    term: 'SIN (Special Item Number)',
    slug: 'sin',
    definition:
      'A category code within the GSA Multiple Award Schedule that identifies specific products or services. Contractors must be approved under the relevant SIN(s) to offer those items through their GSA Schedule.',
    mindyUse:
      'Mindy tracks the SINs on your GSA Schedule and only shows task orders that match — no wading through orders you can never quote on.',
    related: ['gsa-schedule', 'iff'],
  },
  {
    term: 'Sole-Source Contract',
    slug: 'sole-source',
    definition:
      "A contract awarded to a single contractor without competition. Available to certified 8(a), SDVOSB, HUBZone, and WOSB businesses up to $4.5M for services and $8M for manufacturing, at the contracting officer's discretion.",
    mindyUse:
      "Sole-source awards never appear as competitive solicitations — but Mindy tracks them in USASpending so you can spot which agencies actually use the authority and which don't.",
    related: ['8a-program', 'sdvosb', 'hubzone', 'wosb', 'justification-and-approval'],
  },
  {
    term: 'Sources Sought',
    slug: 'sources-sought',
    definition:
      'A pre-solicitation notice where an agency asks industry to express interest and capability for a planned procurement. Used to determine whether a set-aside is appropriate (Rule of Two). Responding is critical for shaping set-aside decisions.',
    mindyUse:
      'Mindy surfaces Sources Sought in your daily briefing because responding to two of them is worth more than responding to ten RFPs — you shape the requirement before it locks.',
    related: ['rfi', 'rule-of-two', 'set-aside', 'rfp'],
  },
  {
    term: 'Subcontracting Plan',
    slug: 'subcontracting-plan',
    definition:
      'A plan required of large business prime contractors on contracts over $750,000 detailing how they will use small business subcontractors. Creates a pipeline of subcontracting opportunities for small businesses.',
    mindyUse:
      "Mindy's contractor database shows which large primes have active subcontracting plans in your NAICS — your shortlist for teaming outreach.",
    related: ['teaming-agreement', 'prime-contract', 'mentor-protege'],
  },
  {
    term: 'Task Order',
    slug: 'task-order',
    definition:
      'An individual order for services issued under an IDIQ or other indefinite delivery contract. Task orders define specific work requirements, period of performance, and funding for a portion of the overall contract.',
    mindyUse:
      'Mindy tracks task orders against the parent IDIQ/GWAC so you can see which vehicles are actually moving money in your space — not just which ones exist on paper.',
    related: ['idiq', 'idv', 'gwac', 'gsa-schedule'],
  },
  {
    term: 'Teaming Agreement',
    slug: 'teaming-agreement',
    definition:
      'A formal agreement between two or more businesses to pursue a specific contract opportunity together. Defines roles, responsibilities, and work share. Can be structured as prime/subcontractor or joint venture.',
    mindyUse:
      "When Mindy flags an opportunity too big for you to prime alone, the contractor database is one click away for sourcing the teaming partner who's already winning in that NAICS.",
    related: ['prime-contract', 'subcontracting-plan', 'mentor-protege'],
  },
  {
    term: 'UEI (Unique Entity Identifier)',
    slug: 'uei',
    definition:
      'A 12-character alphanumeric identifier that replaced the DUNS number in April 2022 as the primary entity identifier for federal contracting. Generated automatically during SAM.gov registration.',
    mindyUse:
      'Mindy uses your UEI to pull your SAM.gov profile, past awards from USASpending, and contractor lookups — one ID powers the whole intelligence layer.',
    related: ['cage-code', 'sam-gov', 'ncage-code'],
  },
  {
    term: 'VOSB',
    slug: 'vosb',
    definition:
      'Veteran-Owned Small Business — an SBA certification for businesses 51%+ owned and controlled by veterans. Provides access to VA Veterans First contracting priority. Distinct from SDVOSB, which requires a service-connected disability.',
    mindyUse:
      'Mindy treats VOSB and SDVOSB as separate filters because the eligible opportunity set is different — your briefing reflects exactly what your certification unlocks.',
    related: ['sdvosb', 'sba', 'set-aside'],
  },
  {
    term: 'WOSB',
    slug: 'wosb',
    definition:
      'Women-Owned Small Business — an SBA certification for businesses 51%+ owned and controlled by women who are U.S. citizens. Provides access to set-aside contracts in designated NAICS codes where women-owned businesses are underrepresented.',
    mindyUse:
      'Mindy maps WOSB eligibility to the specific NAICS codes where the set-aside applies, so you only see WOSB-eligible work in those industries.',
    related: ['edwosb', 'sba', 'set-aside'],
  },
  {
    term: 'BPA (Blanket Purchase Agreement)',
    slug: 'bpa',
    definition:
      'A simplified acquisition method that establishes "charge accounts" with qualified vendors. Allows agencies to make recurring purchases without issuing new solicitations for each transaction. Often used for supplies or repetitive services under the micro-purchase threshold.',
    mindyUse:
      "Mindy tracks BPA call orders so vendors on existing BPAs see the recurring work — most of which never gets a fresh SAM.gov posting.",
    related: ['micro-purchase', 'simplified-acquisition-threshold', 'idiq'],
  },
  {
    term: 'Capture Manager',
    slug: 'capture-manager',
    definition:
      'The business development professional responsible for leading the pursuit of a specific contract opportunity. Develops win strategy, builds customer relationships, shapes the opportunity, and assembles the proposal team. Typically earns $150K-$220K.',
    mindyUse:
      "Mindy is the $150K capture manager you can't afford — she does the searching, incumbent research, and recompete tracking so your time goes to relationships and proposals.",
    related: ['proposal-manager', 'bid-no-bid', 'past-performance'],
  },
  {
    term: 'Proposal Manager',
    slug: 'proposal-manager',
    definition:
      'The professional responsible for managing the proposal development process from RFP release to submission. Creates the proposal schedule, assigns writers, ensures compliance with all requirements, and manages production. Typically earns $160K-$240K.',
    mindyUse:
      "Mindy hands the proposal manager a clean, structured opportunity card on day one — agency, due date, set-aside, requirements summary — so kickoff isn't a 4-hour scavenger hunt.",
    related: ['capture-manager', 'compliance-matrix', 'rfp'],
  },
  {
    term: 'DCAA (Defense Contract Audit Agency)',
    slug: 'dcaa',
    definition:
      'The DoD agency that audits defense contractor accounting systems, incurred costs, and pricing proposals. DCAA-compliant accounting systems are required for cost-reimbursement contracts and may be required for fixed-price contracts.',
    mindyUse:
      "Mindy flags opportunities that require DCAA-compliant accounting so you don't waste a week writing a proposal you can't legally accept the contract for.",
    related: ['cpff', 'firm-fixed-price', 'far'],
  },
  {
    term: 'T&M (Time and Materials)',
    slug: 'time-and-materials',
    definition:
      'A contract type where the government pays a fixed hourly rate for labor plus actual costs for materials. Used when the scope of work cannot be clearly defined. Riskier for the government than fixed-price, so used sparingly.',
    mindyUse:
      "Mindy identifies the contract type on every opportunity so you know upfront whether you're pricing FFP, T&M, or Cost-Plus — they're not the same proposal.",
    related: ['firm-fixed-price', 'cost-plus-fixed-fee'],
  },
  {
    term: 'FFP (Firm Fixed Price)',
    slug: 'firm-fixed-price',
    definition:
      'A contract type where the contractor agrees to perform work for a set price regardless of actual costs. The contractor bears all risk of cost overruns but keeps any savings. The most common contract type in federal procurement.',
    mindyUse:
      'Mindy flags FFP opportunities so you can sanity-check scope risk before you commit to a fixed price — and walk away when the requirement is too fuzzy to bound.',
    related: ['time-and-materials', 'cost-plus-fixed-fee', 'lpta'],
  },
  {
    term: 'CPFF (Cost Plus Fixed Fee)',
    slug: 'cost-plus-fixed-fee',
    definition:
      'A cost-reimbursement contract type where the government pays allowable incurred costs plus a negotiated fixed fee (profit). The contractor has less risk than FFP since costs are reimbursed, but must have a DCAA-compliant accounting system.',
    mindyUse:
      "Mindy tags cost-reimbursement work distinctly because it requires DCAA-compliant accounting — knowing your accounting posture filters out a lot of unwinnable pursuits.",
    related: ['firm-fixed-price', 'dcaa', 'time-and-materials'],
  },
  {
    term: 'J&A (Justification and Approval)',
    slug: 'justification-and-approval',
    definition:
      'A document required when an agency uses other than full and open competition. Explains why competition is limited (sole-source, set-aside, brand-name) and must be approved at appropriate levels based on contract value.',
    mindyUse:
      "Published J&As are a goldmine for capture intel — Mindy surfaces them so you can see exactly how an agency justified a sole-source and where the gaps are.",
    related: ['sole-source', 'full-and-open', 'far'],
  },
  {
    term: 'POC (Point of Contact)',
    slug: 'point-of-contact',
    definition:
      'The designated person at an agency or contractor organization who handles inquiries about a specific matter. In SAM.gov profiles, contractors list government business POCs, electronic business POCs, and past performance POCs.',
    mindyUse:
      'Every Mindy opportunity card surfaces the named POC and links straight to the agency directory so you can find them on LinkedIn in one click.',
    related: ['contracting-officer', 'cor'],
  },
  {
    term: 'PWS (Performance Work Statement)',
    slug: 'pws',
    definition:
      'A document in a solicitation that describes required outcomes and performance standards rather than how the work must be done. Allows contractors flexibility in their approach while holding them accountable for results.',
    mindyUse:
      "Mindy parses PWS attachments into a structured requirements list so you don't lose a deliverable buried on page 47.",
    related: ['sow', 'compliance-matrix', 'rfp'],
  },
  {
    term: 'SOW (Statement of Work)',
    slug: 'statement-of-work',
    definition:
      'A document that describes the specific tasks, deliverables, and timelines required under a contract. More prescriptive than a PWS, telling the contractor exactly how work must be performed.',
    mindyUse:
      'Mindy extracts SOW tasks into a structured checklist so your compliance matrix is half-built before kickoff.',
    related: ['pws', 'compliance-matrix', 'rfp'],
  },
  {
    term: 'OCI (Organizational Conflict of Interest)',
    slug: 'organizational-conflict-of-interest',
    definition:
      "A situation where a contractor's other activities or relationships may give it an unfair competitive advantage or impair its objectivity. Must be disclosed and may disqualify contractors from certain opportunities.",
    mindyUse:
      "Mindy can't decide OCI for you — but the contractor database shows which agencies and primes you've already worked with, so the disclosure conversation starts with real data.",
    related: ['justification-and-approval', 'far'],
  },
  {
    term: 'Debriefing',
    slug: 'debriefing',
    definition:
      'A post-award meeting where the government explains to unsuccessful offerors why their proposal was not selected. Provides valuable feedback on evaluation scores, strengths, weaknesses, and how the winning proposal compared.',
    mindyUse:
      "Mindy flags awards in your pursuit pipeline so you can request a debrief inside the 3-day window — most contractors miss it because they don't track award dates.",
    related: ['protest', 'past-performance', 'cpars'],
  },
  {
    term: 'Protest',
    slug: 'protest',
    definition:
      'A formal challenge to a contract award decision, typically filed with the GAO (Government Accountability Office) or Court of Federal Claims. Contractors may protest if they believe the solicitation or award violated procurement law.',
    mindyUse:
      'Mindy tracks GAO protest outcomes so you can see when a re-evaluation creates a second shot at work you already proposed on.',
    related: ['debriefing', 'rfp', 'far'],
  },
  {
    term: 'Recompete',
    slug: 'recompete',
    definition:
      'The new solicitation issued when an existing contract is nearing the end of its period of performance. Typically posted 6–18 months before the incumbent contract expires. Incumbents have an advantage, but vulnerable recompetes are the single best source of winnable federal work for small businesses.',
    mindyUse:
      'Mindy tracks 24K+ active contracts and flags recompetes 12 months before the incumbent contract expires — the same head start the big contractors have always had.',
    related: ['expiring-contracts', 'past-performance', 'capture-manager'],
    productLink: {
      label: 'See expiring contracts in your NAICS',
      href: '/expiring-contracts',
    },
  },
  {
    term: 'Forecast',
    slug: 'forecast',
    definition:
      "An agency's published projection of upcoming procurements for the fiscal year. Includes estimated value, NAICS code, set-aside status, and anticipated solicitation/award dates. Forecasts are non-binding but the best window into what's coming before it posts on SAM.gov.",
    mindyUse:
      "Mindy aggregates 7,600+ federal forecasts into one unified feed so you don't have to scrape 50 agency websites — your forecast briefing reads like a single inbox.",
    related: ['rfp', 'sources-sought', 'sam-gov'],
    productLink: {
      label: 'Search 7,600+ federal forecasts',
      href: '/forecasts',
    },
  },
];

/**
 * Lookup helper — returns the term object for a slug, or undefined.
 * Used by the [slug] route to render detail pages and by related-term
 * resolution to filter out broken cross-references at build time.
 */
export function getGlossaryTerm(slug: string): GlossaryTerm | undefined {
  return glossaryTerms.find((t) => t.slug === slug);
}

/**
 * Resolve a term's related terms to full objects, dropping any slugs
 * that don't exist in the dataset (e.g. typos or stale references).
 * If a term has no `related` array, fall back to up to 4 terms that
 * share its first letter (cheap topical proximity), then pad with
 * evergreen anchors so we never render an empty sidebar.
 */
export function getRelatedTerms(term: GlossaryTerm, limit = 5): GlossaryTerm[] {
  const explicit = (term.related ?? [])
    .map((slug) => getGlossaryTerm(slug))
    .filter((t): t is GlossaryTerm => Boolean(t) && t!.slug !== term.slug);

  if (explicit.length >= limit) return explicit.slice(0, limit);

  // Fallback: same-letter neighbors (cheap topical proximity).
  const firstLetter = term.term[0].toUpperCase();
  const neighbors = glossaryTerms.filter(
    (t) =>
      t.slug !== term.slug &&
      t.term[0].toUpperCase() === firstLetter &&
      !explicit.some((e) => e.slug === t.slug),
  );

  const result = [...explicit, ...neighbors];
  if (result.length >= limit) return result.slice(0, limit);

  // Last-resort pad with evergreen anchors that map to product features.
  const evergreen = ['sam-gov', 'naics-code', 'recompete', 'forecast', 'set-aside']
    .map((slug) => getGlossaryTerm(slug))
    .filter((t): t is GlossaryTerm => Boolean(t))
    .filter(
      (t) =>
        t.slug !== term.slug &&
        !result.some((r) => r.slug === t.slug),
    );

  return [...result, ...evergreen].slice(0, limit);
}
