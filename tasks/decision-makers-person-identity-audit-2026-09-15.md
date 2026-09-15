# Decision Makers — Phase II person identity audit (READ ONLY)

**Snapshot T0 = 2026-09-15T13:18:51Z.** The drain was running throughout; every population below
is as of T0 unless stated. No row was mutated, merged, deduped or reclassified.

## 1. Frozen snapshot

| measure | T0 value |
|---|---|
| physical rows | **287,371** |
| source-governed (non-vendor) | **205,354** |
| distinct raw emails | 24,934 |
| distinct normalized emails | **22,920** |
| distinct normalized names | 70,397 |
| agencies | 72 |
| sub_tier values | 37,615 |
| backfill cursor | `2026-06-11T01:01:02.984Z` |
| notices_scanned | **90,000 / 207,067 (43.5%)** |

Corpus temporal span: **2026-03-15 → 2026-09-15 — six months only.** `sam_opportunities` does not
retain more, so *all* role history below is bounded to a 6-month window.

## 2. Government vs vendor — a clean split, zero ambiguity

| class | rows | with email | distinct email | has UEI | no dept |
|---|---|---|---|---|---|
| GOVERNMENT_BUYER_CONTACT | **205,354** | 205,351 | 22,920 | 0 | 0 |
| VENDOR_ENTITY_POC | 82,017 | 0 | 0 | 82,017 | 82,017 |
| UNKNOWN / AMBIGUOUS | **0** | — | — | — | — |

The boundary is structural, not heuristic: vendor rows are keyed `<UEI>::<role>`, carry a UEI and a
company, and have no federal department or email. **Analysis universe = the 205,354 government rows.**

⚠️ Correction to the prior audit: "82,019 rows have no email" was almost entirely the vendor bucket.
Government rows are **205,351 of 205,354 emailed — only 3 without.** The no-email population that
section 6 was scoped to analyse essentially does not exist.

## 3. Identity field reliability

| field | fill | classification |
|---|---|---|
| `contact_email` | 99.9985% | **SOURCE_NATIVE** — the single most reliable field |
| `contact_fullname` | 100% | SOURCE_NATIVE but **POLLUTED** (see §4) |
| `contact_title` | 100% | **DEFAULTED/DERIVED** — 93.4% is the synthesized "Primary/Secondary Contact" |
| `department_ind_agency` | 100% | SOURCE_NATIVE, parent department only |
| `sub_tier` | partial | SOURCE_NATIVE, 37,615 values — granular, not a clean bureau list |
| `office` | **0%** on government rows | UNRELIABLE — never populated |
| `contact_phone` | 94.9% | SOURCE_NATIVE |
| `posted_date` | 100% | **SOURCE_NATIVE — the only real temporal evidence** |
| `source` / `source_table` | 100% | **DEFAULTED — not provenance** (column DEFAULTs) |
| `role_category` | 100% | DEFAULTED — constant `'contracting'` |
| `updated_at` | 100% | MINDY_DERIVED — writer clock, never proof of current role |
| source-native person ID | — | **DOES NOT EXIST.** SAM's POC object carries only `email`, `fullName`, `type`, `phone`, `fax`, `title`. |

**There is no EXACT identity tier available.** Every cluster is inferred.

## 4. The name field is polluted — this reframes the whole conflict question

Measured on the 205,354 government rows:

| pollution | rows |
|---|---|
| embeds a 3+ digit run (phone concatenated into the name) | **30,475 (14.8%)** |
| embeds an email address | 1,776 |
| embeds CRLF | 80 |
| placeholder name caught by the render guard | 3,913 |

Real examples, all **one person**: `Alicia Wargo 771-229-0601` / `Alicia Wargo` /
`Alicia Wargo\r\n771-229-0601\r\nalicia.l.wargo.civ@us.navy.mil` / `Facsimile: 0000000000`.

### ⚠️ LIVE PRODUCT DEFECT (found here, NOT fixed — read-only)

`PLACEHOLDER_NAME_RE` in `src/lib/gov-contacts/contact-quality.ts` matches only
`telephone|phone|fax|tel`. These render to customers as a buyer's NAME:

