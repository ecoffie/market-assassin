/**
 * Institute white-paper registry.
 *
 * Each paper's markdown source (src/content/institute/*.md) is inlined here VERBATIM as a
 * template-literal string constant, then paired with its PaperMeta. The dynamic route
 * src/app/institute/[slug]/route.ts renders these via renderPaper(). The markdown is the
 * source of truth — rendered byte-exact, never rewritten.
 *
 * NOTE: paper2 is SHELVED and deliberately absent. The live "competition-gap" paper is its
 * own hand-built static route (src/app/institute/competition-gap/route.ts) and is NOT in this
 * array — the [slug] route must never shadow it.
 */
import type { PaperMeta } from '@/lib/gov/paper';

const MD_MLS_PROBLEM = `# The MLS Problem in Public Procurement

### Your bid notices are public by law. Getting them is not free.

**A GovCon Giants / Mindy white paper for public procurement officials and city leadership**
Draft — August 2026

---

## The short version

Before 2006, if you wanted to know what a house down the street sold for, you asked a real estate agent. The information existed — recorded, public, sitting in county assessor files — but the practical path to it ran through someone who controlled access to it. The Multiple Listing Service was the gatekeeper, and it worked well for the people who held the keys.

Zillow launched in February 2006 with roughly 40 million homes and **zero listings**, built entirely on public county records. It drew a million visitors in two days. Not because it had better data — it had worse data — but because it removed the intermediary between the public and information about the public's own neighborhoods.

**Public procurement has the same structure today.**

A city is legally required to publish its solicitations. That notice is public information the moment it exists. But the practical path between that notice and the businesses that would bid on it runs through commercial intermediaries who collect the notices, place them behind subscriptions, and sell access — frequently back to the small firms the city most wants to reach.

The city publishes. A third party monetizes the distance. And the city, not the intermediary, pays for the thin bidder pool that results.

---

## What the access layer actually charges

One of the largest municipal bid-distribution services publishes its rates openly:

| Tier | Price | What it covers |
|---|---|---|
| Free | $0 | **One agency**, plus **$5 per document** downloaded |
| County | $60/year | All agencies in one county |
| State | $100–$1,499/year | Varies by agency density |
| National | **$2,699/year** | Nationwide |

The same company markets itself to governments on the opposite terms: *"DemandStar is free for governments. We believe procurement software should save you money, not cost you money."*

Both statements are true simultaneously. **The government side is free because the vendor side is not.** That is the business model, stated plainly by the business itself.

To its credit, the company anticipates the objection. Its own FAQ asks:

> *"Why are bid downloads outside my subscription area $5? Isn't that public information?"*

The answer given is that the charge covers convenience rather than the information. That is a defensible position — aggregation is real work and someone has to pay for it. **The question this paper raises is not whether the work has value. It is who ends up paying, and what it costs the city that published the notice in the first place.**

---

## The structure is deliberate, not accidental

Three features of this layer are worth stating precisely, because together they explain why the problem persists.

**One. Exclusivity is marketed as the product.** A competing network advertises to vendors that a solicitation *"goes exclusively on BidNet Direct — giving suppliers first access to bids they won't find anywhere else."* The selling point is not that the notice is easier to find. It is that it cannot be found elsewhere.

**Two. Aggregation is prohibited by contract.** Terms of use in this sector routinely bar *"any robot, spider, data scraping, crawler or other extraction tool,"* prohibit redistribution, and specifically forbid use *"for purposes of commercial data aggregation."* The information is public. The compiled version of it is contractually fenced.

**Three. Nothing is portable.** We examined nine widely used commercial eProcurement and bid-distribution platforms. **Not one publishes an open API or feed of open solicitations.** A city that wants its own notices to travel further has no supported technical path to send them anywhere.

The layer has also consolidated. Three private-equity-backed groups now hold most of the major platforms, each having changed hands within the last six years. This is a market being assembled, not a set of independent local services.

---

## When it reached a courtroom

In September 2020, a bid-monitoring company filed suit in Minnesota district court against **Ramsey County** and a bid-distribution vendor, alleging it could not obtain public bid documents from either party.

The complaint describes the experience directly: the county *"told BidPrime to request the documents from DemandStar, which, in turn, sent BidPrime back to Ramsey"* — the requester *"bounced between the defendants, each time coming up emptyhanded."*

**In November 2020, Ramsey County agreed to a stipulated injunction and stopped withholding the bid documents.**

That is the thesis of this paper as a documented event rather than an argument. A public record became practically unreachable because a private intermediary sat between the requester and the government that created it — and it took litigation to restore access.

*We note the limits of this example carefully. The stipulated injunction resolved the matter as to the county. The final disposition of the claims against the vendor is not publicly documented, and we make no assertion about it. The point here is not that any company acted unlawfully; it is that the structure produced an outcome in which public documents could not be obtained from anyone.*

---

## Where the analogy holds, and where it breaks

The comparison to Zillow is useful, and it is also imperfect. Both parts matter.

**Where it holds.** Zillow began with public records and no cooperation from the incumbent, built an audience on that foundation, and only later received the listings directly. When its largest syndication feed was cut off in April 2015, its listing count fell by less than 12% — by then it had signed agreements with more than seventy MLSs directly. **The audience came first; the data followed.** A brokerage that pulled its listings in 2011 restored them in 2014, citing the portal's reach.

Critically, Zillow charged **agents**, not consumers. Listings and search were free permanently. The side of the market with something to sell paid; the side looking for information did not.

**Where it breaks — three objections a procurement director should raise.**

*"Zillow had to fight for data it had no legal right to. You say bid notices are already public. If it were that easy, why doesn't this exist?"*

Fair, and the honest answer is that the barrier was never legal. It is contractual and commercial — exclusivity arrangements and anti-aggregation terms, not public-records law. That is a lower wall than Zillow faced, but it is a real one, and it explains the gap.

*"Zillow's data quality was poor early on. Stale listings are worse in procurement than in real estate."*

Correct, and this is the strongest objection. A 2012 industry study found a substantial share of Zillow's active listings were no longer for sale. **A vendor who prepares a bid for a closed solicitation blames the city, not the aggregator.** For a bid map, freshness is not a feature — it is the entire product. Any city considering this should ask exactly how listings are kept current and what happens when one goes stale.

*"Zillow monetized agents. Your analog is monetizing our vendors — which is the thing we object to."*

Here the analogy cuts the other way. Zillow charged the supply side and kept the public side free. Charging vendors to see public notices is the arrangement being displaced, not replicated.

---

## What this costs the city

This is not principally a fairness argument. It is a pricing argument.

Research at Yale, Columbia and UC Berkeley — funded by the U.S. Department of Transportation and the National Bureau of Economic Research — found that deliberate outreach to widen the bidder pool is associated with **17.6% lower project costs**, and that **70% of states rarely do it.** Procurement officials surveyed for that study named thin competition as a cost driver repeatedly and unprompted.

Public procurement typically draws **two to three bids**. Every barrier between a published notice and a qualified firm reduces that number further, and the reduction shows up in what the city pays — on every award, permanently.

**An access toll between a city's notice and its market is a tax the city pays without receiving the revenue.**

---

## What a city can do about it

Cities have more room here than most assume.

**Additional publication is expressly authorized.** California's public contract code permits an agency to *"give such other notice as it deems proper."* Ohio's permits notice *"distributed by electronic means."* Virginia's contemplates posting on *"other appropriate websites."* We found no statute, case, or attorney-general opinion suggesting a city takes on risk by *also* publishing its notices more widely.

**The exposure runs the other direction.** A city that posts only to a third-party platform, and not through its required channel, has a defective solicitation. Publishing more broadly is the conservative choice, not the adventurous one.

**Exclusivity is a choice, not a requirement.** Where a platform's terms restrict where a city's own notices may appear, that is a contractual term the city agreed to and can renegotiate. Cities routinely require that their public records remain publicly reachable; the same principle applies to a bid notice.

---

## Our position

**Mindy publishes municipal, county and district solicitations on a free public map.** Cities post at no cost. Businesses search at no cost. No subscription, no per-document charge, no login between a public notice and the public that paid for it.

We are onboarding cities one at a time, and publishing what we learn as we go — including bid counts and local award share, which currently exist nowhere as public statistics.

**One commitment, stated plainly, because the obvious question about a free service is what happens once it has the inventory:** public bid notices posted to Mindy remain free to find, free to search, and free to receive. If we ever build paid products, they will not be a toll on access to public procurement information. That is the arrangement this paper argues against, and we are not interested in becoming the next version of it.

---

## Sources

**Access-layer pricing and terms**
DemandStar / Euna OpenBids published supplier pricing, government pricing, and terms of use (accessed 2026). SOVRA / BidNet Direct supplier marketing materials (2026). Platform API and feed availability assessed across nine commercial eProcurement and bid-distribution platforms.

**Litigation**
*BidPrime Inc. v. DemandStar Corp. and Ramsey County*, Minnesota District Court, Case No. 62-CV-20-4751 (filed September 18, 2020). Stipulated injunction as to Ramsey County, November 2020. *Final disposition as to DemandStar is not publicly documented; no claim is made regarding it.*

**Procurement cost and competition**
Liscow, Z., Nober, W., & Slattery, C., *Procurement and Infrastructure Costs* (July 2024), funded by U.S. DOT and NBER. Outreach finding p. 25, Appendix Table E.1 (Romano-Wolf adjusted p = 0.01); 70% figure p. 17, Appendix Figure C.2; official quotation p. 17. *Scope: state highway resurfacing, projects begun 2018–2019 — the mechanism transfers; the dollar magnitudes should not be applied to a municipal budget.*
Open Contracting Partnership (April 2025) — two-to-three bids observation; cross-jurisdictional, not a U.S. municipal statistic.

**Publication authority**
Cal. Pub. Contract Code § 22037; Ohio Rev. Code § 731.14; Va. Code § 2.2-4302.1(2).

**Zillow precedent**
Zillow Group Form S-1 and subsequent public filings; industry reporting on ListHub syndication termination (April 2015) and brokerage listing restoration (2014); WAV Group listing-accuracy study (2012) — *commissioned by a Zillow competitor, and we note that in citing it.*

---

*GovCon Giants · Mindy — getmindy.ai*

## The access layer, in its own words

## 1. The two-sided pitch — the whole model in two quotes

**What they tell governments:**

> "DemandStar is free for governments. We believe procurement software should save you money, not cost you money."
> — *DemandStar pricing page*

**What they charge vendors:**

| Tier | Price |
|---|---|
| Free | **One agency**, plus **$5 per document** downloaded |
| County | $60 / year |
| State | $100 – $1,499 / year |
| National | **$2,699 / year** |

> — *DemandStar supplier pricing page*

**Both statements are true at the same time. It is free to governments because it is not free to vendors.**

That is not a criticism of the company — it is a description of the business model, published by the business. The question this raises is not whether aggregation has value. It is who pays for it, and what it costs the city whose notice started the chain.

---

## 2. They ask the question themselves

The single most useful line in this entire body of evidence. From their own FAQ:

> **"Why are bid downloads outside my subscription area $5? Isn't that public information?"**
> — *DemandStar FAQ*

They posed the objection unprompted, because vendors ask it often enough to warrant an entry. Their answer is that the charge covers convenience rather than the information itself — a defensible position.

**But the question is theirs, not ours.** When the gatekeeper concedes the question is reasonable, we do not have to argue that it is.

---

## 3. Exclusivity marketed as the product

> "It goes **exclusively** on BidNet Direct — giving suppliers first access to bids they won't find anywhere else."
> — *SOVRA / BidNet Direct supplier marketing*

Read that as a vendor pitch and it is a benefit. Read it as a city and it is the opposite of what a solicitation is for.

**The selling point is not that the notice is easier to find. It is that it cannot be found anywhere else.** A public notice's entire purpose is reach; here, restricted reach is the feature being sold.

---

## 4. Aggregation prohibited by contract

> Terms of use bar "any robot, spider, **data scraping**, crawler or other extraction tool," prohibit redistribution, and forbid use "for purposes of **commercial data aggregation**" or by "our direct competitor."
> — *DemandStar terms of use*

The underlying notices are public records. **The compiled version is fenced by contract.**

This is the mechanism that keeps the fragmentation in place. Not public-records law — no statute prevents anyone from collecting public notices. A commercial agreement does.

---

## 5. Nothing is portable

**Of nine widely used commercial eProcurement and bid-distribution platforms, not one publishes an open API or feed of open solicitations.**

Platforms assessed: OpenGov, PlanetBids, Vendor Registry, bids&tenders, Euna (Bonfire / Ionwave / OpenBids), SOVRA / BidNet, BidSync, Public Purchase.

A city that wants its own notices to travel further has **no supported technical path to send them anywhere.**

*Two precision notes, so this claim survives a fact-check:*
- *Euna advertises "150+ API routes." Those are internal ERP integration endpoints, not an open bid feed. Easiest error in this space.*
- *Some platforms return HTTP 403 to automated requests. That is bot-blocking, not a login wall — do not describe it as gating.*

---

## 6. Their scale claims work in our favor

> Euna Solutions: **3,000+ customers, 1.25M+ suppliers**
> SOVRA: **7,000 public entities, 1M vendors**

Cite these as evidence that **the demand is real and already at scale.** We are not arguing that nobody wants aggregated bid information — plainly millions of suppliers do.

We are arguing that the layer serving that demand meters access to public records, and that the city publishing the notice absorbs the cost in a thinner bidder pool.

*Note: third-party sources claim ~1,400 agencies for DemandStar while the company's own page says "hundreds." Use their number.*

---

## 7. The consolidation, dated

Three private-equity-backed groups now hold most of the layer. Every major platform changed hands within six years:

| Group | Backer | Holdings |
|---|---|---|
| **Euna Solutions** | GI Partners | Bonfire, Ionwave, DemandStar, EqualLevel |
| **SOVRA** | KKR | Periscope, BidNet Direct, Vendor Registry, Merx, S2G |
| **OpenGov** | Cox Enterprises (majority investment, Feb 2024) | ProcureNow |

**This is a market being assembled, not a set of independent local services.**

*Date every claim — these names change. Periscope became SOVRA in 2024; DemandStar became Euna OpenBids in 2025. Use current names with the former name in parentheses on first mention.*

---

## The block, compressed to three sentences

For when you need the argument in a paragraph rather than a page:

> One major bid-distribution service tells governments it is **"free for governments"** while charging vendors **$5 per document** and up to **$2,699 a year** for access to those same public notices. Its own FAQ poses the obvious question — **"Isn't that public information?"** — and its terms of use separately prohibit **"commercial data aggregation."** A competing network sells the arrangement to suppliers as **"exclusively on BidNet Direct — giving suppliers first access to bids they won't find anywhere else."**

---

## Usage rules

**Do use:** anything above. It is published, quoted accurately, and attributed to the source.

**Handle with counsel:** the *BidPrime v. DemandStar and Ramsey County* litigation (Minn. Dist. Ct., Case No. 62-CV-20-4751). Ramsey County's November 2020 stipulated injunction is documented. **The final disposition as to DemandStar is not publicly documented** — never imply an adverse finding against the company. It is the most vivid material available and the only piece carrying real risk; the quotes above make the argument without it.

**Never:** characterize any company as acting unlawfully. The argument is structural, not accusatory — the layer produces bad outcomes for cities while every participant behaves rationally within it. That framing is both more accurate and more persuasive to a procurement audience, who will have working relationships with these vendors.

**Always:** verify pricing before publishing. These are live commercial pages and rates change.

---

*GovCon Giants · Mindy — internal evidence reference*
`;

