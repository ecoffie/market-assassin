import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  BLOG_POSTS,
  getBlogPost,
  getRelatedPosts,
  type BlogPostMeta,
} from '@/data/blog-posts';
import {
  BlogPostLayout,
  H2,
  H3,
  P,
  Lead,
  UL,
  OL,
  LI,
  A,
  Callout,
  Strong,
} from '@/components/blog/BlogPostLayout';

/**
 * /blog/[slug] — dynamic route that renders any post in the registry.
 *
 * Architectural call: one dynamic route + a slug-keyed body switch
 * (vs one file per post). Trade-off:
 *   + Single file owns ALL the SEO scaffolding — generateMetadata,
 *     generateStaticParams, JSON-LD, breadcrumb schema. Per-post
 *     drift impossible.
 *   + Adding a post = one entry in the registry + one body function
 *     in this file. Two edits, both in obvious places.
 *   - This file grows ~250-400 lines per post. At ~10 posts we
 *     refactor: extract each body to src/content/blog/<slug>.tsx and
 *     import. The dynamic route stays.
 *
 * Why not MDX: the body has zero markdown — every paragraph, list,
 * and callout uses typed primitives from BlogPostLayout. That gives
 * us editor autocomplete, no markdown parser, no runtime cost, and
 * full server-rendering for SEO. The "markdown" tax was never worth
 * paying for 3 posts.
 */

// Tell Next.js to pre-render every known post at build time so each
// /blog/{slug} ships as a static HTML file (best for crawlers and CDN
// caching). Unknown slugs fall through to notFound().
export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

// Per-post metadata. Next 16 passes params as a Promise — must await
// before using. Canonical points to getmindy.ai/blog/{slug} so the
// host-rewrite on mi.govcongiants.com doesn't fragment ranking.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: 'Post not found' };

  const url = `https://getmindy.ai/blog/${post.slug}`;

  return {
    title: `${post.title} | Mindy`,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const related = getRelatedPosts(slug, 2);
  const Body = BODY_BY_SLUG[slug];
  // Defensive: a registry entry without a matching body shouldn't ship,
  // but if it does we 404 instead of rendering an empty article shell.
  if (!Body) notFound();

  return (
    <>
      <PostJsonLd post={post} />
      <BlogPostLayout meta={post} related={related}>
        <Body />
      </BlogPostLayout>
    </>
  );
}

/**
 * Combined JSON-LD: BlogPosting (rich result + Google News surfaces)
 * + BreadcrumbList (breadcrumb display in SERPs). Inlined as one
 * @graph so we make a single script tag and one HTTP byte payload.
 */