| escaping shape | rows |
|---|---|
| `ELECTRONIC MAIL: <address>` | **873** |
| `Facsimile: <digits>` | **26** |
| bare role labels (`CONTRACT SPECIALIST`, `CONTRACTING OFFICER`, `BAA COORDINATOR`) | **312** |
| **total** | **1,211** |

Same class as the 2026-07-26 ghost-card fix, three shapes it did not cover. One-line regex change;
deliberately left for a separate mutation pass.

## 5. The conflicting-name emails — 84.8% are ONE person

2,418 emails carry more than one raw name (40,421 rows). After normalization
(strip embedded email/phone/punctuation, fold diacritics, drop initials/suffixes/titles, sort tokens
so `LAST, FIRST` == `FIRST LAST`):

| class | emails | % | rows |
|---|---|---|---|
| SAME_PERSON — resolved by normalization | **1,549** | 64.1% | 26,060 |
| SAME_PERSON — name variant (hyphenated / maiden→married) | **268** | 11.1% | 3,759 |
| DATA_PARSE_VARIANT — typo (`WITKOWSI`/`WITKOWSKI`) | **234** | 9.7% | 3,419 |
| **→ same person, subtotal** | **2,051** | **84.8%** | 33,238 |
| GENERIC_MAILBOX | 121 | 5.0% | 4,082 |
| GENERIC/PLACEHOLDER, no real name | 38 | 1.6% | 711 |
| **MULTIPLE_REAL_PEOPLE or UNKNOWN** | **208** | **8.6%** | 2,390 |

Only **208 emails (0.9% of all emails)** resist a same-person explanation. **None is merged.**

## 6. No-email population

**3 rows.** No fallback identity strategy is needed or defensible. The extraction gate requires
email-or-phone and in practice SAM always supplies an email for government POCs.

## 7. Generic / role mailboxes

Patterns were derived from the corpus, not assumed (`purchasing`, `bids`, `solicitation`,
`acquisitions`, `quotes`, `rfq`, `proposals`, `procurement`, `smallbusiness`, `realestate`,
`licensing`, `poc`, `orders`, …).

| class | emails | rows |
|---|---|---|
| C1 GENERIC_MAILBOX (role pattern AND/OR ≥4 distinct people) | **114** | 3,811 |
| C2 ROLE_MAILBOX, single name attached | **206** | 1,753 |

Worst: `manilapurchasing@state.gov` — 16 names / 82 rows. `jakartapcubidding@state.gov` — 15 / 95.
**None of these is a person.** C2 is deliberately kept separate and NOT merged into persons: a role
address with one name attached is AMBIGUOUS, not proven personal.

## 8. Row multiplicity is legitimate history, not corruption

| measure | value |
|---|---|
| rows / distinct (email, notice) observations | 205,351 / **203,696** |
| avg rows per identity | 9.0 · median 4 · max **3,728** |
| identities seen on 1 notice | 5,079 (22.2%) |
| 2–5 notices | 8,279 · 6–20: 7,315 · >20: **2,247** |

The 3,728-row outlier is `Natalya.Radyk@dla.mil`: **one name, 3,728 distinct notices.** One real DLA
contracting officer named on 3,728 solicitations. Rows ≈ observations 1:1 — **the 205K rows are
~203K person-notice observations, not duplicate corruption.**

## 9. Role history — far smaller than it first appears

| signal | raw | after removing the derived Primary/Secondary label |
|---|---|---|
| multi-title identities | 5,087 | **599** |
| multi-sub_tier | 78 | 78 |
| multi-agency | **2** | 2 |
| multi-phone | 3,132 | 3,132 |
| single-role identities | 17,790 (77.6%) | — |

⚠️ The 5,087 figure is an artefact: `contact_title` is 93.4% the synthesized
`PRIMARY CONTACT`/`SECONDARY CONTACT`, so "multi-title" mostly means the same person appeared as
both primary and secondary POC. **Genuine title changes: 599.** Only **1,513 identities have any
real title at all**; 21,407 have none.

Both cross-agency emails inspected: `daniel.j.mcgrath@gsa.gov` (a real GSA person on one VA notice)
and `marketplacesupport@unisonglobal.com` (a **commercial vendor** support desk spanning DOJ/DHS/DoD/SSA).

## 10. Temporal evidence — LAST_OBSERVED_ROLE only

