/**
 * Help answers (beta): how-to questions answered from a register, without spending a research run.
 *
 * Two kinds of entry:
 *   - PRODUCT: how to do something in Mindy. Every step names a place that exists in the current UI; each route is
 *     checked against src/app by help-answers.unit.test.ts, and each label was read from the component that renders it.
 *   - BASICS: GovCon fundamentals (capability statement, set-asides, 8(a), certifications, first bid, proposal).
 *     No rule, threshold or dollar figure is stated from memory. A fact appears only when it is quoted from an
 *     official source (SBA, acquisition.gov), and the answer points to that source. Thresholds are not stated at all
 *     until the rules knowledge base can supply them with a citation.
 *
 * Answers never mention a podcast, an episode, a course or a teaching corpus. No dates. Plain English.
 * The customer's question decides the entry; the saved profile never changes which entry answers.
 */
import { matchHelpIntent, type HelpIntentId } from './help-match';

export type HelpKind = 'product' | 'basics';

export interface HelpEntry {
  id: HelpIntentId;
  kind: HelpKind;
  /** Paraphrased examples of how customers ask this (fixtures, never a customer's own text). */
  triggers: string[];
  /** Short plain-English answer: one opening line, then 3 to 6 steps, then (optionally) the offer. */
  answer: string;
  /** In-app routes the answer names (each must exist under src/app). */
  routes: string[];
  /** Official sources the answer cites (basics only). */
  sources?: string[];
  /** The Mindy action or tool to offer next, where one exists. */
  offer?: { kind: 'app_action' | 'tool' | 'link'; name: string; requiresFlag?: string };
}

const SITE = 'https://getmindy.ai';
const link = (label: string, path: string) => `[${label}](${SITE}${path})`;

const steps = (lines: string[]) => lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

export const HELP_ENTRIES: Record<HelpIntentId, HelpEntry> = {} as Record<HelpIntentId, HelpEntry>;

function add(e: HelpEntry) { HELP_ENTRIES[e.id] = e; }

// ── BASICS ───────────────────────────────────────────────────────────────────────────────────────────────────────

add({
  id: 'write_capability_statement',
  kind: 'basics',
  triggers: [
    'how do I write a capability statement', 'what should my capability statement include', 'I need a capability statement',
    'do you have a capability statement template', 'can you help me create a cap statement',
  ],
  routes: ['/app'],
  // Draft from what Mindy already has: the company profile, the SAM.gov registration (lookup_sam_entity: UEI, CAGE,
  // NAICS, certifications) and Vault uploads. Never ask for what can be looked up; never ask for a solicitation first.
  offer: { kind: 'tool', name: 'create_document' },
  answer: [
    'A capability statement is a one-page summary of your company that a buyer can read in a minute. It usually has five parts:',
    steps([
      '**Core competencies.** What you do, in the buyer\'s words, not a list of everything.',
      '**Past performance.** A few relevant jobs: who it was for, what you delivered, and the result.',
      '**Differentiators.** Why you instead of the next firm: a method, a credential, a track record.',
      '**Company data.** Your UEI, CAGE code, NAICS codes, any certifications you hold, and a contact.',
      '**Tailored.** Adjust the competencies and past performance for each agency you send it to.',
    ]),
    `I can draft yours now from what Mindy already has: your company profile, your SAM.gov registration (UEI, CAGE code, NAICS codes and any certifications listed there) and anything in your ${link('Vault', '/app?panel=vault&section=documents')}. You do not need a solicitation for this. Want me to draft it now?`,
  ].join('\n\n'),
});

add({
  id: 'write_proposal',
  kind: 'basics',
  triggers: ['can you help me write a proposal', 'help me draft a proposal for this bid'],
  routes: ['/opportunity-map'],
  offer: { kind: 'tool', name: 'draft_proposal' },
  answer: [
    'Yes. A proposal follows the solicitation, so I start from it:',
    steps([
      'Give me the solicitation number, or open the notice on the Map and click **Generate proposal**.',
      'I read its instructions and how offers will be judged, and lay out what each section must answer.',
      'I draft each section from the solicitation and anything you have in your Vault, so it reflects your real experience.',
      'You review, edit and decide what gets submitted.',
    ]),
    'What is the solicitation number?',
  ].join('\n\n'),
});

