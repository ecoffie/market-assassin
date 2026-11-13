/**
 * /ambassadors — the Mindy Ambassador Program.
 *
 * The source of truth is the owner's "Mindy Ambassador Program" document (2026-11-13). This page
 * states it section by section in the document's own words: requirements, selection criteria,
 * expectations, what counts, what you get, disclosure, claim limits, terms and how to apply.
 * Do not add promises the document does not make (no commission, no "unlimited").
 *
 * People apply with the form below; the team decides each one by hand (/api/admin/ambassadors).
 */
import AmbassadorForm from './AmbassadorForm';

type Row = [string, string];

const REQUIREMENTS: Row[] = [
  ['Active federal business', 'A real operating company with an active SAM registration and a UEI you give us. Not an LLC formed last month with no registration.'],
  ['An existing posting habit', 'You already publish on LinkedIn, YouTube or another public channel, on some kind of cadence, and you were doing it before you heard about this program. We will look at your last ninety days.'],
  ['You already attend events', 'You have been to an industry day, matchmaking session, conference or agency outreach event in the last twelve months, and you can name it.'],
  ['Something in motion', 'At least one real federal pursuit underway. A sources sought response, a bid in progress, a teaming conversation, a recompete you are tracking. Not an intention.'],
  ['Willing to post losses', 'You will post the no-award and the lesson, not only the win. A feed that is all wins is not credible and does not help anyone.'],
  ['Nothing that embarrasses either of us', 'No active suspension or debarment, no exclusion in SAM, and a public presence we are comfortable standing next to.'],
];

const CRITERIA: Row[] = [
  ['Effort, not experience', 'Someone newer who is going to industry days, submitting responses and posting what they learned beats an established firm that stopped trying three years ago. This is the one that decides most applications.'],
  ['Consistency you can prove', 'A steady posting record over months, not a burst. We would rather have twice a month forever than daily for three weeks.'],
  ['Specificity', 'Do your posts contain real detail, real numbers, real agency names? Or are they motivational? We want the former.'],
  ['Portfolio spread', 'We are deliberately building a cohort across different NAICS codes, certifications, agencies and regions. Two identical applicants and we take the one that fills a gap. This is the only criterion you cannot influence.'],
  ['Audience fit over audience size', 'Two thousand federal contractors who read every post beats forty thousand general followers. We are not buying reach.'],
];

const EXPECTATIONS: Row[] = [
  ['Four public posts', 'One a week. Each one shows a real action you took in Mindy and what came of it: an action plan, a compliance matrix, a sources sought response, an opportunity you found and qualified, a recompete, a buyer you identified. Screenshot or short video beats text alone.'],
  ['Tag Mindy on every post', 'So we can find it, reshare it and count it. An untagged post does not count, because we cannot see it.'],
  ['Disclose on every post', 'In plain language, in the post itself. Section 6 has the exact wording. A post without disclosure does not count and we will ask you to fix it.'],
  ['One event a quarter', 'An industry day or conference, plus a post covering what you did to prepare. Free local industry days count. Nobody is expected to fund travel to a national conference.'],
  ['The monthly cohort call', 'One hour. Two or three people walk through what they posted and what happened. Attend or send a note; missing it silently twice is treated as a miss.'],
];

const COUNTS: string[] = [
  'A specific thing you did and what happened. "I ran the expiring contracts at this agency, found three recompetes in my code, and called the incumbent on one of them. Here is what they said."',
  'A loss with the reason. "We went after this, got no-awarded, and here is what the debrief told us."',
  'A short video of you using it, even ninety seconds, even unpolished.',
];

const DOES_NOT_COUNT: string[] = [
  'A reshare of our content with a comment. We appreciate it, it is not a post.',
  'Generic encouragement with our logo on it. No specifics means no value to the reader.',
  'Four posts in the last week of the month. The cadence is the point.',
];

const YOU_GET: Row[] = [
  ['Twelve months of Mindy', 'Full access with a generous monthly credit allowance and complete training on the platform. One seat. Access runs through MCP, so credits rather than logins are the unit, and one connection serves your whole team.'],
  ['A podcast appearance', 'Part of the package, not something you earn. We place it in the second or third quarter of your term, once you have a real pursuit to talk about rather than just a login. The episode is about your business, not about the software.'],
  ['Our audience', '57,000 YouTube subscribers, a daily podcast past 895 episodes, and 26,000 on LinkedIn. We feature ambassadors across all of it and reshare your best work.'],
  ['The cohort', "A private group of contractors across different codes, certifications and regions, with introductions made deliberately. Several of you will end up on each other's bids, and that is the point."],
  ['Direct access', 'A line to Eric and the coaching team, early access to new features, and a say in what gets built next.'],
  ['The credential', 'A badge and a title you can use.'],
];

const DISCLOSURE_WORDING = 'Mindy gives me free access to their platform as part of their ambassador program.';