const MD_90887_FRONT_DOORS = `# 90,887 Front Doors

### Federal contracting has one place to look. State and local government has ninety thousand.

**A GovCon Giants / Mindy white paper for public procurement officials and city leadership**
Draft — August 2026

---

## The short version

A business that wants to sell to the federal government goes to one website. Registration is in one system. Opportunities are posted in one place. There is a single front door, and every federal buyer is behind it.

A business that wants to sell to state and local government faces **90,887 separate purchasing entities** — and no equivalent front door at all.

That number is not an estimate. The U.S. Census Bureau counts governments every five years, and the 2022 Census of Governments found:

| Type | Count |
|---|---|
| Counties | 3,031 |
| Municipalities | 19,491 |
| Towns and townships | 16,214 |
| Independent school districts | 12,546 |
| **Special districts** | **39,555** |
| **Total** | **90,887** |

**More than half of those — 52,101 — are special-purpose governments**: school districts, water authorities, transit agencies, fire districts, utility districts, port authorities. These are real buyers with real budgets, and a vendor would never think to check most of them. The Census also excludes 1,313 dependent school systems from this count, so the number of actual purchasing bodies is arguably higher.

This paper is about what that structure costs — and it is not primarily a cost to vendors. It is a cost to the governments doing the buying.

---

## The comparison worth drawing

In fiscal year 2024, federal contract obligations totaled approximately **$755 billion**, according to the Government Accountability Office.

State and local government purchasing is substantially larger. We are deliberately not putting a single dollar figure next to it, and the reason is instructive: **no clean number exists.** The commonly cited figures either measure total government expenditure — which includes salaries, Medicaid transfers and debt service, none of which are procurement — or come from vendor marketing materials without published methodology. We looked for an authoritative procurement-specific figure and could not find one.

That absence is itself part of the story. **We can say precisely what the federal government buys because it flows through one system that produces one dataset.** Nobody can say what American cities, counties and districts buy in aggregate, because there is no system that would know.

So the honest comparison is not dollar-to-dollar. It is architectural:

**$755 billion flows through one front door. A larger sum flows through 90,887 of them, and no one is counting.**

---

## What this costs the buyer

The intuitive reading is that fragmentation is a vendor problem — an inconvenience for businesses that have to check many places. That reading is incomplete.

Fragmentation raises what governments pay, through a direct mechanism: **the harder your solicitation is to find, the fewer bids you receive, and thin bidder pools cost money.**

Research at Yale, Columbia and UC Berkeley, funded by the U.S. Department of Transportation and the National Bureau of Economic Research, found that deliberate outreach to widen the bidder pool is associated with **17.6% lower project costs** — and that **70% of states rarely do it.** Public procurement typically draws **two to three bids per solicitation**.

When those researchers asked officials to name what drives costs up, thin competition came back repeatedly — and unprompted.

Every additional front door is a place a qualified firm might not know to knock. Multiply that across 90,887 entities and the aggregate effect is not inconvenience. It is a structurally thin market, everywhere, all the time.

*(That study covers state highway resurfacing, so the dollar magnitudes should not be transplanted onto a municipal budget. The mechanism does not depend on asphalt.)*

---

## Why no front door emerged

Federal procurement has a single system because federal law created one. State and local procurement has no equivalent because **no law requires it**, and the obligation that does exist points somewhere else entirely.

Publication requirements are set at the state level, and the typical standard is publication in a **"newspaper of general circulation."** These provisions are genuinely old. Florida's traces to **1877**. Texas's current version dates to **1987** and has not been substantively amended since 1993. They were written when a newspaper was how information reached a community, and most have never been revisited.

Some states have modernized. **Virginia** (2013) makes website posting mandatory and newspaper publication optional. **Florida** (2021–22) made website publication co-equal and now requires that a bid advertisement on a government website *"include a method to accept electronic bids."* Most states have not followed.

**No state requires its cities to post to a statewide portal.** Several states run one for their own agencies — Texas operates a searchable electronic bid board for state purchases while Texas cities remain on a 1987 newspaper standard. The gap is not oversight. It is simply that nobody legislated across it.

---

## What filled the vacuum

Where no public front door exists, a private one gets built — and it charges admission.

Commercial aggregators collect notices from thousands of separate sources and sell access to the compiled result. Published rates from one major service: a free tier covering **a single agency**, **$5 per document** downloaded outside a subscription area, up to **$2,699 per year** for national coverage.

Three features of this layer follow directly from the fragmentation:

**Aggregation is valuable precisely because it is hard.** Ninety thousand sources is a genuine engineering problem, and solving it creates something worth money. That is a legitimate business.

**But the value depends on the fragmentation persisting.** An aggregator's product is the compilation. Terms of use in this sector routinely prohibit *"data scraping"* and use *"for purposes of commercial data aggregation."* One network markets exclusivity directly to vendors: solicitations that go *"exclusively on BidNet Direct — giving suppliers first access to bids they won't find anywhere else."*

**And nothing is portable.** Of nine widely used commercial eProcurement and bid-distribution platforms, **not one publishes an open API or feed of open solicitations.** A city that wants its notices to travel further has no supported technical path to send them anywhere.

**The result is a market where the intermediaries have a commercial interest in the front door never being built.**

---

## The one city that tried the alternative

The Open Contracting Data Standard is an international format for publishing procurement information in a structured, machine-readable, freely reusable way. Adoption in the United States is close to nonexistent.

**Portland, Oregon is the first and only U.S. city publishing to the standard.** Of 134 datasets in the international registry, exactly **one is American** — roughly 0.75% of global publishers, one city out of approximately 90,000 U.S. local governments.

Portland's experience explains the adoption rate. Producing the feed required assembling data from **four or more separate internal systems**. That is the work in front of any city that wants its procurement data to be openly usable — and most cities do not have the staff to do it once, let alone maintain it.

**The barrier is not willingness. It is that every city is being asked to solve the same problem independently, with no shared infrastructure and no requirement that would justify the budget.**

---

## What follows

Fragmentation is not going to be legislated away. Ninety thousand governments will not adopt a common system, and no authority exists to make them.

But the practical problem is narrower than the structural one. A city does not need every other city to change anything. It needs its own notices to be findable by firms that do not already know it exists — which is a distribution problem, not a governance problem, and it can be solved one city at a time.

Three things make that tractable:

**Additional publication is expressly authorized.** California's code permits an agency to *"give such other notice as it deems proper."* Ohio's permits notice *"distributed by electronic means."* Virginia's contemplates *"other appropriate websites."* No authority we found suggests a city takes on risk by publishing more widely — and a city that posts *only* to a third party has a defective solicitation.

**The marginal cost is near zero.** Publishing a notice a second place is not a procurement reform, a system migration or a budget line. It is a copy of information the city has already produced and is already required to release.

**The benefit is measurable.** More firms aware of a solicitation is more bidders, and the research on what that does to price is consistent in direction even where it varies in magnitude.

---

## Where we fit

**Mindy publishes municipal, county and district solicitations on a free public map.** Cities post at no cost. Businesses search at no cost. No subscription, no per-document charge, no login between a public notice and the public that paid for it.

We are building the front door that the structure never produced — one city at a time, and publishing what we learn as we go.

---

## Sources

**Entity counts**
U.S. Census Bureau, *2022 Census of Governments — Organization Component*, released August 24, 2023. 90,887 total; 3,031 counties; 19,491 municipalities; 16,214 towns/townships; 12,546 independent school districts; 39,555 special districts. Excludes 1,313 dependent school systems.

**Federal contract spending**
U.S. Government Accountability Office, *A Snapshot of Government-Wide Contracting for FY 2024* (June 24, 2025). Approximately $755.1 billion.

**On the absence of a state/local procurement figure.** Commonly cited totals measure government *expenditure* rather than procurement, or originate in vendor marketing without published methodology. We could not locate an authoritative procurement-specific aggregate and have not published one.

**Procurement cost and competition**
Liscow, Z., Nober, W., & Slattery, C., *Procurement and Infrastructure Costs* (July 2024), funded by U.S. DOT and NBER. Outreach finding p. 25, Appendix Table E.1 (Romano-Wolf adjusted p = 0.01); 70% figure p. 17, Appendix Figure C.2; official quotation p. 17. Scope: state highway resurfacing, projects begun 2018–2019.
Open Contracting Partnership (April 2025) — two-to-three bids observation; cross-jurisdictional, not a U.S. municipal statistic.

**Publication requirements and authority**
Fla. Stat. § 50.011 and § 50.0311(9); Tex. Loc. Gov't Code § 252.041; Va. Code § 2.2-4302.1(2); Cal. Pub. Contract Code § 22037; Ohio Rev. Code § 731.14.

**Open contracting adoption**
Open Contracting Partnership Data Registry; City of Portland OCDS publication policy, covering April 2015–March 2026.

**Access layer**
DemandStar / Euna OpenBids published supplier pricing and terms of use (accessed 2026); SOVRA / BidNet Direct supplier marketing (2026); API and feed availability assessed across nine commercial platforms.

---

*GovCon Giants · Mindy — getmindy.ai*
`;