add({
  id: 'set_asides',
  kind: 'basics',
  triggers: ['what is a set-aside', 'how do set-asides work', 'is this a set aside'],
  routes: [],
  sources: ['https://www.sba.gov/federal-contracting/contracting-assistance-programs'],
  answer: [
    'A set-aside is a contract the government reserves for small businesses, so large firms cannot compete for it.',
    steps([
      'Some set-asides are open to any small business.',
      'Others are open only to small businesses in an SBA program: 8(a), HUBZone, Women-Owned Small Business (WOSB and EDWOSB), Veteran Small Business, and Service-Disabled Veteran-Owned Small Business.',
      'Whether you count as small depends on the NAICS code on the notice. Size standards vary by industry.',
      'Each notice says which set-aside applies, if any. Mindy shows it on the opportunity.',
    ]),
    'Source: SBA, contracting assistance programs (sba.gov/federal-contracting/contracting-assistance-programs).',
  ].join('\n\n'),
});

add({
  id: 'disadvantaged_meaning',
  kind: 'basics',
  triggers: ['what does socially and economically disadvantaged mean', 'what is an SDB', 'what is the 8(a) program'],
  routes: [],
  sources: ['https://www.sba.gov/federal-contracting/contracting-assistance-programs/8a-business-development-program', 'https://www.ecfr.gov/current/title-13/chapter-I/part-124'],
  answer: [
    '"Socially and economically disadvantaged" is the eligibility idea behind SBA\'s 8(a) Business Development program.',
    steps([
      'SBA describes 8(a) firms as at least 51% owned and controlled by U.S. citizens who are socially and economically disadvantaged.',
      'The legal definitions of social and economic disadvantage are in federal regulation, 13 CFR Part 124.',
      'Eligibility is decided by SBA on an application, not by self-description.',
      'You apply through SBA Certifications at certifications.sba.gov.',
    ]),
    'Sources: SBA, 8(a) Business Development program (sba.gov); 13 CFR Part 124 (ecfr.gov). Check the current rules there before you apply.',
  ].join('\n\n'),
});

add({
  id: 'certifications',
  kind: 'basics',
  triggers: ['how do I get veteran certified', 'how do I get a small business certification', 'how do I get certified as woman-owned'],
  routes: [],
  sources: ['https://www.sba.gov/federal-contracting/contracting-assistance-programs', 'https://certifications.sba.gov/'],
  answer: [
    'SBA runs the small business certifications (8(a), HUBZone, WOSB and EDWOSB, Veteran Small Business, and Service-Disabled Veteran-Owned Small Business). The usual path:',
    steps([
      'Register your business in SAM.gov. That gives you a Unique Entity ID (UEI).',
      'Know your NAICS codes and check that you meet the size standard for them. Size standards vary by industry.',
      'Apply for the certification through SBA Certifications at certifications.sba.gov.',
      'Keep your registration and certification current. SBA expects you to maintain compliance.',
    ]),
    'SBA notes that some set-asides are open to any small business, not only to firms in these programs.',
    'Sources: SBA, contracting assistance programs (sba.gov); SBA Certifications (certifications.sba.gov).',
  ].join('\n\n'),
});

add({
  id: 'first_bid',
  kind: 'basics',
  triggers: ['how do I go after my first government contract', 'how do I pursue an opportunity', 'how do I bid on a solicitation'],
  routes: ['/opportunity-map'],
  answer: [
    'Here is a simple path to a first bid:',
    steps([
      'Register your business in SAM.gov. That gives you your Unique Entity ID (UEI).',
      `Find work that fits. Search the ${link('Map', '/opportunity-map')} with the words you use to describe what you sell.`,
      'Open a notice and read the whole solicitation: what they are buying, the deadline, any set-aside, and how they will judge offers.',
      'Decide bid or no-bid honestly: can you do the work, meet the requirements and price it to win?',
      'Answer exactly what the instructions ask, in the format they ask for, and submit before the deadline.',
    ]),
    'Tell me what you sell and I will look for open notices that fit.',
  ].join('\n\n'),
});

