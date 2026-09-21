# /try relevance — the frozen regression set

**Frozen 2026-09-21, before any code changed.** Machine-readable copy:
`src/lib/beginner/__fixtures__/try-relevance-cases.ts`. Driven by
`src/lib/beginner/try-relevance.unit.test.ts` (hermetic) and
`scripts/verify-beginner-try.mjs` (live cache).

Every record in the set is a REAL row measured in the live `sam_opportunities`
cache on 2026-09-21 — title, NAICS, notice type and set-aside verbatim. A
synthetic corpus can only prove the matcher agrees with itself.

---

## What was actually wrong

Reproduced against production (`getmindy.ai`, serving `ea756fb2`) with the
screenshot's exact input:

```
POST /api/beginner/search  {"description":"can a 2 person garbage company do government contracts"}
→ 13 results, all under "Matches what you described"
   RFI - DCSA Personnel Security Alert Management (PSAM) Platform
   FY26 NPTU Personal Alert Safety System (PASS)
   IT MANAGER - PERSONAL SERVICES CONTRACTORS
```

Two independent causes, both measured, not inferred:

**1. The searched keyword was the literal word `person`.**
`beginnerDirectKeyword` took `keywordCandidates(text)[0]`, which ranks by
POSITION — a rule tuned on expert phrasing ("commercial ROOFING and building
envelope repair"), where the trade leads. Beginner prose leads with who you
ARE. Measured heads before the fix:

| input | searched |
|---|---|
| can a 2 person garbage company do government contracts | `person` |
| we do IT support for small offices | `small` |
| we install commercial roofing | `install` |
| physical security guard services | `physical` |
| staffing agency | `agency` |

**2. The relevance gate used `title.includes(token)` with no word boundary.**
`person` ⊂ `PersonNEL`, `PersonAL`. The gate's only defence was a 19-item
"weak token" list that contained neither `person` nor `contracts`.

A third cause made the report's proposed fix impossible as written: `/try`
deliberately passes `skipUsaSpendingCoverage`, so `resolution.naicsCodes` is
**always empty** there and `classification` is always `keyword_fallback`.
Gating on "NAICS/PSC must intersect the resolved code set" would have returned
zero results for every `/try` query. Hence activity evidence, with codes as
corroboration only.

**Also found in the same response, not in the report:**
- `explanation` read `"Mindy found 13 current opportunitys"` (naive `${noun}s`).
  API payload only — the rendered hero has its own correct copy, but the
  payload is what programmatic SEO pages would consume.
- The 13 included duplicate rows (three "Shank 2.0", two "Wind River").
- 8 of the 13 were Sources Sought / Special Notice, 1 pre-solicitation, 4
  biddable — all counted as "13 current opportunities".
- **4,261 of 9,030 active open notices (47.2%) carry no set-aside at all**
  (no description AND no code), and every one rendered *"Who it's for: Any
  business that can do the work"*.

---

## The set

12 business descriptions + 5 eligibility/stage records. `include` = must be in
the DIRECT group (the guard against a "fix" that passes by returning nothing).
`exclude` = must NOT be in DIRECT; `group: 'none'` additionally means it must
not be shown at all.

| id | input | head | why it is in the set |
|---|---|---|---|
| `garbage-2-person` | can a 2 person garbage company do government contracts | `garbage` | THE SCREENSHOT INPUT |
| `cleaning` | I clean office buildings | `clean` | activity leads — the case the old picker handled; must keep working |
| `it-support` | we do IT support for small offices | `it support` | the activity exists only as a phrase (2-char domain + a wildcard) |
| `staffing` | staffing agency | `staffing` | HONEST-EMPTY: zero open titles carry "staffing" today |
| `construction` | I run a small construction company | `construction` | the activity word is on the platform generic list |
| `landscaping` | I own a landscaping business | `landscaping` | clean single-activity baseline |
| `security-guard` | physical security guard services | `guard` | "physical" is an attributive modifier the old picker searched |
| `catering` | we cater events | `cater` | stemming: user writes the verb, government writes "Catering" |
| `trucking` | trucking company | `trucking` | trailing org word must not become the key |
| `roofing-verb-led` | we install commercial roofing | `roofing` | verb-led |
| `multi-service` | I do commercial cleaning and small construction jobs | `cleaning` | MULTI-MARKET — both must survive |
| `vague` | I help businesses | `null` | must ask, never a confident list |

### The decisions worth arguing with

**A genuinely multi-service business spans markets.** `multi-service` asserts
that a cleaning hit (NAICS 56) and a construction hit (NAICS 23) co-occur in
the same direct group. There is deliberately no rule that unrelated results can
never appear together — only that each must earn its place on its own evidence.

**Expanding the user's word is safe; shortening it is not.**
`cater → Catering` keeps the meaning (direct). `trucking → Trucks` does not —
an object is not the service (broader). The same asymmetry puts
`roofing → "REPLACE ROOF SURFACES"` one tier down. That one is a **residual
limitation**, recorded rather than special-cased: a roofer's genuine match
lands under "Related" instead of "Matches what you described". It is shown, not
lost.

**Code overlap alone is adjacent, never a described match.** "ZFW Cafeteria and
Vending Services" carries the same NAICS 722320 as real catering work.
Conversely a NULL NAICS never deletes a result with real title evidence —
"Remediation and Specialty Cleaning Services" (562910) is a cleaning job
whatever code it carries.

**Homographs are demoted, not deleted.** "Cattle Guards", "SNOW GUARDS",
"Grill Guards" and "Building 215 Clean Room" all genuinely contain the user's
word. They move to "Related — broader or adjacent" by sector disagreement, not
by a hardcoded blocklist.

**Buyer names are not work.** "US COAST GUARD … PROPANE DELIVERY" is propane.
Organisation names containing a trade word are blanked before matching. This
also had to be fixed in the oracle harness, which was mining "engineers" out of
"U.S. Army Corps of Engineers" (7 of the 8 live titles containing that word)
and then demanding results for "I do engineers".

### Eligibility + stage records

| id | record | expected |
|---|---|---|
| `missing-set-aside-on-rfi` | the screenshot's RFI, set-aside NULL | "Not listed on this notice", stage `market_research` |
| `explicit-unrestricted` | "No Set aside used" on a Sources Sought | "Any business that can do the work" — and the set-aside is PRESERVED on the RFI |
| `real-set-aside-preserved-on-solicitation` | "Small Business Set Aside - Total" | "Small businesses", stage `open_bid` |
| `set-aside-preserved-on-sources-sought` | "Indian Small Business Economic Enterprise" | "See the listing" — never plain "Small businesses" |
| `upcoming-presolicitation` | the screenshot's presol, set-aside NULL | "Not listed", stage `upcoming` |

---

## Rejected approaches, with the evidence

**Ranking activity candidates by `naics_vocabulary`** (25,252 buyer terms mined
from award text). Measured 2026-09-21 — not a usable activity signal:

```
physical → 621340 (weight 1481)  outranks  guard → 561612 (weight 1206)
window   → 114119 (agriculture)
garbage  → 561440 Collection Agencies, df=5
```

It would have made "physical" beat "guard". Extraction stays pure, sync and
deterministic.

**Expanding the market from the NAICS of the direct hits, via
`naics_vocabulary`.** The one live "garbage" hit carries 562998, whose mined
vocabulary is *grease trap cleaning* — so a garbage hauler would have been
shown grease traps as their "hidden market". Exactly the "broad or incorrectly
resolved codes can still produce false matches" trap. Not shipped.

**Ranking by the semantic keyword ranker's order.** `derive_company_keywords`
puts "drones" ahead of "lidar" for "work with lidar for uas drones", which
searches the category instead of the capability. Position order (after context
words are stripped) is the safer tiebreak.


---

## Adversarial pass — 2026-09-21, after the first fix

An independent verifier was asked to break the gate in two directions. It
found real defects of the **same class as the original bug**, all fixed here
and pinned into the frozen set.

### False positives it found

| input | searched | returned | fix |
|---|---|---|---|
| woman owned small business that does catering | `owned` | 9 Government-Owned / GOCO fuel-depot contracts, `catering` unused | ownership + certification self-description → `CONTEXT_TERMS` |
| we drive trucks | `drive` | DISK DRIVE · QUAD TAPE DRIVE · AC DRIVE (26 cards, 0 trucking) | verbs that are also nouns → `ACTIVITY_VERBS` |
| we rent cranes | `rent` | "Market Rent Study" (a real-estate study) | + service compound `crane rental` |
| we tow vehicles | `vehicles` | Stryker Family of Vehicles · Low-Cost Kill Vehicles | + service compound `vehicle towing` |
| we monitor alarms | `monitor` | MONITOR,FLAT PANEL · defibrillator monitors | + service compound `alarm monitoring` |
| we survey land | `survey` | "Market Survey for Image Intensifier Assembly" | + service compound `land survey` |
| medical staffing agency | `medical` | **40/40 wrong** — Medical Waste Disposal, VA Medical Center elevator inspection | two typed-generic words may anchor a phrase |
| certified small disadvantaged veteran owned company | `disadvantaged` | — | now asks a clarifying question |

**`CONTEXT_TERMS` is a blocklist and blocklists are unbounded** — the verifier
is right, and the structural half of the answer is that rung 1 picks the first
*distinctive* word by position, so any non-activity word ahead of the trade
wins. What bounds it in practice: a word only reaches rung 1 if it is
distinctive AND not a modifier AND not a verb, and the frozen set now pins the
two whole families (ownership/certification, verb-nouns) rather than the two
instances.

### Lost results it found

- **Plural was scored as derivation.** "we build fences" printed *"Mindy found
  0 current opportunities"* above three live fence cards, with 14 open fence
  notices in the cache. Same for roofs (54 live), windows (36). `singular()`
  now resolves the plural mark in both directions, and the SQL keyword is
  singularized because SAM's title search is an ILIKE substring — `%fences%`
  cannot match "Fence". Measured after: fences 0 → 11 direct, roofs 3 → 24,
  windows 2 → 24.
- **Sector voting ran on undeduped rows.** A single notice duplicated in the
  cache manufactured the 2-of-3 majority that demoted a real plumbing
  contract. `classify` now dedupes first.
- **The sector vote was unreachable** once `terms` carried both "door" and
  "doors": every item was "held by another term". Terms are now deduplicated
  by singular form, and only a MULTI-WORD term holds an item against the vote.

### Two of my own regressions, caught by re-measuring

- Compounding the repair family narrowed "we install windows" from 36 live
  window notices to 1. `SERVICE_NOMINALS` is now only verbs where **the verb
  is the service** (rent/tow/mow/monitor/survey/store/haul/drive/…), never
  install/repair/replace/remove/collect/clean — for those the object already
  names the work. The repair family gets the compound as *evidence* instead,
  which is what demotes "windows 11 Laptops" and "WINDOW,DIAL" to adjacent.
- `singularObject` over-stripped `-es`: "cranes" → "cran", "vehicles" →
  "vehicl". Now only after s/x/z/ch/sh.

### Accepted, not fixed

- **Adjacent-sector demotion.** A tree company's two forestry notices (115310)
  land under "Related" because landscaping (561730) dominates its own term.
  Both are still shown; hardcoding sector adjacency would be a worse rule than
  the one that keeps cattle guards and grill guards out of the direct group.
- **"we mow lawns" returns nothing.** There are zero "lawn" titles open; the
  11 relevant notices say "grounds maintenance". That is a vocabulary gap, not
  a matcher bug, and we have no synonym source we trust (see the rejected
  `naics_vocabulary` experiments above).
- **Non-English input** ("yo tengo una compania de limpieza") is out of scope.

### What the verifier could not break

The reported bug is dead. Buyer-name stripping holds (Coast Guard, Marine
Corps, Border Patrol, Merchant Marine Academy). It could not get a
code-overlap-only item into the direct group, and it could not make the
phrase-anchor rule demote a correct result.


---

## Round 3 — "we mow lawns", and what the checks actually measure

### An exact-token miss is not market absence

Round 2 closed with *"we mow lawns returns nothing — that is the market, not
the matcher."* **That was wrong, and it is the same error class this whole
document is about.** Measured 2026-09-21:

| probe | open titles |
|---|---|
| `lawn` | **0** |
| `mowing` | **0** |
| `mow` | 4 — all MOWER equipment (NAICS 333112/333111) |
| `grounds maintenance` | 11 |
| `groundskeeping` | 4 |
| `landscap*` | 9 |

17 of the 21 grounds/mowing/landscaping titles carry **NAICS 561730
Landscaping Services**. A lawn-mowing company has a real, open market of about
18 notices. Saying "nothing found" described a **vocabulary miss as market
absence**.

### ⛔ RETRACTED — the detail-evidence fallback was built and REMOVED

A fallback was added that, on an empty direct group, read the notice's
`description`/`sow_text`, matched the activity term and rendered the passage
under *"Your words are in this listing's details:"*. **It was removed the same
day.** Independent review measured it end-to-end against the live cache:
**26 hits across 10 inputs, ~19 (73%) did not describe the user's work** —
submission boilerplate (*"a written condition report **detailing** the
failure"*), a document's table of contents (*"………26 5.4 **Escort**
Requirements………"*), FAR 12.302 clause text, a scope **exclusion** quoted as
proof, and wrong word senses (*"collecting, preserving, **interpreting** … the
history of USACE"*). Because the card asserted the notice's own text as
evidence, each wrong hit was an affirmative false claim with the proof
attached — the failure class the rest of this work removes, relocated into the
Related group.

**Three claims made for it are retracted:**

1. **"A multi-word term must appear as a PHRASE (within 40 chars)."** FALSE.
   `DETAIL_PHRASE_SPAN` was order-free proximity, not a phrase check.
   Verified after the fact:
   `findTermInText("the staffing plan shall address medical surveillance requirements", "medical staffing")`
   → **MATCH**. The `23 → 1` improvement cited for the medical-staffing case
   was real for that one text and did not generalise; the guard does not do
   what its own comment said.
2. **The "we mow lawns" browser screenshot was NOT this feature.** The detail
   path is gated `!awardedFallback`, and `we mow lawns` takes the awarded
   path — the screenshot showed the *awarded* fallback working. The CLI run
   where the detail hit appeared had `searchAwarded` stubbed off. The feature
   never fired for its own motivating example.
3. **`verify:beginner-try` never exercised it.** `toItem()` omits `notice_id`,
   so every candidate was skipped before any fetch; the 13/13 pinned pass was
   green with the feature effectively disabled.

The idea is not dead — the corpus really does connect "mowing" to NAICS 561730
through the description. The evidence, the classes a replacement must handle,
and the accounting defects are frozen in
`src/lib/beginner/__fixtures__/body-relevance-cases.ts` and
`tasks/body-relevance-followup-2026-09-21.md`. **Do not substitute another
heuristic without clearing that bar.**

**Still true, and kept:** mapping `lawn` → "grounds maintenance" was measured
and rejected — `naics_vocabulary` sends `lawn` → **333112 LAWN-MOWER
MANUFACTURING (df 17)**, the third instance of the 562998 → "grease trap"
failure. No synonym hop was added.

### Copy that claimed the market, now fixed

The oracle's new no-absence pin caught a site the code review had not:

| was | now |
|---|---|
| "Government buys this — **the open market is small right now**" | "Mindy found N listings whose **title** names this work" |
| "**Nothing matching is open** right now" (structured empty) | "No open listing's **title** uses the words you did, which is a limit of this search, not a reading of the market" |
| "**Nothing matching is open to bid** right now" (awarded fallback) | "No open listing's title uses those words, so Mindy looked at what government recently AWARDED…" |
| "Mindy found **0 current opportunities**" | "No open listing's title uses \"x\" or \"y\". Government often writes the same work differently…" |

The first of these was live on the garbage case in the browser screenshot:
1 title match reported as a small market, while ~20 open refuse/solid-waste
notices existed under words the user had not typed. The reveal now carries
`searchedTerms`, so the copy can name what was actually searched.

### What the 1,000-search check measures

`npm run verify:beginner-try -- --sample 250` runs 250 nouns × 4 sentence
frames. **It is a RECALL FLOOR, not a precision score.** Each noun is harvested
from a live open title, so a relevant listing provably exists; the only
assertions are that `/try` does not come back empty and does not ask a
follow-up. A build that returned the entire corpus for every input would score
1000/1000. Precision is asserted elsewhere:

| check | what it proves |
|---|---|
| frozen set (`try-relevance-cases.ts`) | per-record include / exclude / group, with reasons |
| pinned oracles | named false positives stay out of the direct group; misses never claim absence |
| sample 250 × 4 | recall floor only |

Two further limits: the sampled corpus is one PostgREST page (1,000 rows), not
a census; and the four frames are templates, not real user prose.

### Negative controls — preserved, not quietly dropped

These must keep returning **nothing in the direct group**. They are how we know
the gate is still a gate:

- `zzqwxjunkterm999xyz` → clarifying question, no cards.
- `I help businesses`, `I do stuff`, `certified small disadvantaged veteran
  owned company` → clarifying question. Every content word is context.
- `staffing agency` → no title match; copy states the search limit and claims
  nothing about the market.
- Cross-domain: the three screenshot notices (personnel-security platform,
  PERSONAL alert device, PERSONAL services contractors) must not appear for any
  normal business input.
- Homographs: Coast Guard / National Guard / grill guards / cattle guards for
  `guard`; "Clean Room" for `clean`; "Market Rent Study" for `rent`; DISK DRIVE
  for `drive`; "Windows 11 Laptops" for `window`.
- Broad-code: "ZFW Cafeteria and Vending Services" shares NAICS 722320 with real
  catering and must never be a described match.

### Rejected experiments — still rejected, kept on the record

1. **Ranking activity words by `naics_vocabulary`** — `physical` (w1481) beats
   `guard` (w1206); `window` → 114119 agriculture; `garbage` → 561440
   Collection Agencies (df 5).
2. **Expanding the market from the direct hits' NAICS** — the one live
   "garbage" hit is 562998, whose mined vocabulary is *grease trap cleaning*.
3. **Mapping `lawn` → "grounds maintenance"** (new this round) — `lawn` →
   333112 lawn-mower manufacturing, df 17. Same shape as (2).

All three fail the same way: a code resolved from one word, then trusted to
name a market. Evidence read from the notice itself does not have that failure
mode, which is why the detail-evidence path was acceptable where these were not.