const MD_WHO_ISNT_BIDDING = `# Who Isn't Bidding on Your City's Contracts

### The number one reason firms don't bid is that they never heard about it — and it costs you on every award

**A GovCon Giants / Mindy white paper for mayors, councils and city administrators**
Draft — August 2026

---

## The short version

When a city asks businesses why they don't bid on its contracts, the top answer is not price, paperwork, bonding or capacity.

**It is that they never knew the opportunity existed.**

In 2022 the City of Raleigh commissioned a study that surveyed businesses directly. Among firms that had not bid, the most-cited reason was *"no notice of bids from the City of Raleigh"* — selected by **52% of white male-owned firms, 48% of female-owned firms, and 43% of minority-owned firms.**

Read that distribution carefully, because it is the finding that matters. **The most established, best-connected category of vendor cited the notice problem more than anyone else.** This is not a story about which businesses are disadvantaged. It is a story about a city's notices not reaching the market — all of it.

That has a price. Thin bidder pools cost money on every award, and the research on how much is unusually clear.

---

## What a thin pool costs

Researchers at Yale, Columbia and UC Berkeley, funded by the U.S. Department of Transportation and the National Bureau of Economic Research, surveyed procurement officials in all fifty states and matched their answers against project cost data.

**The practice most strongly associated with lower costs was bidder outreach** — the deliberate work of telling qualified firms a solicitation exists:

> "A one standard deviation (12 percentage point) increase in bidder outreach is correlated with a 17.6% decrease in costs… a decrease in costs of $65,000 per lane-mile and $1 million at the project level."

**And 70% of states rarely do it.**

That study covers state highway resurfacing, not municipal purchasing, so the dollar magnitudes should not be transplanted onto a city budget. The mechanism does not depend on asphalt: a solicitation that draws one bidder is a pricing problem in any category, and a solicitation nobody knows about is the cheapest possible way to end up with one bidder. One state procurement official, answering in their own words, put it plainly — *"a single bidder can 'try to name their price."*

The scale of the gap is worth stating. Public procurement typically draws **two to three bids** — an observation across open-contracting jurisdictions, not a U.S. municipal statistic, since no such statistic exists. Most public buyers are operating well below the point where added competition stops producing savings.

**The goal is not a bigger number for its own sake.** The research does not support chasing bidder counts indefinitely; there is credible work showing that past a certain point, additional bidders can bid less aggressively rather than more. The money is at the bottom of the range, not the top. **Moving a solicitation from one bidder to four is where the savings live** — and that is the move almost every public buyer has available.

---

## The industrial base problem underneath

There is a second cost, slower and harder to reverse.

A contractor base is not fixed. Firms enter public work when it looks reachable and worth pursuing; they exit when it doesn't. And once they exit, they do not come back quickly — capacity, bonding relationships and estimating staff are expensive to rebuild.

Procurement officials describe this as a loop, and they describe it unprompted: limited work thins the contractor base, a thinner base means less competition, and less competition raises what the government pays. One official surveyed in the DOT-funded research above traced that chain explicitly, ending on the observation that years of limited work had driven contractors out of the business entirely.

That erosion is measurable. Census data shows that between 2007 and 2017, **almost 70% of states lost highway construction establishments** — the median state down 13%. Public work is a market, and markets that are hard to find your way into get smaller.

Every year a capable firm does not hear about your solicitations is a year it builds its business around private-sector work instead. The pool does not thin all at once. It thins by attrition, invisibly, and the bill arrives later as fewer bidders and higher prices on work the city has no choice but to buy.

**Reaching more firms is not only a price mechanism. It is how a local contractor base is maintained** — and where those firms are local, the contract dollars recirculate: local hiring, local suppliers, local tax base. A contract awarded outside the region does none of that.

---

## Why the notices don't reach anyone

Cities are required to advertise solicitations publicly, and they do. The problem is what the requirement asks for.

In much of the country the statutory standard is publication in a **"newspaper of general circulation."** These provisions are old — Florida's traces to **1877**; Texas's current version dates to **1987** and has not been amended since 1993. They were written for a period when a newspaper was how information reached a community.

Some states have modernized. **Virginia** (2013) makes website posting mandatory and newspaper publication optional. **Florida** (2021–22) made website publication co-equal and requires that a public bid advertisement on a government website *"include a method to accept electronic bids."* Most states have not followed.

The result is that a city can be **fully compliant and effectively invisible.** A newspaper notice reaches subscribers. A department website reaches firms that already know the department exists. Neither reaches a qualified contractor two counties over who has never bid on your work and does not know your portal exists.

Compliance and reach are not the same thing. Only one of them affects what you pay.

**Worth knowing: the legal risk runs the other direction from what most cities assume.** Additional publication is expressly authorized — California's code permits a public agency to *"give such other notice as it deems proper,"* Ohio's permits notice *"distributed by electronic means,"* Virginia's contemplates *"other appropriate websites."* We found no statute, case or attorney-general opinion suggesting a city incurs risk by *also* publishing elsewhere. The exposure lies in under-publishing, not over-publishing.

---

## And then the notice gets sold back

There is a further layer between a city's notice and the firms that would bid on it.

A public bid notice is public information by law. Commercial aggregators collect those notices, place them behind a subscription, and sell access — frequently to the small businesses that would otherwise have to monitor dozens of separate portals by hand.

One major aggregator's published rates: a free tier covering **a single agency**, **$5 per document** downloaded outside a paid subscription area, and up to **$2,699 per year** for national coverage. Its own FAQ poses the question a vendor would ask — *"Why are bid downloads outside my subscription area $5? Isn't that public information?"* — and answers that the charge is for convenience. Its terms of use separately prohibit scraping, redistribution, and use *"for purposes of commercial data aggregation."*

This is not a fringe arrangement. Of nine widely used commercial eProcurement and bid-distribution platforms, **not one publishes an open feed of open solicitations.**

In 2020 the consequences reached a courtroom. A bid-monitoring company sued **Ramsey County, Minnesota** and an aggregator after being unable to obtain bid documents from either — the county directing it to the vendor, the vendor directing it back to the county, the requester, in its filing, *"bounced between the defendants, each time coming up emptyhanded."* **In November 2020 the county agreed to a stipulated injunction and stopped withholding the documents.**

For an established contractor, a subscription is a line item. For a small firm deciding whether public work is worth pursuing at all, it is a toll in front of information the city already paid to publish. **The city absorbs the cost of that toll in a thinner bidder pool — and it is the city, not the aggregator, that pays the higher price.**

---

## A note on where this evidence comes from

The Raleigh survey sits inside a disparity study. So does most of what any city knows about non-bidders.

That is an accident of history rather than a statement about the problem. Cities commission disparity studies to build a legal record, and those studies happen to be **the only exercise in American local government that systematically asks businesses why they did not bid.** Nobody funds a survey called *"why is our bidder pool thin."* So the question gets asked inside a document about something else, and the answer — notice failure, cited first, by every category of firm — surfaces almost incidentally.

Boston's 2020 study, covering roughly **$2.2 billion** in contracts, is where we learned that a major American city's bid-advertising process still included physical posting at City Hall. That is a procurement fact, found in a document commissioned for another reason entirely.

Which is worth saying plainly: **the underlying problem is a distribution failure, and it shows up wherever anyone thinks to look for it.** These studies are our evidence, not our argument.

The more striking fact is what does not exist:

**No national dataset tracks how many bids a typical municipal solicitation receives.** No federal agency collects it, no association publishes it, no academic study establishes a baseline. The only precise figures in circulation come from the marketing materials of companies selling bid-notification services.

So a purchasing director cannot answer whether two bids is normal or alarming. There is no benchmark — and the organizations best positioned to publish one sell access to the underlying data.

*(The only national survey on the awareness question we could verify is from 2003, which predates modern federal procurement systems entirely. We are not citing it as current.)*

---

## What actually moves the number

In rough order of cost:

**1. Make solicitations findable outside your own website.** A firm should be able to discover your open bids without knowing your department's name or your portal's URL.

**2. Publish where businesses already look.** Compliance publishing satisfies a statute. Reach publishing is aimed at someone who does not yet know you exist. They are different activities.

**3. Remove cost between the notice and the bidder.** If a firm must pay a third party to learn what your city published publicly, your reach is limited to firms with a subscription budget.

**4. Then do targeted outreach.** This is where the measured savings sit — and it works far better when the underlying notices are already easy to find and share.

**5. Measure what you currently cannot see.** Bids per solicitation. Share of awards to firms within the region. First-time bidders per year. No national benchmark exists for any of these, but a city that tracks them can manage them — and can show a council real movement instead of an intention.

---

## Where we fit

**Mindy publishes municipal, county and district solicitations on a free public map.** Cities post at no cost. Businesses search at no cost. There is no subscription between a public notice and the public that paid for it.

We are onboarding cities one at a time and publishing what we learn — including bid counts and local award share, which currently exist nowhere as public statistics.

---

## Sources

**Survey evidence on why firms don't bid**
Miller3 Consulting, *City of Raleigh Disparity Study* (published April 2023; fielded August–September 2022). "No notice of bids" figures: Q27aa, Table 8.34. *Caveat: approximately 3% response rate (422 of 13,964 invited), self-selected sample, margin of error ±5.8% to ±10.2%.*
BBC Research & Consulting, *2020 City of Boston Disparity Study* (February 2021). Approximately $2.2 billion in contracts; source of the bid-advertising process description.

**Procurement cost and competition**
Liscow, Z., Nober, W., & Slattery, C., *Procurement and Infrastructure Costs* (July 2024), funded by U.S. DOT and NBER. Outreach finding p. 25, Appendix Table E.1 (Romano-Wolf adjusted p = 0.01); 70% figure p. 17, Appendix Figure C.2; official quotations p. 17; contractor-base decline p. 17, Figure 7 (US Census Bureau 2007/2012/2017, NAICS 2373 — almost 70% of states lost establishments, median state −13%). Scope: state highway resurfacing, projects begun 2018–2019.
Open Contracting Partnership (April 2025) — two-to-three bids observation; cross-jurisdictional, not a U.S. municipal statistic.

**Publication requirements**
Fla. Stat. § 50.011 and § 50.0311(9); Tex. Loc. Gov't Code § 252.041; Va. Code § 2.2-4302.1(2); Cal. Pub. Contract Code § 22037; Ohio Rev. Code § 731.14.

**Aggregation and access**
DemandStar / Euna OpenBids published supplier pricing and terms of use (2026). *BidPrime Inc. v. DemandStar Corp. and Ramsey County*, Minn. Dist. Ct., Case No. 62-CV-20-4751 (filed September 2020; stipulated injunction as to Ramsey County, November 2020). *The final disposition as to DemandStar is not publicly documented and we make no claim about it.*

**On what we could not find.** No modern national statistic exists on the share of businesses unaware of local government bid opportunities; the only verified national survey dates to 2003. No national dataset tracks bids per municipal solicitation. Where we say a figure does not exist, we mean we could not locate it in any government, academic or association source.

---

*GovCon Giants · Mindy — getmindy.ai*
`;