function PostJsonLd({ post }: { post: BlogPostMeta }) {
  const url = `https://getmindy.ai/blog/${post.slug}`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#post`,
        headline: post.title,
        description: post.description,
        datePublished: post.publishedAt,
        dateModified: post.updatedAt,
        author: {
          '@type': 'Person',
          name: post.author,
          url: 'https://getmindy.ai',
        },
        publisher: {
          '@type': 'Organization',
          '@id': 'https://getmindy.ai/#organization',
          name: 'Mindy',
          logo: {
            '@type': 'ImageObject',
            url: 'https://getmindy.ai/icon.png',
          },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        url,
        keywords: post.keywords.join(', '),
        articleSection: post.tags[0],
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://getmindy.ai' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://getmindy.ai/blog' },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}

// ============================================================
// POST BODIES
// ============================================================
// Each function below is a complete blog post body. They're keyed by
// slug in BODY_BY_SLUG at the bottom. To add a new post:
//   1) Append to BLOG_POSTS in src/data/blog-posts.ts
//   2) Write the body function here
//   3) Add it to BODY_BY_SLUG
// ============================================================

function BodyHowToFindContracts() {
  return (
    <>
      <Lead>
        I&apos;ll be honest with you: finding federal contracts in 2026 is harder
        than it should be. The data is public. The opportunities are real. But
        the system was built for procurement officers, not for the small
        businesses trying to win the work.
      </Lead>

      <P>
        Every business day, roughly <Strong>1,500 new federal opportunities</Strong>{' '}
        get posted across more than 15 government websites. SAM.gov is the
        biggest one, but it&apos;s not the only one. And if you&apos;re searching
        only by keyword on a Tuesday night, you&apos;re missing most of what
        matters.
      </P>

      <P>
        This is the playbook I use — the four sources to monitor, the five
        filters that actually move the needle, and the three mistakes I see
        contractors make every single week.
      </P>

      <H2>The problem: 15 websites, 1,500 daily opps, no UX</H2>

      <P>
        The federal government doesn&apos;t have a single &quot;opportunities&quot;
        page. SAM.gov is the closest thing, but it only covers procurement
        contracts. Grants.gov is separate. Each agency runs its own forecast
        page. USASpending.gov has the award history. None of them talk to
        each other.
      </P>

      <P>
        The official tools weren&apos;t designed for discovery. They were
        designed for compliance — to publish notices the law requires the
        government to publish. Whether you can actually <em>find</em> the right
        notice in time to bid? That&apos;s your problem.
      </P>

      <P>
        Which is why most contractors I talk to default to one of two losing
        strategies: they either subscribe to a $5,000/year enterprise tool
        they barely use, or they spend Sunday nights scrolling SAM.gov hoping
        not to miss something. Neither works.
      </P>

      <H2>The 4 sources every contractor should monitor</H2>

      <P>
        You don&apos;t need to monitor 15 websites. You need to monitor four.
        The other 11 either re-publish what these four have, or they&apos;re
        agency-specific portals you only need if you&apos;re already targeting
        that agency.
      </P>

      <H3>1. SAM.gov — the federal procurement firehose</H3>
      <P>
        Every federal contract over $25,000 has to be posted here. It&apos;s
        the legal system of record. Search by NAICS code (not keyword) and
        you&apos;ll see solicitations, sources sought notices, and award
        notices. The UI is rough, but the data is authoritative.
      </P>
      <P>
        The trick most contractors miss: SAM.gov isn&apos;t one stream of
        notices, it&apos;s six. Solicitations are the ones with a due date.
        Sources sought are the early signals — agencies asking the market
        if anyone can do this work. Special notices, award notices, sale
        notices, and combined synopsis/solicitations round out the rest.
        Filter to all six notice types or you&apos;ll miss the
        forward-looking signals that matter most.
      </P>

      <H3>2. Grants.gov — the grants side most contractors ignore</H3>
      <P>
        Federal grants are a separate $700B+ system. If your business does
        research, training, technology development, or anything in the
        health/education/energy space, Grants.gov has work SAM.gov never
        will. Most small contractors never check it. That&apos;s the
        opportunity.
      </P>
      <P>
        Grants have different rules than contracts — there&apos;s no
        deliverable in the traditional sense, and the proposal format is
        different. But the money is real, and the competition is often
        thinner than on the procurement side, because most government
        contractors only think to look at SAM.
      </P>

      <H3>3. Agency forecasts — what&apos;s coming before it posts</H3>
      <P>
        Every major agency publishes a procurement forecast — what they
        <em> plan</em> to buy in the next 12-18 months. These are gold for
        positioning, because by the time something hits SAM.gov, the incumbent
        has been talking to the agency for a year. The forecast is your
        chance to start that conversation early.
      </P>
      <P>
        Forecasts live in different places for different agencies. DoD
        publishes through its individual components. HHS, VA, and DHS each
        have their own forecast portals. There&apos;s a central federal
        forecasting site too, but coverage is partial — the agency&apos;s
        own page is usually fresher. If you target three to five agencies,
        bookmark their forecast pages and check them quarterly.
      </P>

      <H3>4. USASpending.gov — the award history (and who&apos;s expiring)</H3>
      <P>
        USASpending shows you every contract that&apos;s been awarded, when it
        ends, and who won it. This is how you find <em>recompetes</em> — the
        contracts coming up for renewal in the next 12-18 months. If
        you&apos;re only looking at SAM.gov, you&apos;re looking at the past
        tense of work that&apos;s already in progress.
      </P>
      <P>
        USASpending also shows you who&apos;s actually getting paid in your
        NAICS codes, broken down by agency, sub-agency, and contract
        vehicle. That&apos;s the data the big primes use to build their BD
        target lists. It&apos;s the same data, available to you, for free.
        Most small contractors have never opened it.
      </P>

      <H2>The 5 filters that actually matter</H2>

      <P>
        Filtering is where most people go wrong. They search by keyword
        (&quot;cybersecurity&quot;) and get 400 results that have nothing to
        do with their business. Then they give up and assume there&apos;s
        nothing for them.
      </P>

      <P>Here are the five filters I always apply, in this order:</P>

      <OL>
        <LI>
          <Strong>NAICS code.</Strong> Not keyword. NAICS is how the
          government classifies the work. Search by your codes and you get
          opportunities where your business is actually qualified to bid.
        </LI>
        <LI>
          <Strong>Set-aside type.</Strong> 8(a), WOSB, SDVOSB, HUBZone,
          small business. If a contract is set aside for a category you
          don&apos;t qualify for, it&apos;s not your contract — no matter how
          perfect the work sounds.
        </LI>
        <LI>
          <Strong>Response date.</Strong> If it&apos;s a 15-day response
          window, the agency probably has someone in mind. If it&apos;s 45+
          days, there&apos;s real competition welcomed. Both can be worth
          bidding on, but they&apos;re very different plays.
        </LI>
        <LI>
          <Strong>Dollar value.</Strong> Filter out the $50M whales if
          you&apos;re a $500K shop, and vice versa. Bidding outside your
          size band burns weeks of proposal time for almost no win rate.
        </LI>
        <LI>
          <Strong>Agency.</Strong> The agencies you&apos;ve worked with — or
          the ones you&apos;re actively building relationships with — should
          float to the top. Relationships still win contracts.
        </LI>
      </OL>

      <Callout title="The dirty secret">
        <p>
          Most opportunity search tools default to keyword search because
          that&apos;s what&apos;s easy to build. NAICS search takes a few
          extra steps. That&apos;s why I lead with NAICS — it&apos;s where
          90% of the noise drops out.
        </p>
      </Callout>

      <H2>The 3 mistakes contractors make</H2>

      <H3>Mistake 1: Keyword-only search</H3>
      <P>
        Keywords miss opportunities written in acquisition-speak and surface
        opportunities that share a word with your business but no substance.
        A search for &quot;data analytics&quot; will show you a janitorial
        contract that mentions analyzing waste-stream data. NAICS doesn&apos;t
        have that problem.
      </P>

      <H3>Mistake 2: Ignoring forecasts</H3>
      <P>
        Forecasts feel speculative — they&apos;re just a list of stuff the
        agency might buy. So contractors skip them. The contractors who
        don&apos;t skip them are the ones who introduce themselves to the
        program office 12 months before the RFP drops. By the time the RFP
        is on SAM.gov, they&apos;ve already shaped the requirement.
      </P>

      <H3>Mistake 3: Not tracking incumbents</H3>
      <P>
        Every contract has an end date. Every end date is a sales opportunity
        — for whoever knows about it 12+ months ahead. If you&apos;re only
        looking at what&apos;s on SAM.gov right now, you&apos;re missing the
        contracts that <em>will</em> be on SAM.gov a year from now. Those are
        the easiest to win, because you have time to position.
      </P>

      <H2>How I do this for you (the soft pitch)</H2>

      <P>
        I built Mindy because I was watching small businesses lose contracts
        not because they couldn&apos;t do the work — they could — but
        because they didn&apos;t know the work existed. The data is all
        public. The problem is volume, format, and timing.
      </P>

      <P>
        So every day, I scan all four sources above for the NAICS codes,
        agencies, and set-asides that match your profile. I filter out the
        noise, score each opportunity by how well it actually fits your
        business, and put it all in a single morning briefing. No 15
        websites. No Sunday-night scrolling.
      </P>

      <P>
        That includes the forecasts and the recompete watch — the
        forward-looking stuff that takes the most discipline to track
        manually. You wake up, you read the briefing, you spend your time
        on the work that wins contracts (proposals, capability statements,
        agency relationships) instead of the work that finds them.
      </P>

      <Callout title="Try this first">
        <p>
          Before you sign up for anything, do this manually for one week:
          search SAM.gov by your NAICS codes (not keywords) every morning,
          check one agency forecast page, and look up one expiring contract
          on USASpending. You&apos;ll see the pattern. Then decide if you
          want to keep doing it by hand.
        </p>
      </Callout>

      <H2>A simple weekly cadence</H2>

      <P>
        Even if you&apos;re doing this without any tools, you can build a
        rhythm that catches 80% of what matters in under an hour a week:
      </P>

      <UL>
        <LI>
          <Strong>Monday (20 min):</Strong> Scan SAM.gov for new
          solicitations and sources sought in your top 3 NAICS codes.
          Note the ones worth a deeper look.
        </LI>
        <LI>
          <Strong>Tuesday (15 min):</Strong> Open one agency forecast.
          Note the line items 6-12 months out that match your work. Add
          them to a simple spreadsheet.
        </LI>
        <LI>
          <Strong>Wednesday (15 min):</Strong> USASpending check — pull
          contracts in your NAICS that expire in the next 18 months. Look
          for ones where the incumbent has weak performance reviews.
        </LI>
        <LI>
          <Strong>Friday (10 min):</Strong> Review your week&apos;s list.
          Pick one opportunity to pursue, one relationship to start, and
          one capability gap to close.
        </LI>
      </UL>

      <P>
        That&apos;s the floor. It&apos;s not enough to win the big
        contracts, but it&apos;s more than 90% of small contractors are
        doing — and it&apos;ll surface real opportunities within the first
        month. Then decide whether to keep the manual cadence or hand the
        scanning off to something (or someone) else.
      </P>
    </>
  );
}

function BodySamGovAlerts() {
  return (
    <>
      <Lead>
        SAM.gov has a built-in alerts feature. You set up a saved search,
        check a box, and the system emails you when matching opportunities
        get posted. Free, official, no third-party tool required. So why does
        every serious contractor I know either turn the alerts off or ignore
        them?
      </Lead>

      <P>
        Because they don&apos;t work. Not really. They generate noise, they
        miss the contracts you&apos;d actually want, and they treat every
        opportunity the same — a 30-day solicitation worth $50K and a
        2-day amendment to a $50M IDIQ get the same email treatment.
      </P>

      <P>
        Here&apos;s why SAM.gov alerts fail, what intelligent alerts look
        like instead, and the workflow that actually works in 2026.
      </P>

      <H2>The 4 reasons SAM.gov alerts miss perfect-fit opportunities</H2>

      <H3>1. They only match what you typed</H3>
      <P>
        SAM.gov alerts are keyword-based. If you saved an alert for
        &quot;cybersecurity training&quot; and an agency posts a contract for
        &quot;information assurance workforce development,&quot; you won&apos;t
        see it. Same work, different words. The system has no concept of
        synonyms, related NAICS codes, or what your business actually does.
      </P>

      <H3>2. They fire after the opportunity is already public</H3>
      <P>
        SAM.gov sends the alert when the notice is published. By the time
        it hits your inbox, every other contractor with the same keyword
        saved already has it too. There&apos;s no early signal — no
        sources-sought heads-up, no forecast cross-reference, no &quot;this
        is the third notice in a recompete sequence.&quot;
      </P>

      <H3>3. They don&apos;t score fit</H3>
      <P>
        Every matching notice gets equal billing in the email. A $250K
        small-business set-aside that fits your capabilities perfectly gets
        the same one-line entry as a $40M unrestricted contract you have no
        business chasing. You have to triage manually, every morning.
      </P>

      <H3>4. They miss the context</H3>
      <P>
        Who&apos;s the incumbent? Is this new work or a recompete? What did
        the agency spend on this last year? Is there a related forecast
        entry that&apos;s been on the agency&apos;s site for 18 months?
        SAM.gov alerts don&apos;t answer any of that. They just tell you
        the notice exists.
      </P>

      <H2>How keyword alerts create noise (with real numbers)</H2>

      <P>
        Let&apos;s say you set up a SAM.gov alert for &quot;IT support
        services.&quot; Reasonable keyword. Common business. Here&apos;s
        roughly what your inbox looks like after a week:
      </P>

      <UL>
        <LI>
          ~40 notices/week match the keyword across all federal agencies.
        </LI>
        <LI>
          Of those, maybe 8 are set-asides your business qualifies for.
        </LI>
        <LI>
          Of those 8, maybe 3 are in a dollar range that makes sense for you.
        </LI>
        <LI>
          Of those 3, maybe 1 is something you&apos;d actually pursue.
        </LI>
      </UL>

      <P>
        So 39 of 40 emails are noise. After two weeks, you start ignoring the
        folder. After a month, the rule that auto-archives them is doing more
        work than the alerts themselves.
      </P>

      <P>
        And the one real opportunity you would have wanted? There&apos;s a
        decent chance it was posted with a slightly different title and your
        keyword didn&apos;t match.
      </P>

      <Callout title="The math problem">
        <p>
          A useful alert system isn&apos;t one that catches everything that
          matches a word. It&apos;s one that catches the small number of
          opportunities that match your <em>business</em>. Those are very
          different problems.
        </p>
      </Callout>

      <H2>What &quot;intelligent&quot; alerts look like</H2>

      <P>
        The bar for an alert to be worth your attention is higher than
        &quot;a keyword matched.&quot; In 2026, with the data and AI we
        have, an intelligent alert should do at least three things:
      </P>

      <OL>
        <LI>
          <Strong>Fit scoring.</Strong> Rank each opportunity by how well it
          matches your NAICS codes, past performance, set-aside status, and
          target agencies. The top 5 should land in your inbox. The bottom
          35 shouldn&apos;t.
        </LI>
        <LI>
          <Strong>Incumbent context.</Strong> Tell me who has it now (if
          it&apos;s a recompete), when their contract ends, and what they
          were paid. That&apos;s the difference between a 15-minute triage
          and a 2-hour research session.
        </LI>
        <LI>
          <Strong>Recompete flags.</Strong> Flag opportunities that are
          predictable recompetes of contracts I should have been positioning
          for 12 months ago. If I missed the window, tell me. If the next
          recompete is 18 months out, put it on the calendar.
        </LI>
      </OL>

      <P>
        Anything less than this is just a slightly faster way to read
        SAM.gov. The point of an alert isn&apos;t speed. It&apos;s judgment.
      </P>

      <H3>What it looks like in practice</H3>
      <P>
        A useful morning alert reads more like a short brief than a list of
        links. Something like: &quot;Three opportunities matched your
        profile today. The top one is a sources sought from VA for IT
        modernization services — the incumbent contract on this same scope
        expires in 11 months, the current ceiling is $4.2M, and the
        incumbent has two negative CPARs in the last cycle. Recommend
        responding to the sources sought to introduce your team.&quot;
      </P>
      <P>
        That&apos;s 60 seconds of reading and a clear next step. Compare
        it to a SAM.gov email with 40 raw notice titles and no context.
        Same data underneath. Wildly different value to you.
      </P>

      <H2>Why this is hard for SAM.gov to fix</H2>

      <P>
        It&apos;s worth being fair to SAM. The platform was never designed
        to be a personalized intelligence layer — it was designed to make
        federal procurement transparent. Those are different jobs. To do
        the personalization piece well, you need to model what each user
        actually does for a living, cross-reference live contract award
        data, and apply some judgment about what&apos;s worth surfacing.
        That&apos;s closer to what a BD analyst does than what a database
        does.
      </P>

      <P>
        The federal government isn&apos;t in the business of building
        analyst-grade software. They&apos;re in the business of publishing
        notices. The good news is that they publish those notices
        completely and on time, in a format you can build on top of.
        That&apos;s exactly what intelligent alerts do — they take the
        raw, complete feed and add the layer of judgment SAM was never
        going to add.
      </P>

      <H2>The workflow that works: SAM.gov for submission, Mindy for discovery</H2>

      <P>
        I&apos;m not telling you to stop using SAM.gov. SAM is still where
        you go to read the full solicitation, ask questions, and submit your
        bid. It&apos;s the system of record, and that&apos;s not changing.
      </P>

      <P>
        What I&apos;m saying is: don&apos;t use it for <em>discovery</em>.
        Use it for the transaction. Discovery is a different job — it
        requires aggregating four different government data sources,
        scoring fit against your business, and surfacing the 5 things
        worth your attention out of the 1,500 daily opportunities.
      </P>

      <P>
        That&apos;s the job I built me for. Every morning, I send you a
        briefing with the opportunities that actually fit your business —
        scored, contextualized, with the incumbent data and recompete flags
        already pulled. You spend two minutes reading, click into the ones
        worth pursuing, and go to SAM.gov to read the full notice and bid.
      </P>

      <P>
        SAM.gov is great at being SAM.gov. It was never going to be great
        at being your morning briefing.
      </P>

      <Callout title="Bottom line">
        <p>
          SAM.gov alerts are free, and they&apos;re worth roughly what you
          pay for them. If they&apos;ve been working for you, keep using
          them. If you&apos;re reading this because they haven&apos;t —
          you&apos;re not the problem. The tool wasn&apos;t built for the
          job you&apos;re asking it to do.
        </p>
      </Callout>
    </>
  );
}

function BodyRecompetesGuide() {
  return (
    <>
      <Lead>
        Roughly $2 billion in federal contracts come up for recompete every
        business day. Most of them are won by the incumbent — not because
        the incumbent is better, but because nobody else started working the
        opportunity 18 months in advance. That&apos;s the gap. That&apos;s
        also where the money is.
      </Lead>

      <P>
        A recompete is one of the most predictable, highest-win-probability
        opportunities in federal contracting — <em>if</em> you find it early
        enough to actually compete. This is the playbook: what a recompete
        is, when to start, where to find them, and the four plays that
        unseat an incumbent.
      </P>

      <H2>What a recompete is (and why it matters)</H2>

      <P>
        Almost every federal contract has a base period plus option years —
        typically a 5-year total ceiling. When the option years run out, the
        agency has to compete the work again. That&apos;s a recompete.
      </P>

      <P>
        Three things make recompetes uniquely attractive:
      </P>

      <UL>
        <LI>
          <Strong>You know the work is real.</Strong> The agency is buying
          it again because they need it. No risk that the program gets
          cancelled.
        </LI>
        <LI>
          <Strong>You know roughly what it&apos;s worth.</Strong> The
          previous contract value is public on USASpending. You can price
          your bid against actual data, not guesses.
        </LI>
        <LI>
          <Strong>You know who&apos;s vulnerable.</Strong> Past performance
          on the existing contract is also public. If the incumbent has
          mixed reviews, the agency might genuinely want a change.
        </LI>
      </UL>

      <P>
        Compare that to chasing brand-new opportunities, where you&apos;re
        guessing at budget, requirements, and competition. Recompetes are
        the highest-information opportunities in the federal market.
      </P>

      <H2>The 18-month rule</H2>

      <P>
        Here&apos;s the timing that separates contractors who win
        recompetes from contractors who chase them:
      </P>

      <UL>
        <LI>
          <Strong>18 months out:</Strong> Identify the recompete on
          USASpending. Start studying the incumbent&apos;s performance,
          the agency&apos;s priorities, and what&apos;s changed since the
          last award.
        </LI>
        <LI>
          <Strong>12 months out:</Strong> Introduce yourself to the
          program office. Not as a vendor pitching — as a credible firm
          offering to provide market input. Get on their radar.
        </LI>
        <LI>
          <Strong>9 months out:</Strong> Watch for the sources sought
          notice. Respond to it with substance. This is the agency&apos;s
          last chance to shape the requirement before it goes to RFP.
        </LI>
        <LI>
          <Strong>6 months out:</Strong> The RFP drops. By now, you
          should know more about the requirement than half the bidders.
          Your proposal writes itself.
        </LI>
        <LI>
          <Strong>30 days out:</Strong> If this is the first time
          you&apos;re seeing the opportunity, the incumbent already won.
          Move on.
        </LI>
      </UL>

      <Callout title="The hard truth">
        <p>
          If you&apos;re finding a recompete from the SAM.gov solicitation,
          you&apos;re finding it too late. The contractors who win
          recompetes were positioning a year before the notice posted.
          That&apos;s the entire game.
        </p>
      </Callout>

      <H2>How to find recompetes</H2>

      <P>
        There&apos;s no &quot;recompetes&quot; tab on any government website.
        You have to construct the view yourself from three sources.
      </P>

      <H3>1. USASpending expiration dates</H3>
      <P>
        USASpending.gov publishes the end date for every active contract.
        Filter by NAICS codes you serve, by agencies you target, and by
        period-of-performance end dates 12-18 months out. What comes back is
        a list of contracts the agency will likely need to recompete. Not a
        guarantee — sometimes the work gets folded into a larger vehicle or
        cancelled — but the strongest signal you&apos;ll get.
      </P>

      <H3>2. Agency forecast cross-reference</H3>
      <P>
        When a recompete is real, it usually shows up on the agency&apos;s
        procurement forecast. If you see an expiring contract on USASpending
        <em> and</em> a matching forecast entry, that&apos;s a high-confidence
        recompete. If you see the expiring contract but no forecast, dig
        deeper — the work might be moving to a different vehicle.
      </P>

      <H3>3. Sources sought tracking</H3>
      <P>
        Sources sought notices are the agency saying &quot;we&apos;re
        thinking about buying this — who&apos;s out there?&quot; They
        almost always precede a recompete by 6-9 months. Track them by
        NAICS in SAM.gov, and pay extra attention when one matches a
        contract you already identified as expiring. That pairing is your
        signal to move.
      </P>

      <H2>The 4 plays to win a recompete</H2>

      <P>
        Knowing the recompete is coming gets you to the starting line.
        These four plays are how you actually displace an incumbent.
      </P>

      <H3>Play 1: Capture the incumbent&apos;s risk</H3>
      <P>
        Every incumbent has weaknesses — late deliveries, scope creep,
        turnover, cost overruns. Some of this is in public CPARs (past
        performance reports). Some of it you learn from talking to people
        at the agency. Your proposal should quietly address the things the
        incumbent has been struggling with, without naming them.
      </P>

      <H3>Play 2: Build the agency relationship now</H3>
      <P>
        Federal buyers don&apos;t award contracts to vendors they&apos;ve
        never heard of, no matter how good the proposal. Twelve months out,
        you should be introducing yourself, attending industry days, asking
        smart questions about the upcoming requirement. By RFP time, your
        name should be familiar.
      </P>

      <H3>Play 3: Stack relevant past performance</H3>
      <P>
        Past performance is the single biggest section of most federal
        evaluations. If you don&apos;t have the exact past performance
        needed, the 12-18 month runway is your chance to build it — through
        teaming, subcontracting, or smaller related contracts. Showing up
        at RFP time without the past performance is showing up to lose.
      </P>

      <H3>Play 4: Apply pricing pressure</H3>
      <P>
        Incumbents often bid recompetes at or above their current rates.
        That&apos;s the easiest part of the bid to attack. Use USASpending
        data to see what the agency&apos;s been paying, model your own
        cost basis, and price competitively without going below your
        break-even. Agencies under budget pressure notice meaningful
        savings.
      </P>
      <P>
        Be careful here, though — pricing pressure works as one signal
        among several. If you bid 30% under the incumbent and your past
        performance is weaker, the agency will read it as desperation,
        not value. The pricing play works best when it&apos;s paired with
        comparable or stronger past performance and a credible technical
        approach. Then the price difference reads as efficiency.
      </P>

      <H2>The recompetes most people miss</H2>

      <P>
        Two specific patterns are worth calling out, because they&apos;re
        where the cleanest recompete wins tend to hide:
      </P>

      <UL>
        <LI>
          <Strong>Bridge contracts.</Strong> When an agency runs out of
          time and extends an incumbent for 6-12 months on a sole-source
          basis, that&apos;s a flashing signal. The original contract
          probably had problems. The agency couldn&apos;t get the recompete
          out on time, which usually means they&apos;re overworked and
          under-staffed on the procurement side. That&apos;s a buyer
          who&apos;ll genuinely consider an alternative — if you show up
          credibly.
        </LI>
        <LI>
          <Strong>Vehicle migrations.</Strong> Sometimes a recompete
          doesn&apos;t come back as the same contract — it gets folded
          into a new IDIQ or moved to a different vehicle (GSA, OASIS+, a
          new agency-wide BPA). If you&apos;re only watching the original
          contract, you miss the work entirely. Track the program, not
          just the contract number.
        </LI>
      </UL>

      <H2>A real recompete timeline (illustrative)</H2>

      <P>
        Here&apos;s how a 5-year IT services contract typically plays out
        from your side of the table:
      </P>

      <UL>
        <LI>
          <Strong>Year 1 of incumbent contract:</Strong> Contract is awarded.
          Most competitors forget it exists.
        </LI>
        <LI>
          <Strong>Year 3:</Strong> Smart competitors flag the contract in
          their pipeline. They start showing up at agency industry days.
        </LI>
        <LI>
          <Strong>Year 4, Q1:</Strong> Sources sought notice drops. The
          serious competition is already responding with detailed
          capability statements.
        </LI>
        <LI>
          <Strong>Year 4, Q3:</Strong> Draft RFP. Industry comments shape
          the final scope. Late entrants discover the opportunity here
          and have ~6 months to catch up.
        </LI>
        <LI>
          <Strong>Year 5, Q1:</Strong> Final RFP. Bids are due in 45-60
          days. Winners are decided by who did the work in years 3 and 4.
        </LI>
        <LI>
          <Strong>Year 5, Q3:</Strong> Award. New 5-year clock starts.
        </LI>
      </UL>

      <P>
        Notice that the actual proposal phase is the last 60 days. The
        previous 24 months of positioning is what decides who wins.
      </P>

      <H2>How I track recompetes for you</H2>

      <P>
        Doing this manually for every agency and NAICS code you care about
        is a part-time job. Pulling expiration dates from USASpending,
        cross-referencing forecasts, watching for sources sought notices,
        tracking which contracts get amendments versus recompetes — it
        adds up.
      </P>

      <P>
        So I do it. Every day I&apos;m looking at the contracts in your
        NAICS codes that are 12-18 months from expiration, matching them
        against agency forecasts and sources sought notices, and flagging
        the high-confidence recompetes in your weekly briefing. You see
        them while there&apos;s still time to position — not 30 days
        before the close date when it&apos;s already over.
      </P>

      <Callout title="Where to start (even without me)">
        <p>
          Pick three agencies you want to work with. Go to USASpending,
          filter to your NAICS codes, sort by period-of-performance end
          date ascending, and look at everything ending in the next 18
          months. That list is your recompete pipeline. Now go build the
          relationships.
        </p>
      </Callout>
    </>
  );
}

// Slug-keyed body lookup. Keeping this map at the bottom (after the
// body functions) makes the file read like a table of contents: meta
// → bodies → registry of bodies.
const BODY_BY_SLUG: Record<string, () => React.JSX.Element> = {
  'how-to-find-federal-contracts': BodyHowToFindContracts,
  'sam-gov-alerts-why-they-fail': BodySamGovAlerts,
  'federal-contract-recompetes-guide': BodyRecompetesGuide,
};