/**
 * PRODUCT entries are added by addProductEntries() below. They are kept in one place so the route and label
 * verification in the tests covers all of them.
 */
addProductEntries();

function addProductEntries() {
  add({
    id: 'find_contracts',
    kind: 'product',
    triggers: ['how do I find contracts', 'how do I use the system to find work', 'where do I search for opportunities'],
    routes: ['/opportunity-map'],
    answer: [
      'Two ways to find contracts in Mindy:',
      steps([
        'Ask me here, in your own words: what you sell and, if you like, who you want to sell to and where.',
        `Or open the ${link('Map', '/opportunity-map')} and type what you sell in the search box at the top.`,
        'Use the **Open now** menu next to it to choose **Open Now**, **Coming Back** (contracts up for renewal) or **Coming Soon** (forecast buys).',
        'Narrow with **Agency**, **Industry** or **Filters** (state, NAICS, set-aside), then click **Show results**.',
        'Click a pin or a card to open the details.',
      ]),
      'What do you sell? I can start the search now.',
    ].join('\n\n'),
  });

  add({
    id: 'pull_bids_from_map',
    kind: 'product',
    triggers: ['how do I pull bids from the map', 'how do I save opportunities from the map'],
    routes: ['/opportunity-map', '/opportunity-map/favorites', '/opportunity-map/saved'],
    offer: { kind: 'app_action', name: 'map.apply_view', requiresFlag: 'ASK_MINDY_APP_ACTIONS' },
    answer: [
      'To pull bids off the Map:',
      steps([
        `Open the ${link('Map', '/opportunity-map')} and search for what you sell.`,
        'Click a pin and tap the heart (**Save to Favorites**). Hearted notices go to **Saved opportunities**.',
        'To work one, open its details and click **Start pursuit**. It goes to **My Pursuits**.',
        'To keep the whole search, click **Save search**. It goes to your **Watchlist**, which shows new matches.',
      ]),
    ].join('\n\n'),
  });

  add({
    id: 'build_shortlist',
    kind: 'product',
    triggers: ['how do I make a top 25 list', 'how do I build a shortlist of targets'],
    routes: ['/opportunity-map', '/opportunity-map/favorites'],
    answer: [
      'Mindy does not have a "top 25" button, but you can build that list quickly:',
      steps([
        'Tell me what you sell and where, and I will search and show you what fits.',
        `Or search the ${link('Map', '/opportunity-map')} yourself and open the best matches.`,
        'Tap the heart on each one you want on the list.',
        `Your hearted notices are in ${link('Saved opportunities', '/app?panel=saved')}. That is your shortlist; trim it as deadlines pass.`,
      ]),
      'What do you sell? I can pull the first candidates now.',
    ].join('\n\n'),
  });

  add({
    id: 'upload_capability_statement',
    kind: 'product',
    triggers: ['how do I upload my capability statement', 'where do I add my past performance documents'],
    routes: ['/app'],
    answer: [
      'Your documents go in your Vault:',
      steps([
        `Open ${link('My Vault, Documents', '/app?panel=vault&section=documents')}.`,
        'Click **Upload Capability Statement** and choose a PDF or Word file.',
        'Mindy reads it and shows **Review what Mindy found**. Untick anything wrong and save.',
        'Use **Upload Company Overview / Other** for other material, such as past performance.',
      ]),
      'Mindy uses what is in your Vault when it drafts documents and proposals for you.',
    ].join('\n\n'),
  });

  add({
    id: 'find_events',
    kind: 'product',
    triggers: ['how do I find agency events', 'where can I see industry days'],
    routes: ['/opportunity-map', '/app'],
    answer: [
      'Agency events (industry days, pre-bid meetings, site visits) show up next to the work they belong to:',
      steps([
        `Open a notice on the ${link('Map', '/opportunity-map')}.`,
        'If an upcoming event matches that notice, its office or its agency, the details show an **Upcoming events** section.',
        `For the offices you follow, open ${link('My Pursuits, Offices', '/app?panel=target-list')}. Each office card shows its scheduled events.`,
      ]),
    ].join('\n\n'),
  });

  add({
    id: 'connect_chatgpt',
    kind: 'product',
    triggers: ['how do I connect Mindy to ChatGPT', 'can I use Mindy inside Claude'],
    routes: ['/mcp/setup'],
    answer: [
      'You can use Mindy inside ChatGPT or Claude:',
      steps([
        `Open ${link('the connector setup page', '/mcp/setup')} and pick **ChatGPT** (or Claude).`,
        'In ChatGPT, turn on **Developer mode** first (Settings, then Security and login).',
        'Add Mindy as a custom plugin with the address shown on the setup page, and set Authentication to OAuth.',
        'Click **Sign in with Mindy**, sign in to your account, and allow permissions.',
      ]),
      'The setup page has every step in order.',
    ].join('\n\n'),
  });

  add({
    id: 'cancel_subscription',
    kind: 'product',
    triggers: ['how do I cancel my subscription', 'I want to cancel my plan', 'stop billing me', 'I want a refund'],
    routes: ['/account/cancel', '/app'],
    // One step, no retention maze (Eric, 2026-11-27). /account/cancel opens Settings, Billing (signing in first if needed).
    answer: [
      `To cancel, open ${link('getmindy.ai/account/cancel', '/account/cancel')} and click **Manage / cancel**. That opens the secure billing portal, where you can cancel or change your plan.`,
      'You can also get there from the account menu at the top right: **Manage or cancel subscription**.',
    ].join('\n\n'),
  });

  // Unsubscribe means EMAIL, not the paid plan (Agent 4, 2026-11-27). Email preferences = Settings → Alerts & matching
  // (/alerts/preferences rejects a signed-in customer without a token); every Mindy email also carries an Unsubscribe link.
  add({
    id: 'stop_emails',
    kind: 'product',
    triggers: ['unsubscribe me from these emails', 'how do I stop the alerts', 'too many emails'],
    routes: ['/app'],
    answer: `To stop or change Mindy emails, open ${link('Email preferences', '/app?panel=settings&section=alerts')}, or click the **Unsubscribe** link at the bottom of any Mindy email. This does not change your paid plan.`,
  });

  add({
    id: 'unsubscribe_either',
    kind: 'product',
    triggers: ['unsubscribe', 'unsubscribe from Mindy'],
    routes: ['/app', '/account/cancel'],
    answer: [
      `To stop Mindy emails: open ${link('Email preferences', '/app?panel=settings&section=alerts')}, or click the **Unsubscribe** link at the bottom of any Mindy email.`,
      `To cancel your paid plan: open ${link('getmindy.ai/account/cancel', '/account/cancel')} and click **Manage / cancel**.`,
    ].join('\n\n'),
  });

  // Security and data handling (Eric, 2026-11-28). ONLY claims from src/app/app/trust/page.tsx and
  // docs/SECURITY-CUSTOMER-FACING.md; connected-file wording from ACCESS_DISCLOSURE (src/lib/connected-apps/config.ts).
  // Eric: lead with what Mindy HAS. A limit is said only when the question asks about that thing, in one honest line
  // (security_soc2 / security_gov_authorization / security_cui). Contact: the trust page's own address.
  const SECURITY_CONTACT = 'Your security team can get our full security overview by emailing admin@getmindy.ai.';
  const SECURITY_SUMMARY = 'Your vault is private and enforced by the database, your data never trains AI, everything is encrypted in transit and at rest, sign-in uses two-factor email codes, and you can export or delete your data yourself.';
  add({
    id: 'security',
    kind: 'product',
    triggers: [
      'is my data safe', 'is my data secure', 'do you train AI on my data', 'who can see my files', 'I have a security questionnaire',
      'can I delete my data', 'how secure is Mindy',
    ],
    routes: ['/app/trust', '/app'],
    answer: [
      'Here is how Mindy protects what you put in it:',
      steps([
        '**Only you can see your vault.** Your company profile, past performance and uploaded documents are tied to your account, and the database itself enforces that (row-level security). Uploads sit in private storage and download only through short-lived signed links.',
        '**Your data never trains AI.** Requests that carry your vault data go only to business AI providers that contractually do not train on it, and the AI sees only your own records.',
        '**Strong sign-in and monitoring.** Data is encrypted in transit and at rest. Sign-in uses two-factor email codes, suspicious login activity triggers a real-time alert, and sensitive admin actions are written to an audit log.',
        '**SOC 2 certified infrastructure.** Mindy runs on Vercel and Supabase. Payments go through Stripe (PCI-DSS Level 1), and Mindy never stores your card details.',
        `**Export or delete it yourself.** In ${link('My Vault', '/app?panel=vault')} you can export everything as one file, or delete your vault and every uploaded file permanently.`,
      ]),
      'Files from Google Drive or OneDrive: Mindy reads only the files you pick, when you ask a question about them.',
      `More detail is on ${link('the trust page', '/app/trust')}. ${SECURITY_CONTACT}`,
    ].join('\n\n'),
  });

  add({
    id: 'security_soc2',
    kind: 'product',
    triggers: ['are you SOC 2 certified', 'do you have a SOC 2 report', 'is Mindy SOC 2 compliant'],
    routes: ['/app/trust'],
    answer: [
      'Mindy runs on SOC 2 certified infrastructure (Vercel and Supabase); Mindy itself does not hold its own SOC 2 report.',
      SECURITY_SUMMARY,
      `More detail is on ${link('the trust page', '/app/trust')}. ${SECURITY_CONTACT}`,
    ].join('\n\n'),
  });

  add({
    id: 'security_gov_authorization',
    kind: 'product',
    triggers: ['are you FedRAMP authorized', 'is Mindy CMMC compliant', 'do you have FedRAMP'],
    routes: ['/app/trust'],
    answer: [
      'Mindy is a commercial product built on SOC 2 certified infrastructure (Vercel and Supabase); it is not FedRAMP authorized and has not been assessed under CMMC. Where a contract requires it, ask us about deployment inside your own government-authorized cloud environment.',
      SECURITY_SUMMARY,
      `More detail is on ${link('the trust page', '/app/trust')}. ${SECURITY_CONTACT}`,
    ].join('\n\n'),
  });

  add({
    id: 'security_cui',
    kind: 'product',
    triggers: ['can I upload CUI', 'is Mindy approved for classified information', 'can we store controlled unclassified information'],
    routes: ['/app/trust'],
    answer: [
      'Keep classified information and Controlled Unclassified Information (CUI) out of Mindy; it is not authorized to process them. Everything else you upload stays in your private vault.',
      SECURITY_SUMMARY,
      `More detail is on ${link('the trust page', '/app/trust')}. ${SECURITY_CONTACT}`,
    ].join('\n\n'),
  });
}