const DISCLOSURE: Row[] = [
  ['Put it in the post', 'Near the top, not in your bio, not in the comments, not behind a "see more".'],
  ['In video, do both', 'Say it out loud and put it on screen.'],
  ['We will be checking', 'Not to police you. The rules put the responsibility on us, which means a missing disclosure is our problem too.'],
];

const CLAIM_LIMITS: Row[] = [
  ['No win guarantees, and no credit transfer.', 'Mindy found the opportunity, surfaced the recompete or built the plan. Your company won the contract. Never the other way around.'],
  ['No numbers a reader cannot check.', 'If you cite an award value or a contract, it should be something anyone could verify in a public source.'],
  ['Nothing that costs you.', 'No live bid strategy, no pricing, no naming a teaming partner or client without their permission. A post that loses you a contract ends this program by word of mouth.'],
];

const TERMS: Row[] = [
  ['Length', 'Twelve months from the day your access turns on.'],
  ['Seats', 'One. Access is through MCP, so your whole team works off one connection and the ceiling is on usage rather than headcount. There is a stated fair-use limit that no normal user reaches.'],
  ['There is no fee', 'In either direction. We are not paying you and you are not paying us. The licence is the equipment, not the payment.'],
  ['Month thirteen', 'You move to a paying licence at a locked ambassador discount. We tell you that rate when you sign, so there is no surprise in month twelve.'],
  ['Competitors', 'We are not asking for exclusivity. We do ask that you are not in an equivalent program with a direct competitor at the same time, and that you make no comparative claims in either direction.'],
  ['Your content', 'You own it. We ask for a perpetual, royalty-free right to reshare, quote and use it in our own marketing. That is the normal arrangement and it will be in writing.'],
  ['Missing the standard', 'Four posts is the commitment. Three is a miss. Two months of misses ends the agreement and we will have told you after the first one.'],
  ['Either side can leave', 'Thirty days notice, no reason required, no hard feelings. Access ends with the agreement.'],
];

const FIVE_THINGS: string[] = [
  'A link to where you post.',
  'Your company name and UEI.',
  'The last event you attended, by name.',
  'One line on the federal pursuit you have in motion right now.',
  'One line on what you would want to find out that you cannot find out today.',
];

