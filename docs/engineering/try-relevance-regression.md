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