/** Text appended to every help answer: this is a beta feature. */
export const HELP_BETA_NOTE = '_Help answers are in beta._';

export interface HelpAnswer { id: HelpIntentId; kind: HelpKind; text: string; offer?: HelpEntry['offer'] }

/**
 * The help answer for this question, or null when it is not a clear how-to question (the turn then runs as before).
 * `actionsEnabled`: the app action an entry offers is mentioned only when its flag is on for this account.
 */
export function helpAnswerFor(question: string, opts: { hasAttachedOpportunity?: boolean; actionsEnabled?: boolean } = {}): HelpAnswer | null {
  const id = matchHelpIntent(question, { hasAttachedOpportunity: opts.hasAttachedOpportunity });
  if (!id) return null;
  const e = HELP_ENTRIES[id];
  let text = e.answer;
  if (e.offer?.kind === 'app_action' && opts.actionsEnabled) text += '\n\nWant me to do it? Tell me what you sell and I will put that search on the Map for you.';
  const offer = e.offer?.kind === 'app_action' && !opts.actionsEnabled ? undefined : e.offer;
  return { id, kind: e.kind, text: `${text}\n\n${HELP_BETA_NOTE}`, ...(offer ? { offer } : {}) };
}

/** ASK_MINDY_HELP_ANSWERS='true' plus an allowlist ('*' for everyone). Default off. */
export function helpAnswersEnabledFor(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (env.ASK_MINDY_HELP_ANSWERS !== 'true' || !email) return false;
  const list = (env.ASK_MINDY_HELP_ANSWERS_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}