function Section({ id, n, title, lede, children }: { id: string; n: number; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-(--mp-hair) py-10">
      <h2 className="m-0 font-(family-name:--mp-font-serif) text-[26px] font-bold leading-tight text-(--mp-ink) sm:text-[30px]">
        <span className="text-(--mp-muted)">{n}.</span> {title}
      </h2>
      {lede && <p className="mt-2 mb-0 text-[15px] text-(--mp-muted)">{lede}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Label / text rows: two columns from `sm`, stacked on a phone. */
function Rows({ rows, numbered = false, head }: { rows: Row[]; numbered?: boolean; head?: [string, string] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--mp-hair) bg-(--mp-surface)">
      {head && (
        <div className="hidden grid-cols-[minmax(0,15rem)_1fr] gap-6 bg-(--mp-navy) px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-(--mp-surface) sm:grid">
          <span>{head[0]}</span>
          <span>{head[1]}</span>
        </div>
      )}
      <dl className="m-0">
        {rows.map(([label, text], i) => (
          <div key={label} className={`grid gap-1.5 px-5 py-4 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-6 ${i ? 'border-t border-(--mp-hair)' : ''} ${i % 2 ? 'bg-(--mp-wash)' : ''}`}>
            <dt className="text-[16px] font-semibold text-(--mp-navy)">
              {numbered && <span className="mr-2 text-(--mp-muted)">{i + 1}</span>}
              {label}
            </dt>
            <dd className="m-0 text-[16px] leading-[1.6] text-(--mp-body)">{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function List({ title, items, mark }: { title: string; items: string[]; mark: 'yes' | 'no' }) {
  return (
    <div className="rounded-xl border border-(--mp-hair) bg-(--mp-surface) p-5">
      <h3 className="m-0 text-[17px] font-semibold text-(--mp-ink)">{title}</h3>
      <ul className="mt-3 mb-0 grid list-none gap-3 p-0">
        {items.map((t) => (
          <li key={t} className="grid grid-cols-[20px_1fr] gap-2 text-[16px] leading-[1.6] text-(--mp-body)">
            <span aria-hidden="true" className={`font-bold ${mark === 'yes' ? 'text-(--mp-ok)' : 'text-(--mp-muted)'}`}>{mark === 'yes' ? '✓' : '✕'}</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AmbassadorsPage() {
  return (
    <div className="bg-(--mp-paper)">
      <header className="mx-auto max-w-[880px] px-4 pb-10 pt-14 sm:px-6 md:pt-20">
        <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-(--mp-muted)">Mindy Ambassador Program</p>
        <h1 className="mt-4 mb-0 font-(family-name:--mp-font-serif) text-[36px] font-bold leading-[1.12] text-(--mp-ink) sm:text-[48px]">
          Fifty federal contractors. Twelve months of Mindy. One public post a week showing what you actually did with it.
        </h1>
        <p className="mt-6 mb-0 text-[18px] leading-[1.6] text-(--mp-body)">
          This is not a review program and we are not asking for testimonials. We want a public record of real people doing real federal contracting work, in their own voice, including the parts that did not go the way they wanted.
        </p>
        <p className="mt-4 mb-0 text-[18px] leading-[1.6] text-(--mp-body)">
          What follows is the whole arrangement: what you need in order to apply, how we choose, what we expect every month, what you get, and what ends it. Read it before you apply. We would rather you pass now than quit in month three.
        </p>
        <a href="#apply" className="mt-8 inline-flex items-center rounded-xl bg-(--mp-navy) px-6 py-3.5 text-[16px] font-semibold text-(--mp-surface) no-underline hover:bg-(--mp-navy-hover)">
          Read it, then apply
        </a>
      </header>

      <div className="mx-auto max-w-[880px] px-4 sm:px-6">
        <Section id="requirements" n={1} title="Requirements to apply" lede="All six. These are not preferences, they are the filter.">
          <Rows rows={REQUIREMENTS} />
        </Section>

        <Section id="selection" n={2} title="Selection criteria" lede="How we choose among people who meet the requirements. In this order.">
          <Rows rows={CRITERIA} numbered />
          <blockquote className="mt-6 mb-0 border-l-4 border-(--mp-navy) bg-(--mp-wash) px-5 py-4 text-[16px] leading-[1.6] text-(--mp-body)">
            <b className="text-(--mp-ink)">We are not looking to take someone who has never tried and sign them up.</b> We are looking for people who are already working hard and giving them better tools. If the only reason you would start posting is this program, you are not a fit, and that is not a judgment on your business.
          </blockquote>
        </Section>

        <Section id="expectations" n={3} title="Expectations" lede="Per month, for twelve months. This is the scorecard.">
          <Rows rows={EXPECTATIONS} head={['Expectation', 'The standard']} />
        </Section>

        <Section id="what-counts" n={4} title="What counts, and what does not" lede="So nobody is guessing at the end of the month.">
          <div className="grid gap-4 md:grid-cols-2">
            <List title="Counts" items={COUNTS} mark="yes" />
            <List title="Does not count" items={DOES_NOT_COUNT} mark="no" />
          </div>
        </Section>

        <Section id="what-you-get" n={5} title="What you get">
          <Rows rows={YOU_GET} />
        </Section>

        <Section id="disclosure" n={6} title="Disclosure" lede="Not optional, and not ours to waive.">
          <p className="mt-0 mb-5 text-[16px] leading-[1.6] text-(--mp-body)">
            Twelve months of free access in exchange for public posts is a material connection under the FTC Endorsement Guides. It has to be disclosed on every post. This protects you as much as it protects us.
          </p>
          <div className="mb-4 rounded-xl border border-(--mp-hair) bg-(--mp-surface) px-5 py-4">
            <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-(--mp-muted)">Use plain words</p>
            <p className="mt-2 mb-0 font-(family-name:--mp-font-serif) text-[19px] italic leading-[1.5] text-(--mp-ink)">&ldquo;{DISCLOSURE_WORDING}&rdquo;</p>
            <p className="mt-2 mb-0 text-[15px] text-(--mp-body)">Hashtags alone often do not qualify.</p>
          </div>
          <Rows rows={DISCLOSURE} />
        </Section>

        <Section id="claim-limits" n={7} title="Claim limits" lede="Three rules. Each one exists because the alternative is expensive.">
          <ul className="m-0 grid list-none gap-4 p-0">
            {CLAIM_LIMITS.map(([lead, rest]) => (
              <li key={lead} className="rounded-xl border border-(--mp-hair) bg-(--mp-surface) px-5 py-4 text-[16px] leading-[1.6] text-(--mp-body)">
                <b className="text-(--mp-ink)">{lead}</b> {rest}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="terms" n={8} title="Terms">
          <Rows rows={TERMS} />
        </Section>

        <Section id="apply" n={9} title="Applying">
          <div className="rounded-xl border border-(--mp-hair) bg-(--mp-wash) px-5 py-5">
            <p className="m-0 text-[17px] font-semibold text-(--mp-ink)">Send us five things.</p>
            <ol className="mt-3 mb-0 grid gap-2 pl-6 text-[16px] leading-[1.6] text-(--mp-body)">
              {FIVE_THINGS.map((t) => <li key={t}>{t}</li>)}
            </ol>
            <p className="mt-4 mb-0 text-[16px] leading-[1.6] text-(--mp-body)">
              We are starting with 15 and opening to 50 after the first quarter. We read every application and we answer either way.
            </p>
          </div>
          <div className="mt-8 pb-16">
            <AmbassadorForm />
            <p className="mt-6 mb-0 text-[15px] text-(--mp-muted)">
              Questions before you apply? Email <a href="mailto:admin@getmindy.ai" className="text-(--mp-navy)">admin@getmindy.ai</a>.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