100% of rows carry `posted_date` (the notice's own date) — real source evidence. `imported_at` and
`updated_at` are Mindy writer clocks and prove nothing about tenure. SAM publishes no contact
"as-of" or termination signal. **No row supports a CURRENT_ROLE claim; the strongest defensible
statement is LAST_OBSERVED_ROLE as of `max(posted_date)`,** within a 6-month window.

## 11. Cross-source overlap

| | emails |
|---|---|
| `AllSamContacts` (live) | 21,735 |
| `sam_opportunities_pointOfContact` (frozen 2026-05-28) | 10,949 |
| shared | **9,764 (89.2% of frozen)** |
| **only in the frozen family** | **1,185** |
| only in live | 11,971 |

The frozen family is not redundant — 1,185 identities exist nowhere else. It is safe to join the
same identity model: same key space, same extraction, same email semantics.

## 12. Identity strategy comparison

| strategy | identities | false-merge risk | false-split risk | coverage | verdict |
|---|---|---|---|---|---|
| **A** normalized email only | 22,920 | 320 role mailboxes + 208 ambiguous merged as people | low | 205,351 rows | over-counts people, under-separates roles |
| **B** A minus role mailboxes | 22,600 persons + 320 role accounts | 208 ambiguous | low | same | **best** |
| **C** B + require a usable name | 22,360 persons | 208 | +240 unresolved | 203,285 rows | safest, loses 2,066 rows |
| **D** source-native person ID | **impossible — no such field exists** | — | — | — | unavailable |
| **E** no-email fallback | 3 rows | — | — | negligible | unnecessary |

**Raw-case-sensitive email would split 2,014 identities** (`Daniel.J.McGrath` / `Daniel.J.Mcgrath` /
`daniel.j.mcgrath`). Normalization to `lower(btrim())` is mandatory. Do **not** fold plus-addressing
or aliases — 0 instances exist, so any such rule is unevidenced.

### The false-split test — and why name must NOT be a merge key

1,128 (name_key, agency) pairs span multiple emails (1,259 surplus identities, worst 13). Inspection
shows these are **not** one person with many addresses:

- `SCMS`, `PROCUREMENT`, `ACQUISITION TEAM TTO` — role labels sitting in the name field
- `GRANT MICHAEL` @ DoD across 7 addresses, six belonging to **other people**
  (`carmelena.c.oldroyd`, `charles.f.horan4`, `cody.p.cameron`…)

**The name field and the email field on the same row frequently describe different people.** Merging
on name+agency would be a false merge, not a repair. Email is strictly the stronger key; name is
corroboration only.

## 13-15. Recommended model, key and confidence

Four concepts, but only **three tables** are justified by current evidence:

| concept | table | why |
|---|---|---|
| PERSON / contact point | `decision_contact_identity` | keyed on normalized email; carries `identity_kind` = `person` / `role_mailbox` / `ambiguous` / `unresolved` |
| ROLE | `decision_contact_role` | (identity, agency, sub_tier, title) with first/last observed |
| OBSERVATION | *the existing `federal_contacts` rows* | already one row per person-notice-slot with `posted_date` — **no new table needed** |

A separate `decision_person` above identity is **not yet justified**: with no native ID and name
proven unreliable as a merge key, a person super-entity would have exactly one identity each and
would encode a claim the data cannot support.

**Person key:** `sha256(lower(btrim(email)))`, truncated — deterministic, stable across title/office
changes, not PII in the clear, and never assigned to a role mailbox (those key the same way but carry
`identity_kind='role_mailbox'`). Unresolved rows get no identity key rather than a synthetic one.

**Confidence tiers (no EXACT tier is achievable):**

| tier | rule | emails | rows |
|---|---|---|---|
| ~~EXACT~~ | native person ID | **0 — unavailable** | — |
| HIGH_CONFIDENCE | one normalized email, one normalized name key (incl. variant/typo folding) | **22,152** | 195,331 |
| ROLE_ACCOUNT | role mailbox, not a human | **320** | 5,564 |
| AMBIGUOUS | one email, multiple irreconcilable people | **208** | 2,390 |
| UNRESOLVED | no usable name, or no email | **243** | 2,069 |

## 16. Customer implication

Today a user browsing notices meets the **same human 8.9 times on average**; 77.8% of identities
appear on more than one notice and 2,247 appear on more than 20. Consolidation would turn 205,351
undifferentiated rows into ~22,152 people each carrying a visible engagement history — materially
improving buyer discovery, relationship tracking and pursuit intelligence. It changes **no**
filtering or reachability: the same rows remain reachable, grouped differently.

## 17. Stability across drain age — the model does NOT behave uniformly

| family | rows | emails | rows/email | placeholder-name rate | span |
|---|---|---|---|---|---|
| `AllSamContacts` (live) | 174,915 | 21,735 | 8.0 | **1.89%** | 03-15 → 09-15 |
| `sam_opportunities_pointOfContact` (frozen) | 30,439 | 10,949 | 2.8 | **4.97%** | 03-15 → 05-27 |

The frozen family has **2.6× the placeholder-name rate**. Do not extrapolate live-family quality to
the whole corpus, and re-run this audit at 100% traversal before freezing thresholds — **43.5% of
notices are still untraversed at T0.**

## 18. Final reconciliation (T0)

| bucket | emails | rows |
|---|---|---|
| A_SINGLE_PERSON | 21,650 | 188,153 |
| B_SAME_PERSON (variant/typo folded) | 502 | 7,178 |
| C1_GENERIC_MAILBOX | 114 | 3,811 |
| C2_ROLE_MAILBOX (single name) | 206 | 1,753 |
| D_AMBIGUOUS | 208 | 2,390 |
| Z_NO_USABLE_NAME | 240 | 2,066 |
| **total (government, emailed)** | **22,920** | **205,351** |
| government rows without email | — | 3 |
| **government total** | | **205,354** |
| vendor rows excluded | | 82,017 |
| **physical total** | | **287,371** |

Every column reconciles exactly.

## 19. Decisions

**1. Is email a safe person key?** **YES — with two mandatory conditions**: normalize to
`lower(btrim())` (2,014 identities split otherwise), and carve out the 320 role mailboxes. It is the
*only* field strong enough: 2 of 22,920 emails cross agencies, versus a name field polluted on 14.8%
of rows and frequently naming a different person than the address on the same row.

**2. The conflicting-name emails (2,418 at T0):** 2,051 same person (84.8%) · 159 generic/placeholder
(6.6%) · **208 multiple-people-or-unknown (8.6%)** · 0 merged.

**3. Largest defensible estimate of unique government decision makers: 22,152**, of which 21,650 are
unambiguous. Treat as a **lower bound of a growing number** — only 43.5% of notices are traversed.

**4. Rows not safely assignable to a person: 10,013** — 5,564 role-account, 2,390 ambiguous, 2,069
unresolved. That is **4.9%** of the government universe.

**5. Person + role + observation as separate concepts?** **Role and observation yes; a person entity
above identity, not yet.** Observation already exists as the current rows. A `person` super-entity
needs cross-email merge evidence that does not exist today.

**6. Canonical key:** `sha256(lower(btrim(contact_email)))` on the identity, with `identity_kind`
distinguishing person from role mailbox. Never keyed on name, title or office.

**7. Can frozen importer rows join the model?** **Yes** — same key space, 89.2% email overlap, and
1,185 identities exist only there. Flag their 2.6× placeholder rate; do not treat their names as
equal-quality evidence.

**8. Should vendor POCs share this model?** **No.** Different key space (`<UEI>::<role>`), zero
emails, a company rather than an agency, and every customer surface already excludes them. Give them
their own model when their provenance pass happens.

**9. Schema change required:** two additive tables (`decision_contact_identity`,
`decision_contact_role`) plus a nullable `identity_key` on `federal_contacts`. **No destructive
change, no row rewrite, no dedupe.**

**10. What to implement FIRST:** the **1,211-row placeholder-name guard gap** (§4). It is a
customer-visible defect showing fax numbers and `ELECTRONIC MAIL: …` as buyers' names, it is a
one-line regex change, and it must land *before* identity clustering — those same rows are what
currently pollute the name evidence the clustering would consume. Identity tables come second, and
only after the drain reaches 100% so the thresholds are set on the whole corpus.

---

**READ ONLY — nothing was deduped, merged, rewritten or reclassified. STOPPED FOR REVIEW.**