const MD_BIDDER_POOL_SHRINKING = `# The Bidder Pool Is Shrinking

### Your own commissioned research names the highest-return fix. Seventy percent of states aren't using it.

**A GovCon Giants / Mindy white paper for state departments of transportation and federal highway program leadership**
Draft — August 2026

---

## The short version

In July 2024, researchers at Yale, Columbia and UC Berkeley published a study of what actually drives highway construction costs. It was funded by the **U.S. Department of Transportation** and the **National Bureau of Economic Research**. The authors surveyed **123 procurement officials across all fifty states and the District of Columbia**, surveyed 211 contractors, and matched the responses against cost data from 250 resurfacing projects.

Three findings sit at the center of it.

**First:** the practice most strongly associated with lower project costs is **bidder outreach** — the deliberate work of telling qualified firms a solicitation exists. A one-standard-deviation increase is correlated with a **17.6% decrease in costs**: roughly **$65,000 per lane-mile, $1 million on a project.**

**Second:** **70% of states rarely do it.**

**Third, and least discussed:** the contractor base itself is contracting. Between 2007 and 2017, **almost 70% of states lost highway construction establishments**, with the median state down **13%** — a loss of roughly seventeen firms.

This is not an outside critique. It is DOT-funded research describing state DOT practice. This paper is about the gap between what it found and what most states currently do.

---

## The finding, stated precisely

From the paper:

> "States that do outreach to increase the bidder pool have significantly lower costs, highlighting both the importance of competition and the role the DOT can play in order to increase competition. A one standard deviation (12 percentage point) increase in bidder outreach is correlated with a 17.6% decrease in costs. At the mean, this translates to a decrease in costs of $65,000 per lane-mile and $1 million at the project level."

And the gap:

> "Despite the focus on competition and contractor availability in the free response, 70% of states rarely do bidder outreach."

**This result is unusually durable.** When researchers test many variables at once, some appear significant purely by chance; the correction is a multiple-hypothesis adjustment, which most findings do not survive. This one does — **Romano-Wolf adjusted p = 0.01**. Among everything the study examined, outreach is one of the most statistically robust relationships in it.

The authors also identify where in the process this lever sits. Their own description of the bid-letting stage:

> "The DOT has discretion over when and where to post the call for bids, and over any bidder outreach efforts."

**Discretion, not statute.** No legislature has to act. No rule has to change. It is already inside the agency's authority.

---

## What officials said in their own words

The researchers asked an open question — what raises construction costs? — and let procurement officials answer freely. Two responses, verbatim:

> "Competition: Costs tend to rise when the number of bidders falls (e.g., a single bidder can 'try to name their price). Number of bidders tends to fall as the market reaches capacity."

> "Limited funds cause limited projects cause limited contractors cause limited competition. Years of limited work has caused many contractors to get out of the business. Now we have very few contractors. Limited competition causes higher prices."

That second answer is a description of a **doom loop**, written by someone inside it. Fewer projects thin the contractor base; a thinner base means less competition; less competition means higher prices; higher prices buy fewer projects.

The study's establishment data confirms it is not a perception. Almost 70% of states lost highway construction firms between 2007 and 2017. **The market these officials are describing has, in most states, measurably shrunk.**

---

## Why the fix goes undone

The study offers two possible explanations for the 70%, and is careful not to choose:

> "This could be because the DOT has low capacity or willingness to do outreach, or because they know the market well and no other capable firms exist in the area."

The second reading is genuinely possible in some markets and should not be dismissed. But the paper's other findings point mostly at the first.

**A one-standard-deviation increase in DOT employment per capita is correlated with 16% lower costs** — drawn from Census administrative employment data rather than the survey, which makes it methodologically stronger than most of the study. Capacity and outreach tell the same story twice. **An office without people cannot perform the practice that saves the money.**

There is a structural reason outreach loses that fight. It is unbudgeted, unstaffed, and invisible in every metric a DOT reports. Nobody is measured on how many firms heard about a letting. They are measured on whether the letting happened on schedule. Outreach is the work that gets cut first and shows up in the cost data last — a year later, as a bid that came in high because only two firms showed up.

---

## The mechanism is friction, not persuasion

It is worth being precise about what outreach means here, because it is easy to imagine a sales campaign. It is closer to removing obstacles.

The study describes several places where a DOT's own process narrows the field:

- **Where and when the call for bids is posted** — explicitly at the agency's discretion
- **Pre-qualification requirements**, which a firm must complete before it can bid
- **Fees to access project plans** — the paper notes bidders "may have to pay a small fee in order to receive access to the project plans"
- **Subcontracting limits.** The study found that caps on how much work may be subcontracted are **positively correlated with costs**, because they shrink the set of prime contractors capable of taking the job at all

Each is defensible on its own terms. Together they form a filter, and the filter is invisible to the agency operating it — because the firms it excludes never appear in any record. **A DOT sees the bids it receives. It never sees the firms that looked once, encountered a barrier, and stopped looking.**

There is also precedent that outreach works as an intervention rather than a theory. The study cites work in **St. Paul, Minnesota** showing bidder outreach achieving exactly the effect the auction literature predicts.

---

## Timing

Two conditions make this more consequential now than when the research was published.

**Infrastructure funding is moving through the same constrained agencies.** More projects are being let by DOTs the study found to be capacity-limited and largely not performing outreach. Volume rising against a shrinking contractor base is the precise condition under which thin-bidder pricing shows up — and at scale, a percentage of a much larger program.

**The contractor base has not recovered.** The establishment decline runs through 2017. Nothing in the study suggests it reversed, and the officials surveyed describe firms that left the business and did not return. Capacity, bonding relationships and estimating staff are slow and expensive to rebuild. A firm that exits highway work does not re-enter because a letting appeared.

---

## What this paper does not claim

**We are not claiming more bidders is always better.** There is credible research showing that past a point, additional bidders anticipating a winner's curse bid less aggressively, and gains flatten. The money is at the bottom of the range, not the top. **Moving a letting from one or two bidders to four or five is where the evidence is strongest** — and given that public procurement typically draws two to three bids, that is the range nearly every agency is operating in.

**We are not claiming causation.** The authors are explicit: *"we can correlate specific procurement practices with cross-state data on resurfacing costs, with the acknowledgment that correlation is not causation."* We use "associated with," as they do.

**We are not using the study's per-bidder figure.** The paper also reports that one additional bidder is associated with 8.3% lower costs. We have deliberately not built on it: that coefficient appears only in a specification the authors themselves describe as **"over-controlling,"** drawn from 94 projects in 19 states, and in their cleaner specification the same relationship is statistically indistinguishable from zero. It is the number most often quoted from this paper. It does not survive its own source, so we leave it alone.

**Scope, stated plainly:** state and U.S. highway resurfacing, non-interstate, one to twenty miles, most contracts under $5 million, projects begun 2018–2019. The outreach finding is about resurfacing lettings — not bridges, not new construction, not design-build.

---

## What follows

If outreach is the highest-return lever, and the constraint is capacity rather than authority, then the practical question is what makes outreach cheap.

It fails for a mechanical reason before it fails for a budgetary one: **a letting has to be findable before anyone can be told about it.** An agency cannot conduct outreach to firms it cannot identify, and a firm cannot respond to a letting it never sees. Every barrier between the two — a portal that requires an account, a plan set behind a fee, a notice that lives only where existing bidders already look — narrows the pool before outreach begins.

The lowest-cost interventions are the ones that reduce that friction:

**1. Make lettings findable outside your own system.** A qualified firm in an adjacent state should be able to find your work without knowing your portal exists.

**2. Remove cost between the notice and the bidder.** Where plan access carries a fee, that fee is a filter — and it filters hardest on exactly the firms that would widen your pool.

**3. Re-examine subcontracting limits.** The study found these positively correlated with costs. They are usually adopted for good reasons; they should be re-examined against what they do to the prime pool.

**4. Then do targeted outreach.** This is where the measured savings sit, and it works far better when the underlying notices are already easy to find and share.

**5. Measure the pool, not just the letting.** Bids per letting. First-time bidders per year. Firms that pre-qualified and never bid. Most agencies do not track these, and what is not tracked cannot be managed.

---

## Where we fit

**Mindy publishes public solicitations on a free public map** — including state, county, municipal and district work. Agencies post at no cost. Contractors search at no cost. No subscription, no per-document charge, no login between a public notice and the firms that would bid on it.

**Public bid notices posted to Mindy stay free to find, free to search and free to receive.** An access toll between an agency's letting and its market is a cost the agency pays without receiving the revenue.

---

## Sources

**Primary**
Liscow, Z., Nober, W., & Slattery, C., *Procurement and Infrastructure Costs*, working paper, July 11, 2024. Funded by the U.S. Department of Transportation and the National Bureau of Economic Research.
— Outreach 17.6% / $65,000 per lane-mile / $1 million per project: pp. 4 and 25; Appendix Table E.1, Romano-Wolf adjusted p = 0.01.
— 70% of states rarely conduct outreach: p. 17, Appendix Figure C.2.
— DOT employment per capita, 16%: p. 4 (US Census Bureau public-sector Highways employment, 1997–2021).
— Establishment decline: p. 17, Figure 7 (US Census Bureau 2007, 2012, 2017; NAICS 2373, "Highway, Bridge, and Street Construction"). Almost 70% of states lost establishments; median state −13%, approximately 17 firms.
— Subcontracting limits positively correlated with costs: pp. 4 and 25.
— DOT discretion over posting and outreach; pre-qualification and plan-access fees: p. 8.
— Procurement official quotations: p. 17.
— St. Paul, Minnesota outreach precedent: p. 40, citing Government Performance Lab (2016) and Liebman & Azemati (2016).

**Scope.** State and U.S. highway resurfacing, non-interstate, 1–20 miles, most contracts under $5 million, projects begun 2018–2019. 250 projects with cost data; 123 procurement officials and 211 contractors surveyed.

**Deliberately not cited.** The paper's 8.3%-per-bidder figure, for the reasons stated above. The paper's employee-quality finding (28.6% higher costs) is not statistically significant after multiple-hypothesis adjustment — unadjusted p = 0.09, Romano-Wolf p = 0.21 — and we do not use it.

**Counter-evidence considered**
Hong, H., & Shum, M. (2002). "Increasing Competition and the Winner's Curse: Evidence from Procurement." *Review of Economic Studies*, 69(4), 871–898.
Open Contracting Partnership (April 2025) — two-to-three bids observation; cross-jurisdictional, not a U.S. statistic.

*This working paper should be checked for a later published version before citation in formal documents.*

---

*GovCon Giants · Mindy — getmindy.ai*
`;

