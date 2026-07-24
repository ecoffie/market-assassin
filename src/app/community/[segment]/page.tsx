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

type Row = { rank: string; name: string; sub?: string; value: string; move?: string; moveCls?: string };
type HubConfig = {
  title: string; theme: string; acc: string; acc2: string; ctaInk: string; crumb: string; ctaLabel: string;
  kicker: string; h1a: string; h1em: string; lead: string; ctaBtn: string;
  profile: { emoji: string; title: string; sub: string; cells: Array<{ n: string; l: string }> };
  stats: Array<{ n: string; l: string; s: string }>;
  spot: { eyebrow: string; head: string; emoji: string; clabel: string; name: string; who: string; story: string; nominate: string; read: string };
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
    kicker: '🎖️ For those who served', h1a: 'You served the mission.', h1em: 'Now go win it.',
    lead: 'The government sets aside billions every year for veteran-owned businesses — work most contractors can’t even bid on. Mindy finds your share, tracks veteran grants, and stands you up on a board with your fellow vets. Same discipline that got the job done in uniform — pointed at federal contracts.',
    ctaBtn: 'Join the squad — free →',
    profile: { emoji: '🎖️', title: 'Your service record', sub: 'SDVOSB · Rank: Hunter', cells: [
      { n: '$4.2B', l: 'Veteran set-asides in your NAICS' }, { n: '37', l: 'Open SDVOSB opps that fit you' },
      { n: '12', l: 'Veteran grants you qualify for' }, { n: '#9', l: 'Your rank on the vet board' } ] },
    stats: [
      { n: '$28B+', l: 'reserved for veterans / yr', s: 'SDVOSB & VOSB set-aside dollars' },
      { n: '3%+', l: 'of every federal dollar', s: 'The government-wide SDVOSB goal — money earmarked for you' },
      { n: '1 tap', l: 'to certify with the SBA', s: 'We walk you through VetCert step by step' } ],
    spot: { eyebrow: 'The Mindy Hero Award', head: 'Honoring the veterans winning the mission', emoji: '🏅', clabel: 'This month’s Hero',
      name: 'Tidewater Logistics Group', who: 'Marcus B. · U.S. Navy veteran · Norfolk, VA',
      story: 'Went from a first alert to a $6.4M base-logistics award in 14 months — SDVOSB set-aside, no primes in the way. His playbook is this month’s featured story for the whole Mindy community.',
      nominate: 'Nominate a veteran →', read: 'Read Marcus’s playbook' },
    feeds: [
      { head: 'Veteran leaderboard', icon: '🎖️', sub: 'Resets Monday · SDVOSB & VOSB firms', foot: 'See the full veteran board →', rows: [
        { rank: '1', name: 'Tidewater Logistics', sub: 'Navy · Norfolk, VA', value: '4,820', move: '🏅', moveCls: 'g' },
        { rank: '2', name: 'Redstone Facilities', sub: 'Army · Huntsville, AL', value: '4,310', move: '▲2', moveCls: 'up' },
        { rank: '3', name: 'Bravo Zulu IT', sub: 'Marines · San Diego, CA', value: '3,975', move: '▲1', moveCls: 'up' },
        { rank: '4', name: 'Frontline Grounds', sub: 'Army · Killeen, TX', value: '3,120', move: '▼1', moveCls: 'dn' },
        { rank: '9', name: 'You', sub: 'Hunter · climbing', value: '1,240', move: '▲3', moveCls: 'up' } ] },
      { head: 'Veteran set-asides · up for grabs', icon: '⏳', sub: 'SDVOSB / VOSB opportunities open now', foot: 'Match my profile to veteran set-asides →', rows: [
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
      steps: [{ done: true, n: '✓', label: 'Certify SDVOSB' }, { done: true, n: '✓', label: 'Set your NAICS' }, { n: '3', label: 'Save 3 set-aside pursuits' }, { n: '4', label: 'Run a market report' }, { n: '5', label: 'Submit your first bid' }], cta: 'Start the mission →' },
    voicesHead: 'Vets who are winning with Mindy',
    voices: [
      { p: '"I spent 20 years in the Army. Mindy translated all the contracting alphabet soup into something I could actually run at. First SDVOSB win in four months."', name: 'James R.', br: 'Army · Facilities · GA' },
      { p: '"The set-aside board is a cheat code. I only see work reserved for veterans — no wasting time bidding against the big primes."', name: 'Danielle P.', br: 'Air Force · IT Services · CO' },
      { p: '"Getting spotlighted for the Hero Award put my company in front of thousands of contractors. Best marketing I never paid for."', name: 'Marcus B.', br: 'Navy · Logistics · VA' } ],
    final: { h2: 'Fall in. The mission’s waiting.', p: 'Join free — see the billions set aside for veterans, claim your rank, and get on the board with your squad.', cta: 'Join the squad — free →' },
  },
  research: {
    title: 'Mindy — University & Research Hub', theme: 'blue', acc: '#4f8ef7', acc2: '#8fb8ff', ctaInk: '#0a1a33',
    crumb: 'Community › University & Research', ctaLabel: 'Fund my research →',
    kicker: '🎓 For researchers & universities', h1a: 'Turn your research into', h1em: 'federal funding.',
    lead: 'The government pours billions into university R&D every year — SBIR/STTR awards, research contracts, and grants. Mindy translates the alphabet soup, matches it to your field, and helps you fund the work without giving up equity.',
    ctaBtn: 'Find my funding — free →',
    profile: { emoji: '🎓', title: 'Your research profile', sub: 'Field: Biomedical Engineering', cells: [
      { n: '$3.9B', l: 'SBIR/STTR in your field' }, { n: '24', l: 'Open topics that match' },
      { n: '11', l: 'Agencies funding your area' }, { n: '$0', l: 'Equity given up' } ] },
    stats: [
      { n: '$4.5B+', l: 'in SBIR/STTR each year', s: 'Non-dilutive R&D funding for small biz & university partners' },
      { n: '11', l: 'federal agencies fund it', s: 'DoD, NIH, NSF, DOE, NASA & more — each with its own topics' },
      { n: '3 phases', l: 'idea → prototype → scale', s: 'Phase I feasibility, Phase II development, Phase III commercialization' } ],
    spot: { eyebrow: 'Funded Founder of the month', head: 'From the lab to a federal award', emoji: '🔬', clabel: 'This month’s spotlight',
      name: 'Helix Neuro Labs', who: 'Dr. Priya S. · PI, State University spinout',
      story: 'Turned a grad-school prototype into a $1.7M NIH SBIR Phase II — no VC, no dilution. Mindy matched her thesis to the right topic and tracked the deadline. Her path is this month’s featured story.',
      nominate: 'Nominate a researcher →', read: 'Read Priya’s path' },
    feeds: [
      { head: 'Hottest SBIR topics', icon: '🔥', sub: 'By funding, this cycle · ▲▼ vs last', foot: 'See all funded topics →', rows: [
        { rank: '1', name: 'AI / Autonomy', sub: 'DoD · multiple topics', value: '$1.2B', move: '▲2', moveCls: 'up' },
        { rank: '2', name: 'Biotech & Health', sub: 'NIH · HHS', value: '$940M', move: '▼1', moveCls: 'dn' },
        { rank: '3', name: 'Clean Energy', sub: 'DOE', value: '$610M', move: '▲3', moveCls: 'up' },
        { rank: '4', name: 'Space & Sensors', sub: 'NASA · Space Force', value: '$480M', move: 'NEW', moveCls: 'g' } ] },
      { head: 'Open topics · closing soon', icon: '⏳', sub: 'Apply before the window shuts', foot: 'Match my research to open topics →', rows: [
        { rank: '1', name: 'Wearable Neuro Sensors', sub: 'NIH · Phase I', value: '$314K', move: '21d', moveCls: 'dn' },
        { rank: '2', name: 'Autonomous ISR', sub: 'Air Force · Phase II', value: '$1.7M', move: '33d', moveCls: 'dn' },
        { rank: '3', name: 'Grid Resilience AI', sub: 'DOE · Phase I', value: '$200K', move: '40d', moveCls: 'dn' },
        { rank: '4', name: 'Advanced Materials', sub: 'NSF · STTR', value: '$275K', move: '54d', moveCls: 'dn' } ] } ],
    cardsHead: { eyebrow: 'Beyond SBIR', head: 'Research grants & contracts', sub: 'Federal money that funds university work — grants that don’t need to be paid back and research contracts you can actually staff.' },
    cards: [
      { amt: '$500K', h4: 'NSF Research Grant', p: 'Basic & applied research across science and engineering fields.', meta: ['Rolling', 'Universities'], go: 'Check eligibility →' },
      { amt: '$2M', h4: 'NIH R01', p: 'Multi-year health research funding for established PIs and labs.', meta: ['3 cycles/yr', 'Biomedical'], go: 'Check eligibility →' },
      { amt: '$1M+', h4: 'DoD Research Contract', p: 'University-affiliated research the military funds directly — "contracts for people in University."', meta: ['Open BAAs', 'All fields'], go: 'Check eligibility →' } ],
    mission: { clabel: 'Research mission · 30 days', title: 'Idea to Phase I',
      p: 'A guided mission from research idea to a submitted SBIR/STTR proposal — Mindy matches your topic, tracks the deadline, and preps the pieces. Finish it to earn the First Submission badge + bonus credits.',
      steps: [{ done: true, n: '✓', label: 'Set your research field' }, { done: true, n: '✓', label: 'Match to a topic' }, { n: '3', label: 'Confirm eligibility' }, { n: '4', label: 'Draft the proposal' }, { n: '5', label: 'Submit Phase I' }], cta: 'Start the mission →' },
    voicesHead: 'Researchers funding their work with Mindy',
    voices: [
      { p: '"I’m a scientist, not a contracting expert. Mindy pointed me to the exact NIH topic my thesis fit — and I landed a Phase I without hiring a consultant."', name: 'Dr. Amara O.', br: 'Bioengineering · PI' },
      { p: '"Non-dilutive was the whole point. We kept 100% of our spinout and let the DoD fund the R&D."', name: 'Leo M.', br: 'Robotics · Founder' },
      { p: '"The ‘hottest topics’ board told us where the money was moving before our department did. We pivoted our proposal and won."', name: 'Dr. Chen W.', br: 'Materials Science' } ],
    final: { h2: 'Your research deserves funding.', p: 'Join free — see what’s open in your field, match your work to real topics, and fund it without giving up a thing.', cta: 'Find my funding — free →' },
  },
  sbir: {
    title: 'Mindy — SBIR & Innovators Hub', theme: 'cyan', acc: '#22c9e0', acc2: '#7fe9f5', ctaInk: '#04262c',
    crumb: 'Community › SBIR & Innovators', ctaLabel: 'Get funded →',
    kicker: '🔬 For builders & innovators', h1a: 'The coolest stuff', h1em: 'the government’s buying.',
    lead: 'Uncle Sam funds wild R&D — drones, AI, biotech, space, materials. Billions in SBIR/STTR, non-dilutive, no VC required. Mindy surfaces the topics that fit what you build and gets you to Phase I without the paperwork headache.',
    ctaBtn: 'Find my topic — free →',
    profile: { emoji: '🔬', title: 'Your build profile', sub: 'Domain: Autonomy & AI', cells: [
      { n: '$1.2B', l: 'Open funding in your domain' }, { n: '18', l: 'Topics that fit your build' },
      { n: 'Phase I', l: 'Your next step · $50–300K' }, { n: '$0', l: 'Equity given up' } ] },
    stats: [
      { n: '$4.5B+', l: 'in SBIR/STTR a year', s: 'America’s largest source of non-dilutive startup R&D funding' },
      { n: 'Phase I→III', l: 'feasibility to contract', s: '$50–300K to prove it, $1–2M to build it, then sole-source scale' },
      { n: '11 agencies', l: 'buying innovation', s: 'DoD, NASA, DOE, NIH, NSF, DHS & more — each with open topics' } ],
    spot: { eyebrow: 'Build of the month', head: 'Wild idea → funded prototype', emoji: '🚀', clabel: 'This month’s spotlight',
      name: 'Vantablack Robotics', who: 'Sam & Wei · two-person garage startup',
      story: 'Built a scrappy autonomous-inspection drone, matched it to an Air Force topic, and turned it into a $1.9M Phase II — no investors, no board. Mindy found the topic; they built the thing.',
      nominate: 'Nominate a builder →', read: 'Read their build log' },
    feeds: [
      { head: 'Hottest domains', icon: '🔥', sub: 'SBIR funding by domain · ▲▼ vs last cycle', foot: 'See all funded domains →', rows: [
        { rank: '1', name: 'Autonomy & Drones', sub: 'DoD · multi-service', value: '$1.2B', move: '▲3', moveCls: 'up' },
        { rank: '2', name: 'AI / ML', sub: 'across agencies', value: '$980M', move: '▲1', moveCls: 'up' },
        { rank: '3', name: 'Space & Sensors', sub: 'NASA · Space Force', value: '$640M', move: 'NEW', moveCls: 'g' },
        { rank: '4', name: 'Biotech & Med Devices', sub: 'NIH · DHA', value: '$520M', move: '▼2', moveCls: 'dn' } ] },
      { head: 'Open topics · closing soon', icon: '⏳', sub: 'Jump on these before the window shuts', foot: 'Match my build to open topics →', rows: [
        { rank: '1', name: 'Counter-UAS Autonomy', sub: 'Army · Phase II', value: '$1.7M', move: '18d', moveCls: 'dn' },
        { rank: '2', name: 'Edge AI for ISR', sub: 'Air Force · Phase I', value: '$250K', move: '26d', moveCls: 'dn' },
        { rank: '3', name: 'In-Space Manufacturing', sub: 'NASA · Phase I', value: '$150K', move: '39d', moveCls: 'dn' },
        { rank: '4', name: 'Battery Chemistry', sub: 'DOE · STTR', value: '$200K', move: '47d', moveCls: 'dn' } ] } ],
    cardsHead: { eyebrow: 'The ladder', head: 'How the money actually works', sub: 'SBIR isn’t one grant — it’s a ladder. Prove it, build it, then sell it to the government at scale.' },
    cards: [
      { amt: '$50–300K', h4: 'Phase I · Feasibility', p: 'Prove the concept works. 6 months, non-dilutive, no strings on your IP.', meta: ['Open cycles', 'All domains'], go: 'Find a Phase I →' },
      { amt: '$1–2M', h4: 'Phase II · Development', p: 'Build the prototype. 2 years of funding to turn feasibility into a product.', meta: ['By invitation', 'After Phase I'], go: 'Plan your Phase II →' },
      { amt: 'Sole-source', h4: 'Phase III · Scale', p: 'Sell it to the government — no full competition. This is where SBIR pays off.', meta: ['Direct award', 'Commercialize'], go: 'See Phase III paths →' } ],
    mission: { clabel: 'Builder mission · 30 days', title: 'Garage to Phase I',
      p: 'A guided sprint from "cool idea" to a submitted SBIR proposal — Mindy matches your build to a topic, checks fit, and preps the pieces. Finish it to earn the First Submission badge + bonus credits.',
      steps: [{ done: true, n: '✓', label: 'Describe what you build' }, { done: true, n: '✓', label: 'Match to a topic' }, { n: '3', label: 'Check topic fit' }, { n: '4', label: 'Draft the proposal' }, { n: '5', label: 'Submit Phase I' }], cta: 'Start the mission →' },
    voicesHead: 'Founders funding their build with Mindy',
    voices: [
      { p: '"We were bootstrapping in a garage. SBIR let us build the prototype and keep 100% of the company. Mindy found the topic in an afternoon."', name: 'Wei L.', br: 'Autonomy · Founder' },
      { p: '"The ‘hottest domains’ board is basically a map of where the government’s about to spend. We aimed our proposal at it and won Phase I."', name: 'Sam R.', br: 'Robotics · CTO' },
      { p: '"Phase III was the unlock — sole-source contracts with no dilution. I didn’t even know that path existed until Mindy walked me up the ladder."', name: 'Nadia K.', br: 'Space Tech · Founder' } ],
    final: { h2: 'Build the future. Let them fund it.', p: 'Join free — match what you build to open topics, climb the SBIR ladder, and keep every share of your company.', cta: 'Find my topic — free →' },
  },
};

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
          <div className="kick">{cfg.kicker}</div>
          <h1 className="disp">{cfg.h1a}<br /><em>{cfg.h1em}</em></h1>
          <p className="lead">{cfg.lead}</p>
          <div className="cta"><a className="btn-lg" href="/signup">{cfg.ctaBtn}</a><a className="btn-ghost2" href="#how">▶ How it works</a></div>
        </div>
        <div className="tag">
          <div className="th"><div className="badge">{cfg.profile.emoji}</div><div><div className="nm">{cfg.profile.title}</div><div className="rk">{cfg.profile.sub}</div></div></div>
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
          <div className="spot">{cfg.spot.emoji}</div>
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
          {cfg.feeds.map((f) => (
            <div className="panel" key={f.head}>
              <div className="ph"><div className="t">{f.icon} {f.head}</div><span className="share">↗ Share</span></div>
              <p className="sub">{f.sub}</p>
              {f.rows.map((r) => (
                <div className={`row${r.rank === '1' ? ' t1' : ''}`} key={r.rank + r.name}>
                  <span className="rk num">{r.rank}</span>
                  <span className="who2"><span className="nm">{r.name}{r.sub && <small>{r.sub}</small>}</span></span>
                  <span className="vl num">{r.value}</span>
                  <span className={`mv ${r.moveCls || ''}`}>{r.move || ''}</span>
                </div>
              ))}
              <div className="foot">{f.foot}</div>
            </div>
          ))}
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
          {cfg.mission.steps.map((s) => (<div className={`mstep${s.done ? ' done' : ''}`} key={s.label}><span className="n2">{s.n}</span> {s.label}</div>))}
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
