# Opportunity Data Landscape — Sources Beyond SAM.gov (SLED + Federal-non-SAM)

**Purpose:** a sourced map of where to get more procurement opportunities (to grow counts), which
sources have a usable feed/API vs are scrape-or-license, and a recommended target order. Compiled
2026-07-18 from web research (every claim cited inline). Where a fact isn't public, it says so —
no fabricated coverage numbers (that's the whole point vs the competitors' vague "we scrape state
and local" claims).

## TL;DR — the decision

- **Do first (Eric's pick — tractable, real count bump): the FEDERAL non-SAM tier.** The standout is
  **DLA DIBBS** (~10,000+ RFQs/week, the single biggest pool missing from SAM.gov) — and **we already
  built it; the pilot is just PAUSED** on an Apify free-tier cap. Resume it via the **DLA bulk
  batch-download files** (faster/cheaper than the scraper). `FedConnect` is a secondary scrape.
- **Already done:** **Grants.gov** (federal grants) — we ingest it today (`grants-gov.ts`). Not a new win.
- **Skip:** **GSA eBuy** (GSA confirmed *no API*, schedule-holder-gated) and **Unison Marketplace**
  (closed, login-only). Not legitimately ingestible.
- **SLED (state/local) is a later, deliberate LICENSE decision — not a thing we're "behind" on.** No
  state exposes a live-bid API; the only real programmatic feeds are the **licensed brokers GovSpend
  and BidPrime**. Don't build a scraper farm to own commodity data.

---

## Tier 1 — Federal, NOT on SAM.gov (do first)

| Source | Access | Volume / what it adds | Verdict |
|---|---|---|---|
| **DLA DIBBS** ([dibbs.bsm.dla.mil](https://www.dibbs.bsm.dla.mil/)) | **No public REST API.** WAF-protected. But **authenticated bulk "batch download" files** of solicitations exist; third-party [Apify scraper](https://apify.com/parseforge/dibbs-rfq-scraper) is the other path. | **~10,000+ RFQs/week** ([DLA](https://www.dla.mil/Working-With-DLA/Applications/Details/Article/2921495/dibbs-dla-internet-bid-board-system/)) — NSN supply buys, many < $25k, **not synopsized on SAM.gov**. Largest single non-SAM pool. Product/manufacturing vendors. | **RESUME (built + paused).** See deep-dive below. |
| **Grants.gov** ([api.grants.gov/v1/api/search2](https://www.grants.gov/api/api-guide)) | **Real public REST API, no auth.** | Federal grants & cooperative agreements — thousands active. | **ALREADY INGESTED** (`grants-gov.ts`). No new work. |
| **FedConnect** ([fedconnect.net](https://www.fedconnect.net/)) | **No API.** Public "Search Public Opportunities" web UI only → scrape. | Cross-agency solicitations, DOE FOAs, full docs/amendments — often richer than SAM's synopsis. | **SECONDARY** — compliant scrape, moderate volume. |
| **GSA eBuy** ([ebuy.gsa.gov](https://www.ebuy.gsa.gov/)) | **No API — GSA confirmed:** *"we do not have an API for the e-Buy datasets"* ([GSA-APIs #37](https://github.com/GSA/GSA-APIs/issues/37)). Visible only to relevant **Schedule holders after login**. | Schedule/MAS RFQs (task/delivery orders). | **SKIP** — gated + no API, un-ingestible for an outsider. |
| **Unison Marketplace** (ex-FedBid, [unisonglobal.com](https://www.unisonglobal.com/product/marketplace)) | **No public API/RSS.** Vendor/agency login only. | Reverse auctions for simplified acquisitions (DoD/VA/DHS/USDA), many below SAT. | **SKIP** — closed. |
| **PIEE** ([piee.eb.mil](https://piee.eb.mil/)) | Has APIs (IUID etc.) but **item-ID / post-award only**, not opportunities. | — | **N/A** for opportunities. |
| Legacy **FBO** | Retired → folded into the SAM.gov Opportunities API. | No new data. | **N/A.** |

### DIBBS deep-dive — why it was slow, and how to resume

We built DIBBS already: `sync-dibbs` cron, `dibbs_rfqs` table (895 rows so far), `DibbsPanel` in `/app`,
migration `20260619_dibbs_rfqs.sql`. **Pilot paused in PR #234** (panel hidden). Two facts explain the
"used an API but it was slow":

1. **It's a hosted SCRAPER, not a DLA API.** `src/lib/dibbs/ingest.ts` calls the **Apify actor
   `parseforge/dibbs-rfq-scraper`** via a US **residential proxy** — because DIBBS is WAF-protected and
   only a residential proxy gets through. Scraping through a proxy to dodge the WAF is inherently slow.
2. **The binding limit was a billing ceiling, not the data.** The Apify account is on the **FREE tier =
   hard-capped at 10 items/run** (the code detects and warns about exactly this). That's why only 895
   rows landed. Paid Apify lifts it to up to **1,000,000/run**.

**Resume paths (decide between these):**
- **A — pay Apify, re-run.** Known-working, fastest to test the 10-cap lifts and volume flows. Ongoing
  cost + dependency on a third-party scraper. Still proxy-scrape-slow.
- **B — switch to the DLA bulk batch-download files.** One file vs thousands of page fetches → far
  faster and WAF-friendlier, and it's DLA's own distribution. ⚠️ Access/auth/WAF from a server is
  **TBD** — needs a spike to confirm the files are pullable (may still need the residential proxy for
  the single download). **Recommended to evaluate first; fall back to A.**

---

## Tier 1b — FFRDC / national-lab / prime supplier portals (the 80+ long tail)

**Eric's point (correct):** there are **80+** distinct places to get contract data, and **the national
labs each run their own site.** DOE labs — [Lawrence Livermore](https://procurement.llnl.gov/),
[Savannah River](https://www.srnl.gov/procurement/), Sandia, Los Alamos, Oak Ridge, Argonne, PNNL,
Brookhaven, NREL, Fermilab, etc. — are mostly **GOCO** (contractor-operated), so their purchases are
**subcontracts**, posted on their **own supplier portals** and **invisible to SAM.gov**. Add NASA
centers/JPL, other FFRDCs, and large-prime supplier portals and you're easily at 80+.

- **Why it matters:** high value (labs award billions in subcontracts) AND it's **teaming/subcontracting**
  — the *other* gap in our competitive positioning. SAM-only competitors can't see this.
- **Access reality — same shape as SLED, often worse:** fragmented + **bot-blocked**. The example Eric
  sent, `vp.vendormgmt.us` (a hosted vendor-management portal), returns **HTTP 403 to automated
  requests** — same WAF/bot-block pattern as DIBBS. So each is a residential-proxy scrape, or a license.
  Common platforms (Jaggaer, Ivalua, hosted vendor-mgmt) let one scraper template cover several.
- **The list already exists:** GovCon Chamber's **[2025 Federal Directory of Vendor and Supplier
  Portals](https://www.govconchamber.com/portals)** enumerates them — a ready seed for our registry.
- **We already have a seed registry:** `src/data/agency-procurement-sources.json` (21 agencies mapped to
  procurement portals beyond SAM; DOE → "National Labs" is listed but **not yet enumerated per lab**).

**Move:** expand `agency-procurement-sources.json` into the full **80+ sourced registry** — per source:
URL, platform, access method (API / scrape / bot-blocked), and current status. That artifact is *both*
the ingestion roadmap **and** the on-brand transparency proof ("here are our exact N sources"). Then
ingest the **highest-budget labs first** (LLNL, Sandia, ORNL, LANL), not all 80 at once.

## Tier 2 — SLED (state/local/education): a LICENSE decision, not a build

**No US state exposes a documented public API/RSS for *live* bid opportunities** — verified across CA,
TX, FL, NY, OH, GA, VA, WA, IL, PA, OR; **none** had one. What exists is post-award open data
(Socrata/CKAN, real APIs but *executed contracts/spending*, not live bids) and brittle UI "export to
CSV" buttons. So state ingestion = scrape or license. ([Public Bid Tracker "About the Data"](https://publicbidtracker.com/about/) — even the commercial trackers scrape each portal weekly.)

**The only real programmatic SLED feeds are the licensed brokers:**

| Source | Coverage (claimed) | API? | Verdict |
|---|---|---|---|
| **GovSpend** | All 50 states + Canada; 19 aggregated sources ([data](https://govspend.com/govspend-platform/data/)) | **YES** — documented Search API + Saved Search API + an MCP server ([API](https://support.govspend.com/search-api)) | **Cleanest "buy the feed" option.** Paid (pricing unpublished). |
| **BidPrime** | Fed+state+local+edu, US/Canada, "120,000+ sources" ([about](https://www.bidprime.com/about)) | **YES** — paid API + webhooks + Zapier | Also viable licensed feed. Paid. |
| **Deltek GovWin IQ (SLED)** | Claims 95% of SLED spend, 100,000+ agencies ([SLED](https://www.deltek.com/products/govwin/sled/)) | **No public API** — subscription app / UI export | Broadest coverage, worst programmatic access. Absorbed **Onvia** (defunct 2017). |
| **eProc SaaS platforms** — BidNet/Periscope (mdf/SOVRA), DemandStar/Bonfire/IonWave (**Euna**), Public Purchase | See below | **Scrape-only** for an outside ingester — their APIs are for agencies integrating their *own* instance, not an opportunity feed | **Don't build against these.** ([Apify BidNet scraper](https://apify.com/jungle_synthesizer/bidnetdirect-government-bids-scraper/api) exists precisely because there's no feed.) |

**Platform-family shortcut (if we ever DO scrape states):** most states run a few COTS platforms
(Periscope/Euna **BuySpeed**, **Jaggaer**, **Ivalua**, **SAP Ariba**). Same platform = same URL/DOM, so
one scraper template covers many states. Still maintenance-heavy; the license path avoids it.

---

## How competitors actually source SLED (demystifying "1,000+ portals")

The "1,000+ portals / 4,839 feeds" numbers are **coverage claims, not proof of in-house crawlers.**

- **HigherGov — genuinely real, the one to respect.** Publicly documents a self-run operation: statewide
  procurement sites + third-party vendor portals + individual agency sites + **physical newspapers**, plus
  **thousands of FOIA requests/year**, AI enrichment, and mining **meeting minutes** to forecast
  pre-solicitations; refreshed every 15 min. Claims 40,000–60,000 agencies (their own numbers vary — a
  marketing range). Frames it as proprietary; does **not** claim to license a broker. ([data collection](https://www.highergov.com/sl/contract-opportunities/data-collection/), [data sources](https://docs.highergov.com/more/data-sources))
- **SweetSpot — real-sized claim, opaque method.** Advertises "1,000+ SLED sources," 200k+ contracts, 17k
  agencies, 47 states — but **how they collect it is undisclosed** ("AI to track and aggregate disparate
  sources"), and their own page points to "BidNet or GovWin" as where SLED lives — a tell for
  relaying/licensing aggregators. ([SweetSpot](https://www.sweetspot.so/), [SLED glossary](https://www.sweetspot.so/glossary/sled-state-local-and-education/))
- **Govly — a channel network, not broad SLED (Eric's read confirmed).** Core = IT contract-vehicle /
  reseller RFQs (SEWP/ITES/GSA) that never hit SAM, for VARs/OEMs/distributors (Cisco, HPE, Fortinet).
  Has *bolted on* ~4,839 SLED feeds as a secondary layer, method undisclosed. ([Govly](https://www.govly.com/), [SLED feeds](https://www.govly.com/blog/new-in-govly-even-more-sled-feeds-free-user-invites-and-more))

**Synthesis:** the economics of maintaining thousands of bespoke scrapers are brutal, so the realistic
pattern is **license the long tail (BidNet/DemandStar/GovSpend/BidPrime) + custom-crawl the few
high-value statewide portals.** Only HigherGov documents genuine own-collection. So **most "we scrape
state & local" claims are unverified or repackaged licensed data** — Eric's skepticism holds. And
out-crawling HigherGov (whose entire reason to exist is crawling) is not where Mindy should spend.

---

## Recommendation

1. **Phase 1 (now): resume DIBBS.** Spike **path B (DLA bulk files)**; if access is blocked, take **path A
   (pay Apify)**. Un-hide the `DibbsPanel`, wire DIBBS into search/alerts as a source-tagged pool. This
   is the biggest real count bump, and 90% of the code already exists.
2. **Phase 1b (cheap add): FedConnect** compliant scrape for the cross-agency/DOE solicitations SAM misses.
3. **Phase 2 (deliberate, when we want SLED): license GovSpend or BidPrime** for the feed — don't build a
   scraper farm for commodity data. Our differentiator stays the moat (agent-native + win-knowledge +
   change-tracking), not raw breadth.
4. **Marketing angle (on-brand):** publish exactly **which sources and how many** ("SAM + DIBBS + Grants
   + N states via <broker>"), not "trust our agents." Transparency **is** the proof — the thing the
   competitors can't offer.

**Open decisions for Eric:** (a) DIBBS resume path — evaluate bulk files (B) first, or just pay Apify (A)
now? (b) When (if) we add SLED, license GovSpend vs BidPrime — a sales-call/pricing comparison.

---

*Sources cited inline. Uncertainty flagged (⚠️) where a fact isn't publicly documented. State feed
availability was verified for ~11 notable portals, not a full 50-state census — the pattern (no live-bid
APIs) was unanimous. DIBBS bulk-file server access is unconfirmed and needs a spike before committing.*