export const INSTITUTE_PAPERS: Array<{ meta: PaperMeta; markdown: string }> = [
  {
    meta: {
      slug: "mls-problem",
      title: "The MLS Problem in Public Procurement",
      subtitle: "Your bid notices are public by law. Getting them is not free.",
      audience: "For public procurement officials and city leadership",
      number: "White Paper No. 2",
      description: "Bid notices are public by law, but the path to them runs through paid intermediaries. What the access layer charges, and what it costs the city that published the notice.",
      concept: { awaits: null }, // a discovery/access-coverage standard the Observatory has not yet defined
    },
    markdown: MD_MLS_PROBLEM,
  },
  {
    meta: {
      slug: "90887-front-doors",
      title: "90,887 Front Doors",
      subtitle: "Federal contracting has one place to look. State and local government has ninety thousand.",
      audience: "For public procurement officials and city leadership",
      number: "White Paper No. 3",
      description: "Federal = one front door; state and local = 90,887 fragmented purchasing entities with no equivalent. What that fragmentation costs the governments doing the buying.",
      concept: { awaits: null }, // a discovery/coverage standard the Observatory has not yet defined
    },
    markdown: MD_90887_FRONT_DOORS,
  },
  {
    meta: {
      slug: "who-isnt-bidding",
      title: "Who Isn't Bidding on Your City's Contracts",
      subtitle: "The number one reason firms don't bid is that they never heard about it.",
      audience: "For mayors, councils and city administrators",
      number: "White Paper No. 4",
      description: "The top reason firms don't bid is that they never knew the opportunity existed (Raleigh: 52% of white male-owned firms cited it). What a thin bidder pool costs on every award.",
      concept: { awaits: 'OBS-004', awaitsName: 'Attention concentration by agency' },
    },
    markdown: MD_WHO_ISNT_BIDDING,
  },
  {
    meta: {
      slug: "bidder-pool-shrinking",
      title: "The Bidder Pool Is Shrinking",
      subtitle: "Your own commissioned research names the highest-return fix. Seventy percent of states aren't using it.",
      audience: "For state departments of transportation and federal highway program leadership",
      number: "White Paper No. 5",
      description: "DOT-funded research: bidder outreach is correlated with 17.6% lower project costs, and 70% of states rarely do it. The gap between what the research found and what states do.",
      concept: { awaits: 'OBS-009', awaitsName: 'Competition depth' },
    },
    markdown: MD_BIDDER_POOL_SHRINKING,
  },
];
