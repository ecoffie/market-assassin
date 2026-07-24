/* eslint-disable @next/next/no-html-link-for-pages -- marketing pages use full-nav <a>; convert to next/link in the production pass. */
/**
 * /community/[segment] — the audience COMMUNITY HUBS (Veterans / University-Research / SBIR),
 * built from the approved artifacts (9c9d623d / 87165c67 / a2377109) as ONE shared template
 * parameterized by segment config. Future lanes (women-owned / 8(a) / HUBZone) are just more
 * config. Public, logged-out acquisition pages — each audience "in their own words".
 *
 * MVP: faithful to the designs with ILLUSTRATIVE figures (flagged) so the pages are live and
 * the "Find your crew" links land. Real-data wiring on the feeds/grants is the fast-follow —
 * verify every dollar figure before customer-facing publish (fact-check rule; the $28B / 3%
 * SDVOSB goal / VetCert-is-SBA / $4.5B SBIR are real programs, confirm exact current numbers).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadClient } from '@/lib/supabase/server-clients';
import { queryExpiringContracts } from '@/lib/recompete/query';
import { contractScope } from '@/lib/discover/scope';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import { formatCompanyName as fmtName } from '@/lib/format-name';
import { Medal, Award, Laptop, Satellite, TrendingUp, BarChart3, HardHat, Building2, Target, Hourglass, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Icon keys → lucide components (no emoji as UI icons; matches the app's lucide-react convention).
const ICONS: Record<string, LucideIcon> = {
  medal: Medal, award: Award, laptop: Laptop, satellite: Satellite,
  trending: TrendingUp, chart: BarChart3, hardhat: HardHat, building: Building2,
  target: Target, hourglass: Hourglass,
};
function Ico({ k, size = 16, sw = 2 }: { k: string; size?: number; sw?: number }) {
  const C = ICONS[k];
  return C ? <C size={size} strokeWidth={sw} /> : null;
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = Math.round((new Date(dateStr).getTime() - new Date().getTime()) / 864e5);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}
function trunc(s: string | null, n = 40): string {
  const t = (s || '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

type Row = { rank: string; name: string; sub?: string; value: string; move?: string; moveCls?: string };
type HubConfig = {
  title: string; theme: string; acc: string; acc2: string; ctaInk: string; crumb: string; ctaLabel: string;
  kicker: string; h1a: string; h1em: string; lead: string; ctaBtn: string;
  profile: { icon: string; title: string; sub: string; cells: Array<{ n: string; l: string }> };
  stats: Array<{ n: string; l: string; s: string }>;
  spot: { eyebrow: string; head: string; icon: string; clabel: string; name: string; who: string; story: string; nominate: string; read: string };
  feeds: Array<{ head: string; icon: string; sub: string; rows: Row[]; foot: string }>;
  cardsHead: { eyebrow: string; head: string; sub: string };
  cards: Array<{ amt?: string; h4: string; p: string; meta: string[]; go: string }>;
  mission: { clabel: string; title: string; p: string; steps: Array<{ done?: boolean; n: string; label: string }>; cta: string };
  voicesHead: string; voices: Array<{ p: string; name: string; br: string }>;
  final: { h2: string; p: string; cta: string };
};

const HUBS: Record<string, HubConfig> = {
  veterans: {
    title: 'Mindy — Veteran Hub', theme: 'gold', acc: '#ffb020', acc2: '#ffce6e', ctaInk: '#3a2a08',
    crumb: 'Community › Veteran Hub', ctaLabel: 'Join the squad →',
    kicker: 'For those who served', h1a: 'You served the mission.', h1em: 'Now go win it.',
    lead: 'The government sets aside billions every year for veteran-owned businesses — work most contractors can’t even bid on. Mindy finds your share, tracks veteran grants, and stands you up on a board with your fellow vets. Same discipline that got the job done in uniform — pointed at federal contracts.',
    ctaBtn: 'Join the squad — free →',
    profile: { icon: 'medal', title: 'Your service record', sub: 'SDVOSB · Rank: Hunter', cells: [
      { n: '$4.2B', l: 'Veteran set-asides in your NAICS' }, { n: '37', l: 'Open SDVOSB opps that fit you' },
      { n: '12', l: 'Veteran grants you qualify for' }, { n: '#9', l: 'Your rank on the vet board' } ] },
    stats: [
      { n: '$28B+', l: 'reserved for veterans / yr', s: 'SDVOSB & VOSB set-aside dollars' },
      { n: '3%+', l: 'of every federal dollar', s: 'The government-wide SDVOSB goal — money earmarked for you' },
      { n: '1 tap', l: 'to certify with the SBA', s: 'We walk you through VetCert step by step' } ],
    spot: { eyebrow: 'The Mindy Hero Award', head: 'Honoring the veterans winning the mission', icon: 'award', clabel: 'This month’s Hero',
      name: 'Tidewater Logistics Group', who: 'Marcus B. · U.S. Navy veteran · Norfolk, VA',
      story: 'Went from a first alert to a $6.4M base-logistics award in 14 months — SDVOSB set-aside, no primes in the way. His playbook is this month’s featured story for the whole Mindy community.',
      nominate: 'Nominate a veteran →', read: 'Read Marcus’s playbook' },
    feeds: [
      { head: 'Recompetes on the clock', icon: 'target', sub: 'Big contracts in veteran-heavy trades — the incumbent’s time is running out', foot: 'See all recompetes →', rows: [
        { rank: '1', name: 'Tidewater Logistics', sub: 'Dept. of Veterans Affairs', value: '$920M', move: '', moveCls: '' },
        { rank: '2', name: 'Redstone Facilities', sub: 'Dept. of the Army', value: '$410M', move: '', moveCls: '' },
        { rank: '3', name: 'Bravo Zulu IT', sub: 'DHS', value: '$210M', move: '', moveCls: '' },
        { rank: '4', name: 'Frontline Grounds', sub: 'GSA', value: '$96M', move: '', moveCls: '' } ] },
      { head: 'Veteran set-asides · up for grabs', icon: 'hourglass', sub: 'SDVOSB / VOSB opportunities open now', foot: 'Match my profile to veteran set-asides →', rows: [
        { rank: '1', name: 'Base Operations Support', sub: 'Army · Fort Liberty · SDVOSB', value: '$920M', move: '44d', moveCls: 'dn' },
        { rank: '2', name: 'Facilities Maintenance', sub: 'VA · West Palm Beach · SDVOSB', value: '$180M', move: '27d', moveCls: 'dn' },
        { rank: '3', name: 'IT Help Desk', sub: 'DHS · VOSB set-aside', value: '$74M', move: '19d', moveCls: 'dn' },
        { rank: '4', name: 'Medical Courier', sub: 'VA · Region 8 · SDVOSB', value: '$31M', move: '12d', moveCls: 'dn' } ] } ],
    cardsHead: { eyebrow: 'Money that isn’t a contract', head: 'Grants for veterans', sub: 'Non-dilutive funding built for veteran entrepreneurs — no equity, no payback. Mindy tracks what’s open and what you qualify for.' },
    cards: [
      { amt: '$50K', h4: 'Veteran Startup Grant', p: 'Seed funding for veteran-founded small businesses launching or scaling.', meta: ['Rolling', 'Any state'], go: 'Check eligibility →' },
      { amt: '$25K', h4: 'Service-Disabled Growth Fund', p: 'Working capital for SDVOSB firms taking on their first federal contract.', meta: ['Quarterly', 'SDVOSB'], go: 'Check eligibility →' },
      { amt: '$100K', h4: 'Veteran Innovation (SBIR)', p: 'R&D funding for veteran-led tech ventures — DoD & VA topics.', meta: ['Open cycles', 'SBIR/STTR'], go: 'Check eligibility →' } ],
    mission: { clabel: 'Veteran mission · 30 days', title: 'The First-Contract Mission',
      p: 'A guided 30-day mission built for vets — from certifying your SDVOSB status to submitting your first bid. Complete it and earn the First Bid badge, bonus credits, and a shot at the Hero Award.',
      steps: [{ done: true, n: '', label: 'Certify SDVOSB' }, { done: true, n: '', label: 'Set your NAICS' }, { n: '3', label: 'Save 3 set-aside pursuits' }, { n: '4', label: 'Run a market report' }, { n: '5', label: 'Submit your first bid' }], cta: 'Start the mission →' },
    voicesHead: 'Vets who are winning with Mindy',
    voices: [
      { p: '"I spent 20 years in the Army. Mindy translated all the contracting alphabet soup into something I could actually run at. First SDVOSB win in four months."', name: 'James R.', br: 'Army · Facilities · GA' },
      { p: '"The set-aside board is a cheat code. I only see work reserved for veterans — no wasting time bidding against the big primes."', name: 'Danielle P.', br: 'Air Force · IT Services · CO' },
      { p: '"Getting spotlighted for the Hero Award put my company in front of thousands of contractors. Best marketing I never paid for."', name: 'Marcus B.', br: 'Navy · Logistics · VA' } ],
    final: { h2: 'Fall in. The mission’s waiting.', p: 'Join free — see the billions set aside for veterans, claim your rank, and get on the board with your squad.', cta: 'Join the squad — free →' },
  },
  itcyber: {
    title: 'Mindy — IT & Cyber Hub', theme: 'blue', acc: '#3b82f6', acc2: '#93c5fd', ctaInk: '#08183a',
    crumb: 'Community › IT & Cyber', ctaLabel: 'Find my next contract →',
    kicker: 'For IT & cybersecurity firms', h1a: 'The government runs', h1em: 'on your code.',
    lead: 'Federal IT and cyber spending is enormous and never stops recompeting — modernization, cloud, zero-trust, help desk, managed services. Mindy tracks the task orders and recompetes in your NAICS, scopes the incumbent, and drafts the technical volume. Stop refreshing SAM.gov.',
    ctaBtn: 'Find my next contract — free →',
    profile: { icon: 'laptop', title: 'Your IT profile', sub: 'NAICS 541512 · Cleared', cells: [
      { n: '$120B+', l: 'Federal IT & cyber spend / yr' }, { n: '40%+', l: 'Of it comes up for recompete' },
      { n: '18 mo', l: 'Recompete runway we watch' }, { n: 'Zero', l: 'Time wasted refreshing SAM' } ] },
    stats: [
      { n: '$120B+', l: 'federal IT spend / yr', s: 'Software, cloud, cyber, managed services & help desk' },
      { n: '40%+', l: 'is recompetes', s: 'Incumbent-held work that comes back around — where you break in' },
      { n: '1 place', l: 'task orders + recompetes', s: 'Every vehicle and IDIQ, tracked to your codes' } ],
    spot: { eyebrow: 'Firm of the month', head: 'The small IT shop that unseated a prime', icon: 'satellite', clabel: 'This month’s spotlight',
      name: 'Cipher Systems', who: 'A 12-person cyber firm · Huntsville, AL',
      story: 'Spotted a $40M zero-trust recompete 14 months early, teamed smart, and took it off an $8B integrator. Mindy flagged the incumbent’s expiry before the RFP ever posted.',
      nominate: 'Nominate a firm →', read: 'Read the capture story' },
    feeds: [
      { head: 'IT recompetes on the clock', icon: 'target', sub: 'Big IT contracts expiring — the incumbent’s window is closing', foot: 'See all IT recompetes →', rows: [
        { rank: '1', name: 'Loading…', value: '', move: '', moveCls: '' } ] },
      { head: 'IT opps up for grabs', icon: 'hourglass', sub: 'Open IT & cyber solicitations right now', foot: 'Match my profile to IT opps →', rows: [
        { rank: '1', name: 'Loading…', value: '', move: '', moveCls: '' } ] } ],
    cardsHead: { eyebrow: 'What you’ll need', head: 'The certs that open doors', sub: 'Federal IT buyers gate work behind compliance. Mindy tracks which opportunities require what — and helps you get there.' },
    cards: [
      { h4: 'FedRAMP', p: 'The bar for selling cloud to the government. We flag the opps that require it — and the ones that don’t.', meta: ['Cloud', 'SaaS'], go: 'See FedRAMP opps →' },
      { h4: 'CMMC', p: 'Cybersecurity Maturity Model Certification — now gating DoD work. Know which bids demand which level.', meta: ['DoD', 'Cyber'], go: 'See CMMC opps →' },
      { h4: 'Set-aside IT', p: 'IT work reserved for 8(a), SDVOSB & HUBZone firms — competition the big integrators can’t touch.', meta: ['Set-aside', 'Small biz'], go: 'See set-aside IT →' } ],
    mission: { clabel: 'IT capture mission · 30 days', title: 'From cold to first submitted bid',
      p: 'A guided 30-day run: pin your NAICS and clearances, find a recompete with runway, scope the incumbent, and draft the technical volume with Mindy. Finish it and unlock bonus credits.',
      steps: [{ done: true, n: '', label: 'Set your NAICS & clearances' }, { done: true, n: '', label: 'Find a recompete' }, { n: '3', label: 'Scope the incumbent' }, { n: '4', label: 'Draft the technical volume' }, { n: '5', label: 'Submit your bid' }], cta: 'Start the mission →' },
    voicesHead: 'IT firms winning with Mindy',
    voices: [
      { p: '"We used to find out about recompetes when the RFP dropped — too late to team. Now Mindy shows me 12–18 months out. Game changer."', name: 'Priya N.', br: 'Cloud · Reston, VA' },
      { p: '"The AI draft got our technical volume 80% of the way there. We spent the saved week actually reviewing it."', name: 'Marcus T.', br: 'Cyber · San Antonio, TX' },
      { p: '"As a small SDVOSB IT shop, the set-aside filter is everything. I only see work I can actually win."', name: 'Dave K.', br: 'Managed services · FL' } ],
    final: { h2: 'The task orders are dropping. Be early.', p: 'Join free — track the IT recompetes in your codes, scope the incumbent, and draft the bid.', cta: 'Find my next contract — free →' },
  },
  professional: {
    title: 'Mindy — Professional Services Hub', theme: 'teal', acc: '#14b8a6', acc2: '#5eead4', ctaInk: '#04211d',
    crumb: 'Community › Professional Services', ctaLabel: 'Find my next contract →',
    kicker: 'For consultants & program-support firms', h1a: 'Win the work behind', h1em: 'every agency.',
    lead: 'Management consulting, program support, advisory, admin services — the biggest small-business award base in the federal market, and almost all of it recompetes. Mindy tracks your codes, scopes the incumbent, and drafts the proposal so you spend your time winning, not searching.',
    ctaBtn: 'Find my next contract — free →',
    profile: { icon: 'trending', title: 'Your services profile', sub: 'NAICS 541611', cells: [
      { n: '#1', l: 'Small-biz award base (541611)' }, { n: 'High', l: 'Share that recompetes' },
      { n: '18 mo', l: 'Recompete runway we watch' }, { n: 'All', l: 'Agencies, one feed' } ] },
    stats: [
      { n: 'Largest', l: 'small-business award base', s: 'Management consulting & program support — 541611 and friends' },
      { n: 'Recurring', l: 'contract structure', s: 'Support work recompetes on a cycle — plan your capture early' },
      { n: '1 feed', l: 'every agency', s: 'Your codes across DoD, civilian & the IC in one place' } ],
    spot: { eyebrow: 'Firm of the month', head: 'The two-person shop that scaled on recompetes', icon: 'chart', clabel: 'This month’s spotlight',
      name: 'Meridian Advisory', who: 'A boutique consultancy · Columbia, MD',
      story: 'Built a pipeline entirely from recompetes Mindy surfaced 12+ months out, teamed as a sub, then primed a $22M program-support win. No cold outreach — just showing up early and prepared.',
      nominate: 'Nominate a firm →', read: 'Read the growth story' },
    feeds: [
      { head: 'Recompetes on the clock', icon: 'target', sub: 'Big support contracts expiring — the incumbent’s time is running out', foot: 'See all recompetes →', rows: [
        { rank: '1', name: 'Loading…', value: '', move: '', moveCls: '' } ] },
      { head: 'Consulting opps open now', icon: 'hourglass', sub: 'Open professional-services solicitations', foot: 'Match my profile to opps →', rows: [
        { rank: '1', name: 'Loading…', value: '', move: '', moveCls: '' } ] } ],
    cardsHead: { eyebrow: 'The edge', head: 'Win before the RFP', sub: 'Support contracts are won in the 6–18 months before the solicitation. Mindy gives you that head start.' },
    cards: [
      { h4: 'Recompete radar', p: 'Every support contract in your codes, with its incumbent and expiry — so you can team and shape early.', meta: ['12–18 mo out'], go: 'See recompetes →' },
      { h4: 'Capability match', p: 'The opportunities your past performance actually qualifies you for — not a firehose.', meta: ['Fit-scored'], go: 'See your matches →' },
      { h4: 'Proposal drafting', p: 'AI first drafts of your technical and management volumes, grounded in your past performance.', meta: ['AI · vault'], go: 'Draft a proposal →' } ],
    mission: { clabel: 'Capture mission · 30 days', title: 'From search to submitted',
      p: 'A guided 30-day run: set your codes, find a recompete with runway, scope the incumbent, and draft the proposal with Mindy. Finish it and unlock bonus credits.',
      steps: [{ done: true, n: '', label: 'Set your NAICS' }, { done: true, n: '', label: 'Find a recompete' }, { n: '3', label: 'Scope the incumbent' }, { n: '4', label: 'Draft the proposal' }, { n: '5', label: 'Submit your bid' }], cta: 'Start the mission →' },
    voicesHead: 'Services firms winning with Mindy',
    voices: [
      { p: '"Recompete visibility is the whole game in support services. Mindy hands it to me 18 months out — I show up already teamed."', name: 'Angela R.', br: 'Program support · VA' },
      { p: '"I stopped paying $2K/mo for a bloated tool. Mindy does the part I actually used — for a fraction."', name: 'Tom H.', br: 'Consulting · DC' },
      { p: '"The fit-scored matches saved my BD time. I only chase work I can actually win."', name: 'Lena P.', br: 'Advisory · TX' } ],
    final: { h2: 'The recompetes are coming. Be ready.', p: 'Join free — track the support work in your codes, scope the incumbent, and draft the proposal.', cta: 'Find my next contract — free →' },
  },
  construction: {
    title: 'Mindy — Construction Hub', theme: 'orange', acc: '#f97316', acc2: '#fdba74', ctaInk: '#3a1e05',
    crumb: 'Community › Construction', ctaLabel: 'Find my next project →',
    kicker: 'For federal builders', h1a: 'Build for the biggest', h1em: 'client on earth.',
    lead: 'The federal government is the #1 construction buyer in America — $57B+ a year in building, renovation, and civil work. Design-build, MATOC, IDIQ, and set-asides for small builders. Mindy tracks the solicitations and recompetes in your trade, scopes the incumbent, and drafts the bid.',
    ctaBtn: 'Find my next project — free →',
    profile: { icon: 'hardhat', title: 'Your build profile', sub: 'NAICS 236220', cells: [
      { n: '$57B+', l: 'Federal construction / yr' }, { n: '#1', l: 'Federal NAICS by spend' },
      { n: 'Set-aside', l: 'Small-builder work reserved' }, { n: '18 mo', l: 'Recompete runway we watch' } ] },
    stats: [
      { n: '$57B+', l: 'federal construction / yr', s: 'The #1 NAICS in the entire federal market (236220)' },
      { n: 'Design-build', l: 'MATOC & IDIQ', s: 'Multiple-award vehicles where small builders win task orders' },
      { n: 'Set-asides', l: 'reserved for you', s: 'SDVOSB, 8(a), HUBZone & small-business construction work' } ],
    spot: { eyebrow: 'Builder of the month', head: 'The regional GC that went federal', icon: 'building', clabel: 'This month’s spotlight',
      name: 'Cornerstone Builders', who: 'A regional GC · Killeen, TX',
      story: 'Moved from commercial into federal on a MATOC, then landed a $30M VA facilities renovation. Mindy tracked the recompete and the incumbent, so they walked in already knowing the shape of the job.',
      nominate: 'Nominate a builder →', read: 'Read the story' },
    feeds: [
      { head: 'Recompetes on the clock', icon: 'target', sub: 'Big builds expiring — the incumbent’s window is closing', foot: 'See all recompetes →', rows: [
        { rank: '1', name: 'Loading…', value: '', move: '', moveCls: '' } ] },
      { head: 'Construction opps up for grabs', icon: 'hourglass', sub: 'Open federal construction solicitations', foot: 'Match my trade to opps →', rows: [
        { rank: '1', name: 'Loading…', value: '', move: '', moveCls: '' } ] } ],
    cardsHead: { eyebrow: 'How federal building works', head: 'The vehicles that carry the work', sub: 'Most federal construction flows through a few contract types. Mindy tracks all of them to your trade.' },
    cards: [
      { h4: 'Design-Build', p: 'Single award for design + construction. Big, competitive, and Mindy flags them by trade and region.', meta: ['USACE', 'NAVFAC'], go: 'See design-build →' },
      { h4: 'MATOC / IDIQ', p: 'Multiple-award vehicles that feed task orders for years. Get on one, then win the orders.', meta: ['Multi-year'], go: 'See vehicles →' },
      { h4: 'Set-aside builds', p: 'Construction reserved for SDVOSB, 8(a), and HUBZone firms — competition you can actually win.', meta: ['Small biz'], go: 'See set-aside builds →' } ],
    mission: { clabel: 'Builder mission · 30 days', title: 'From trade to first federal bid',
      p: 'A guided 30-day run: set your trade and region, find a project with runway, scope the incumbent, and draft the bid with Mindy. Finish it and unlock bonus credits.',
      steps: [{ done: true, n: '', label: 'Set your trade & region' }, { done: true, n: '', label: 'Find a project' }, { n: '3', label: 'Scope the incumbent' }, { n: '4', label: 'Draft the bid' }, { n: '5', label: 'Submit' }], cta: 'Start the mission →' },
    voicesHead: 'Builders winning with Mindy',
    voices: [
      { p: '"Federal construction felt like a black box. Mindy showed me the vehicles, the set-asides, and which recompetes were coming. First VA job inside a year."', name: 'Carlos M.', br: 'GC · TX' },
      { p: '"The recompete tracking is gold. I know when a facilities contract is ending before the RFP hits."', name: 'Sarah B.', br: 'Facilities · GA' },
      { p: '"As an 8(a) builder the set-aside filter means I don’t waste a minute on full-and-open work I’d lose."', name: 'Andre W.', br: 'SDVOSB GC · VA' } ],
    final: { h2: 'The biggest client on earth is building. Bid it.', p: 'Join free — track the construction work in your trade, scope the incumbent, and draft the bid.', cta: 'Find my next project — free →' },
  },
};

// ── Real feed loaders (per segment). Return [feedA rows, feedB rows]; an empty array for a
// feed means "keep the config fallback rows". Veterans is wired; other segments hold their
// illustrative feeds until the audience mix is finalized. ──

async function sdvosbOpps(): Promise<Row[]> {
  try {
    const sb = getReadClient();
    const { data, error } = await sb
      .from('sam_opportunities')
      .select('notice_id, title, department, response_deadline, set_aside_code')
      .in('set_aside_code', ['SDVOSBC', 'VSB', 'SDVOSB', 'VOSB'])
      .eq('active', true)
      .not('response_deadline', 'is', null)
      .order('response_deadline', { ascending: true })
      .limit(5);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r, i) => {
      const d = daysUntil(r.response_deadline as string);
      return { rank: String(i + 1), name: trunc(String(r.title ?? ''), 38), sub: String(r.department ?? ''), value: '', move: d != null ? `${d}d` : '', moveCls: 'dn' };
    });
  } catch {
    return [];
  }
}

// NAICS sets per industry hub — awards (USASpending) + open opps (sam_opportunities).
const SEGMENT_NAICS: Record<string, string[]> = {
  itcyber: ['541512', '541519', '541511', '541513', '541690'],
  professional: ['541611', '541618', '541990', '541614', '561110'],
  construction: ['236220', '236210', '237310', '238210', '238220', '238160'],
};

// The STORY feed: big contracts EXPIRING in these NAICS — who holds it now + how long left.
// Names a vulnerable incumbent + a countdown + a real opportunity (beats a static "biggest wins" list).
async function recompetesByNaics(naics: string[]): Promise<Row[]> {
  try {
    const { contracts } = await queryExpiringContracts({ naicsCodes: naics, monthsWindow: 18, minValue: 5_000_000, limit: 150, orderBy: 'value' });
    return contracts
      .map((c) => ({ c, val: Number(c.potential_total_value ?? c.total_obligation ?? 0), d: daysUntil(c.period_of_performance_current_end) }))
      .filter((x) => x.d != null && x.d >= 30 && x.d <= 540 && x.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 5)
      .map((x, i) => {
        const dd = x.d ?? 0;
        return {
          rank: String(i + 1),
          name: trunc(contractScope(x.c), 34),
          sub: x.c.incumbent_name ? `held by ${trunc(fmtName(x.c.incumbent_name), 26)}` : (x.c.awarding_agency || ''),
          value: fmtMoney(x.val),
          move: dd >= 60 ? `${Math.round(dd / 30)}mo` : `${dd}d`,
          moveCls: 'dn',
        };
      });
  } catch {
    return [];
  }
}

async function oppsByNaics(naics: string[]): Promise<Row[]> {
  try {
    const sb = getReadClient();
    const { data, error } = await sb
      .from('sam_opportunities')
      .select('notice_id, title, department, response_deadline, naics_code')
      .in('naics_code', naics)
      .eq('active', true)
      .not('response_deadline', 'is', null)
      .order('response_deadline', { ascending: true })
      .limit(5);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((r, i) => {
      const d = daysUntil(r.response_deadline as string);
      return { rank: String(i + 1), name: trunc(String(r.title ?? ''), 38), sub: String(r.department ?? ''), value: '', move: d != null ? `${d}d` : '', moveCls: 'dn' };
    });
  } catch {
    return [];
  }
}

// Veteran-heavy trades (facilities, IT, construction, janitorial, consulting, civil) — the
// markets SDVOSBs actually compete in — for the recompete story feed.
const VET_NAICS = ['561210', '541512', '236220', '561720', '541611', '237310'];

async function loadFeeds(segment: string): Promise<Row[][] | null> {
  if (segment === 'veterans') return Promise.all([recompetesByNaics(VET_NAICS), sdvosbOpps()]);
  const naics = SEGMENT_NAICS[segment];
  if (naics) return Promise.all([recompetesByNaics(naics), oppsByNaics(naics)]);
  return null;
}

export function generateStaticParams() {
  return Object.keys(HUBS).map((segment) => ({ segment }));
}

export async function generateMetadata({ params }: { params: Promise<{ segment: string }> }): Promise<Metadata> {
  const { segment } = await params;
  const cfg = HUBS[segment];
  return cfg ? { title: cfg.title } : {};
}

export default async function CommunityHub({ params }: { params: Promise<{ segment: string }> }) {
  const { segment } = await params;
  const cfg = HUBS[segment];
  if (!cfg) notFound();

  const realFeeds = await loadFeeds(segment);
  const rootStyle = { ['--acc']: cfg.acc, ['--acc2']: cfg.acc2, ['--ctaink']: cfg.ctaInk } as React.CSSProperties;

  return (
    <div className="chub" style={rootStyle}>
      <style>{CSS}</style>

      <header className="nav"><div className="wrap nav-in">
        <a className="brand" href="/"><span className="mk"><span>M</span></span> Mindy</a>
        <span className="crumb">{cfg.crumb}</span>
        <div className="nav-r"><a className="btn-login" href="/app">Log in</a><a className="btn-cta" href="/signup">{cfg.ctaLabel}</a></div>
      </div></header>

      {/* HERO */}
      <section className="hero"><div className="glow" /><div className="tex" /><div className="wrap hero-in">
        <div>
          <div className="kick"><Ico k={cfg.profile.icon} size={14} sw={2.25} /> {cfg.kicker}</div>
          <h1 className="disp">{cfg.h1a}<br /><em>{cfg.h1em}</em></h1>
          <p className="lead">{cfg.lead}</p>
          <div className="cta"><a className="btn-lg" href="/signup">{cfg.ctaBtn}</a><a className="btn-ghost2" href="#how">▶ How it works</a></div>
        </div>
        <div className="tag">
          <div className="th"><div className="badge"><Ico k={cfg.profile.icon} size={22} sw={1.75} /></div><div><div className="nm">{cfg.profile.title}</div><div className="rk">{cfg.profile.sub}</div></div></div>
          <div className="grid">
            {cfg.profile.cells.map((c) => (<div className="cell" key={c.l}><div className="n">{c.n}</div><div className="l">{c.l}</div></div>))}
          </div>
        </div>
      </div></section>

      {/* STATS */}
      <section className="sec" id="how"><div className="wrap"><div className="stats">
        {cfg.stats.map((s) => (<div className="stat" key={s.l}><div className="n num">{s.n}</div><div className="l">{s.l}</div><div className="s">{s.s}</div></div>))}
      </div></div></section>

      {/* SPOTLIGHT */}
      <section className="sec"><div className="wrap">
        <div className="head"><div className="eyebrow">{cfg.spot.eyebrow}</div><h2 className="disp">{cfg.spot.head}</h2></div>
        <div className="award">
          <div className="spot"><Ico k={cfg.spot.icon} size={40} sw={1.5} /></div>
          <div className="cnt">
            <div className="cl">{cfg.spot.clabel}</div>
            <h3 className="disp">{cfg.spot.name}</h3>
            <div className="who">{cfg.spot.who}</div>
            <p>{cfg.spot.story}</p>
            <div className="act"><a className="btn-acc" href="/signup">{cfg.spot.nominate}</a><a className="btn-accout" href="/signup">{cfg.spot.read}</a></div>
          </div>
        </div>
      </div></section>

      {/* FEEDS */}
      <section className="sec tint"><div className="wrap">
        <div className="head"><div className="eyebrow">Discover</div><h2 className="disp">What&apos;s funded right now</h2><p>Live feeds nobody else packages — the hottest areas and the open opportunities you can actually go after.</p></div>
        <div className="cols">
          {cfg.feeds.map((f, fi) => {
            const rows = realFeeds && realFeeds[fi] && realFeeds[fi].length ? realFeeds[fi] : f.rows;
            return (
            <div className="panel" key={f.head}>
              <div className="ph"><div className="t"><Ico k={f.icon} size={16} sw={2} /> {f.head}</div><span className="share">↗ Share</span></div>
              <p className="sub">{f.sub}</p>
              {rows.map((r) => (
                <div className={`row${r.rank === '1' ? ' t1' : ''}`} key={r.rank + r.name}>
                  <span className="rk num">{r.rank}</span>
                  <span className="who2"><span className="nm">{r.name}{r.sub && <small>{r.sub}</small>}</span></span>
                  <span className="vl num">{r.value}</span>
                  <span className={`mv ${r.moveCls || ''}`}>{r.move || ''}</span>
                </div>
              ))}
              <div className="foot">{f.foot}</div>
            </div>
            );
          })}
        </div>
      </div></section>

      {/* CARDS (grants / ladder) */}
      <section className="sec"><div className="wrap">
        <div className="head"><div className="eyebrow">{cfg.cardsHead.eyebrow}</div><h2 className="disp">{cfg.cardsHead.head}</h2><p>{cfg.cardsHead.sub}</p></div>
        <div className="grants">
          {cfg.cards.map((c) => (
            <div className="grant" key={c.h4}>
              {c.amt && <div className="amt num">{c.amt}</div>}
              <h4>{c.h4}</h4>
              <p>{c.p}</p>
              <div className="meta">{c.meta.map((m) => (<span key={m}>{m}</span>))}</div>
              <span className="go">{c.go}</span>
            </div>
          ))}
        </div>
      </div></section>

      {/* MISSION */}
      <section className="sec tint"><div className="wrap"><div className="mission">
        <div className="cl">{cfg.mission.clabel}</div>
        <h3 className="disp">{cfg.mission.title}</h3>
        <p>{cfg.mission.p}</p>
        <div className="steps">
          {cfg.mission.steps.map((s) => (<div className={`mstep${s.done ? ' done' : ''}`} key={s.label}><span className="n2">{s.done ? <Check size={13} strokeWidth={3} /> : s.n}</span> {s.label}</div>))}
        </div>
        <a className="btn-lg" href="/signup">{cfg.mission.cta}</a>
      </div></div></section>

      {/* VOICES */}
      <section className="sec"><div className="wrap">
        <div className="head"><div className="eyebrow">From the community</div><h2 className="disp">{cfg.voicesHead}</h2></div>
        <div className="voices">
          {cfg.voices.map((v) => (<div className="voice" key={v.name}><p>{v.p}</p><div className="who3"><span className="av" /><div><div className="nm">{v.name}</div><div className="br">{v.br}</div></div></div></div>))}
        </div>
      </div></section>

      {/* FINAL */}
      <section className="final"><div className="glow" /><div className="wrap final-in">
        <h2 className="disp">{cfg.final.h2}</h2>
        <p>{cfg.final.p}</p>
        <a className="btn-lg" href="/signup">{cfg.final.cta}</a>
      </div></section>

      <footer className="f"><div className="wrap f-in"><span>© 2026 GovCon Giants AI · Mindy</span><span>{cfg.crumb}</span></div></footer>
    </div>
  );
}

const CSS = `
.chub{--bg:#08060f;--bg2:#0e0b1a;--card:#141021;--card2:#1a1530;--line:#241d3a;--line2:#342a52;
  --ink:#f4f1ff;--ink2:#b3aacb;--mut:#7a7192;--violet:#8b5cf6;--win:#22e08a;--rose:#fb6a8a;
  --grad:linear-gradient(135deg,#8b5cf6,#a855f7 55%,#6d28d9);--gacc:linear-gradient(135deg,var(--acc2),var(--acc) 60%,var(--acc));
  --maxw:1140px;background:var(--bg);color:var(--ink);min-height:100dvh;overflow-x:hidden;
  font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.chub *{box-sizing:border-box}
.chub a{color:inherit;text-decoration:none;cursor:pointer}
.chub .wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.chub .disp{font-weight:850;letter-spacing:-.03em;text-wrap:balance}
.chub .num{font-weight:850;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.chub .eyebrow{font-size:11.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--acc2)}

.chub .nav{position:sticky;top:0;z-index:50;background:rgba(8,6,15,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.chub .nav-in{display:flex;align-items:center;gap:18px;height:62px}
.chub .brand{display:flex;align-items:center;gap:9px;font-weight:850;font-size:17px}
.chub .brand .mk{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 4px 16px rgba(139,92,246,.5)}
.chub .brand .mk span{font-weight:900;color:#fff;transform:translateY(-1px)}
.chub .crumb{font-size:13px;color:var(--mut);font-weight:600}
.chub .nav-r{margin-left:auto;display:flex;align-items:center;gap:10px}
.chub .btn-login{font-weight:700;font-size:14px;color:var(--ink2);padding:9px 12px}
.chub .btn-cta{background:var(--gacc);color:var(--ctaink);font-weight:850;font-size:14px;padding:10px 18px;border-radius:10px}
.chub .btn-cta:hover{filter:brightness(1.06)}

.chub .hero{position:relative;overflow:hidden}
.chub .hero .glow{position:absolute;inset:0;background:radial-gradient(52% 70% at 80% 0%,color-mix(in srgb,var(--acc) 30%,transparent),transparent 58%),radial-gradient(48% 60% at 6% 100%,rgba(139,92,246,.2),transparent 60%)}
.chub .hero .tex{position:absolute;inset:0;opacity:.4;background-image:linear-gradient(color-mix(in srgb,var(--acc) 6%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--acc) 5%,transparent) 1px,transparent 1px);background-size:40px 40px;mask-image:radial-gradient(60% 65% at 78% 0%,#000,transparent 72%)}
.chub .hero-in{position:relative;display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;padding:60px 0 56px}
@media(max-width:900px){.chub .hero-in{grid-template-columns:1fr;padding:44px 0}}
.chub .kick{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;color:var(--acc2);background:color-mix(in srgb,var(--acc) 12%,transparent);border:1px solid color-mix(in srgb,var(--acc) 30%,transparent);padding:6px 13px;border-radius:99px;margin-bottom:20px}
.chub .hero h1{font-size:52px;line-height:.99;margin:0 0 16px}
@media(max-width:900px){.chub .hero h1{font-size:38px}}
.chub .hero h1 em{font-style:normal;background:var(--gacc);-webkit-background-clip:text;background-clip:text;color:transparent}
.chub .hero .lead{font-size:18px;color:var(--ink2);line-height:1.5;max-width:48ch;margin:0 0 26px}
.chub .cta{display:flex;gap:13px;align-items:center;flex-wrap:wrap}
.chub .btn-lg{background:var(--gacc);color:var(--ctaink);font-weight:850;font-size:16px;padding:15px 26px;border-radius:14px;box-shadow:0 12px 34px color-mix(in srgb,var(--acc) 40%,transparent);display:inline-flex;gap:9px;align-items:center}
.chub .btn-lg:hover{filter:brightness(1.06)}
.chub .btn-ghost2{color:var(--ink);font-weight:700;font-size:15px;padding:14px 18px;border-radius:14px;border:1px solid var(--line2)}
.chub .tag{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line2);border-radius:22px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.chub .tag .th{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.chub .tag .badge{width:48px;height:48px;border-radius:12px;background:var(--gacc);display:grid;place-items:center;font-size:26px}
.chub .tag .nm{font-weight:850;font-size:16px}
.chub .tag .rk{font-size:12.5px;color:var(--acc2);font-weight:700}
.chub .tag .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.chub .tag .cell{background:var(--bg2);border:1px solid var(--line);border-radius:13px;padding:13px}
.chub .tag .cell .n{font-size:22px;font-weight:850;font-variant-numeric:tabular-nums}
.chub .tag .cell .l{font-size:11.5px;color:var(--mut);margin-top:3px}

.chub .sec{padding:60px 0}
.chub .sec.tint{background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.chub .sec .head{margin-bottom:24px}
.chub .sec .head h2{font-size:32px;margin:8px 0 8px;line-height:1.08}
@media(max-width:760px){.chub .sec .head h2{font-size:25px}}
.chub .sec .head p{font-size:15.5px;color:var(--ink2);margin:0;max-width:62ch}

.chub .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:760px){.chub .stats{grid-template-columns:1fr}}
.chub .stat{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
.chub .stat .n{font-size:42px;line-height:1;background:var(--gacc);-webkit-background-clip:text;background-clip:text;color:transparent}
.chub .stat .l{font-size:13.5px;color:var(--ink2);margin-top:8px;font-weight:600}
.chub .stat .s{font-size:12px;color:var(--mut);margin-top:2px}

.chub .award{position:relative;overflow:hidden;border-radius:22px;padding:30px;display:flex;gap:26px;align-items:center;background:radial-gradient(80% 150% at 86% 12%,color-mix(in srgb,var(--acc) 22%,transparent),transparent 52%),linear-gradient(100deg,#141127,#191a2c);border:1px solid var(--line2)}
@media(max-width:760px){.chub .award{flex-direction:column;text-align:center}}
.chub .award .spot{flex:none;width:120px;height:120px;border-radius:18px;background:radial-gradient(circle at 50% 35%,var(--card2),#12101f);border:1px solid var(--line2);display:grid;place-items:center;font-size:52px;box-shadow:0 0 40px color-mix(in srgb,var(--acc) 25%,transparent)}
.chub .award .cnt{position:relative;z-index:2}
.chub .award .cl{font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--acc2)}
.chub .award h3{font-size:24px;margin:8px 0 6px}
.chub .award .who{font-size:15px;color:#fff;font-weight:700}
.chub .award p{margin:8px 0 0;color:var(--ink2);font-size:14px;max-width:56ch;line-height:1.5}
.chub .award .act{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap}
@media(max-width:760px){.chub .award .act{justify-content:center}}
.chub .btn-acc{background:var(--gacc);color:var(--ctaink);font-weight:850;font-size:14px;padding:11px 19px;border-radius:11px}
.chub .btn-accout{color:var(--acc2);font-weight:800;font-size:14px;padding:10px 16px;border-radius:11px;border:1px solid color-mix(in srgb,var(--acc) 40%,transparent)}

.chub .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:860px){.chub .cols{grid-template-columns:1fr}}
.chub .panel{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px}
.chub .panel .ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.chub .panel .ph .t{font-weight:850;font-size:16px;display:flex;gap:9px;align-items:center}
.chub svg{vertical-align:-0.14em}
.chub .tag .badge svg{color:var(--ctaink)}
.chub .award .spot svg{color:var(--acc2)}
.chub .panel .ph .t svg{color:var(--acc2)}
.chub .panel .sub{font-size:12.5px;color:var(--mut);margin:0 0 10px}
.chub .share{font-size:11.5px;font-weight:800;color:var(--acc2);border:1px solid color-mix(in srgb,var(--acc) 35%,transparent);padding:5px 11px;border-radius:99px;background:color-mix(in srgb,var(--acc) 8%,transparent);white-space:nowrap}
.chub .row{display:grid;grid-template-columns:26px 1fr auto auto;gap:11px;align-items:center;padding:11px 0;border-top:1px solid var(--line);font-size:13.5px}
.chub .row .rk{font-weight:850;text-align:center;color:var(--mut)}
.chub .row.t1 .rk{color:var(--acc2)}
.chub .row .nm{font-weight:700}
.chub .row .nm small{display:block;color:var(--mut);font-weight:500;font-size:11.5px}
.chub .row .vl{font-weight:850;font-variant-numeric:tabular-nums;text-align:right}
.chub .row .mv{font-size:12px;font-weight:850;text-align:right;width:48px}
.chub .mv.up{color:var(--win)}.chub .mv.dn{color:var(--rose)}.chub .mv.g{color:var(--acc2)}
.chub .panel .foot{padding-top:12px;font-size:12.5px;font-weight:800;color:var(--acc2)}

.chub .grants{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:820px){.chub .grants{grid-template-columns:1fr}}
.chub .grant{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;display:flex;flex-direction:column}
.chub .grant .amt{font-size:26px;font-weight:850;color:var(--acc2);font-variant-numeric:tabular-nums}
.chub .grant h4{margin:6px 0 6px;font-size:16px}
.chub .grant p{margin:0;font-size:13px;color:var(--ink2);line-height:1.45}
.chub .grant .meta{margin-top:12px;font-size:11.5px;color:var(--mut);display:flex;gap:10px;flex-wrap:wrap}
.chub .grant .go{margin-top:auto;padding-top:14px;font-size:13px;font-weight:800;color:var(--acc2)}

.chub .mission{position:relative;overflow:hidden;border-radius:22px;border:1px solid var(--line2);padding:30px;background:radial-gradient(80% 130% at 15% 0%,rgba(139,92,246,.2),transparent 55%),radial-gradient(60% 120% at 100% 100%,color-mix(in srgb,var(--acc) 16%,transparent),transparent 55%),var(--card2)}
.chub .mission .cl{font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--acc2)}
.chub .mission h3{font-size:27px;margin:8px 0 8px}
.chub .mission p{margin:0 0 18px;color:var(--ink2);font-size:15px;max-width:60ch;line-height:1.5}
.chub .steps{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.chub .mstep{display:flex;align-items:center;gap:9px;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:600}
.chub .mstep .n2{width:22px;height:22px;border-radius:6px;background:var(--grad);display:grid;place-items:center;font-size:12px;font-weight:800;color:#fff}
.chub .mstep.done .n2{background:var(--gacc);color:var(--ctaink)}

.chub .voices{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:820px){.chub .voices{grid-template-columns:1fr}}
.chub .voice{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
.chub .voice p{margin:0 0 16px;font-size:14.5px;line-height:1.55;color:var(--ink)}
.chub .voice .who3{display:flex;align-items:center;gap:11px}
.chub .voice .av{width:36px;height:36px;border-radius:50%;background:conic-gradient(from 210deg,var(--acc2),var(--acc),#a855f7)}
.chub .voice .nm{font-weight:800;font-size:13.5px}
.chub .voice .br{font-size:12px;color:var(--mut)}

.chub .final{position:relative;overflow:hidden;text-align:center}
.chub .final .glow{position:absolute;inset:0;background:radial-gradient(60% 130% at 50% 0%,color-mix(in srgb,var(--acc) 28%,transparent),transparent 60%)}
.chub .final-in{position:relative;padding:72px 0}
.chub .final h2{font-size:40px;margin:0 0 12px;line-height:1.05}
@media(max-width:760px){.chub .final h2{font-size:29px}}
.chub .final p{font-size:17px;color:var(--ink2);margin:0 auto 24px;max-width:50ch}
.chub .f{border-top:1px solid var(--line);padding:26px 0;color:var(--mut);font-size:12.5px}
.chub .f-in{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
`;
