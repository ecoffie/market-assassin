# Daily-alert relevance — investigation + PARTIAL Open-alert repair (2026-09-26)

Customer case: an SDVOSB AI / acquisition-support firm ("Customer A"). He reported the
2026-09-24 alert and his keyword list, and believed "the algorithm just needs a few more
days to refine". Identity is kept out of the repo on purpose; the named investigation lives
outside version control.

**His account was not changed and nothing was sent to him.** All production access was read-only.

⚠️ **This is a PARTIAL repair of the Open section only.** Railway grants, expired deadlines,
recompetes, duplicate notices and misleading counts are still unresolved (see "Explicitly OPEN").
Do **not** tell the customer his daily email is fixed. Do **not** restore his keyword list
before release verification.

## What the investigation found (before this PR)

| # | Finding | Evidence |
|---|---|---|
| F1 | 13 of 53 keywords silently dropped on save | `preferences` route `.slice(0, 40)`; stored list = his first 40 exactly |
| F2 | Keyword preference ran on the first 200 rows (deadline order) of the NAICS/PSC market | His own keywords: 17 matches visible in the 200-row window vs 27 in the full 890-row market |
| F3 | Ranking saturated: +25 per keyword hit, clamped at 100 | 6 of 7 emailed notices scored exactly 100; order fell to the deadline |
| F4 | Agency match was substring | "NIST" gave FDA and FHWA +30 (admi-NIST-ration); "VA" never matched Veterans Affairs |
| F5 | Email hid the evidence | "Matched on NAICS 611430 · NONE"; the keyword that admitted the row was never shown |
| F6 | No learning of any kind | Nothing in daily-alerts reads clicks, feedback, weights or engagement. It is static matching plus a 7-day dedupe, so waiting changes nothing |
| F7 | Mined vocabulary terms admitted rows | His profile: `renal disease`, `stage renal`, `cloud`… Other profiles: see the replay |

## What this PR changes

1. **Filter before limit.** For keyword profiles, the fetcher scans the whole NAICS/PSC
   market (bounded at 4,000 rows) before applying the limit.
   - If the market is bigger than the bound, the fetch reports `scanTruncated`.
   - daily-alerts carries that into the email. A truncated check is disclosed as incomplete
     coverage ("…looked at the first 4,000 open notices… not a finding that none exist").
   - It is never reported as "No keyword hits".
2. **Evidence ranking — boosts and demotions, not strict tiers.**
   - Keyword hits are split into title and description. Within **keyword points**, one title hit (30) outweighs the most descriptions can add (3 × 6).
   - The final rank also adds NAICS, agency, deadline and set-aside points, which **can reverse that order**. A test pins a description-only notice outranking a title hit.
   - Ordering uses an unclamped `rank`; the display score stays 0–100.
   - Notices with nothing to submit (Special Notice, Presolicitation, Award, Justification) are **demoted by 40 rank points**. That is not a guarantee they rank below all actionable work, and a test pins a strong heads-up notice outranking a weak biddable one.
   - What prevents a heads-up notice reading as biddable is its stage label.
3. **Anchored agency identity** (`src/lib/alerts/agency-match.ts`):
   - toptier via the canonical resolver;
   - sub-agencies via curated alias full names;
   - never substring.
4. **Evidence + stage in the email.**
   - "Keyword “x” in title / in description", or "No keyword match — in your NAICS market".
   - "Bid" / "Respond, not priced" / "Heads-up only, nothing to submit".
   - SAM's `NONE` set-aside is no longer printed as a reason, and no longer earns +5.
5. **Never silently discard user-entered keywords.** One shared `KEYWORD_MAX_COUNT` (60)
   across the four user-input writers (Settings, onboarding profile, keywords/add, admin).
   - Before, these carried 40/30/40/30 silent slices.
   - Proven on the **real handlers** against a write-recording Supabase fake: 53 and 60 save intact; 61 returns 400 with **zero writes** and the prior list preserved.
   - **Documented exception — the vault prefill.** Its keywords are auto-DERIVED, not user input, so `mergeDerivedKeywords` adds them only into the remaining room. Existing keywords are never trimmed, and the derived terms that did not fit are reported in the response's `errors`.
6. **Vocabulary terms no longer admit rows** (separate commit, easy to drop). The
   `VOCAB_ALERT_EXPANSION` flag is inert until someone decides whether vocab earns a rank-only role.

The limit of 60 is a proposal, validated by the save-path tests above, not by one customer's list.

**Rarity weighting was NOT shipped.** It remains an experiment: rare words are not necessarily relevant.

## Final-review corrections (round 3, 2026-09-26)

Final code review of the pair (#1717 @ `9278985c` + #1718 @ `3b9e7cf7`) found verified
defects. Each fix below has a mutation check: the old behaviour turns its test red.

| # | Defect | Fix |
|---|---|---|
| 1 | UI claimed rejected keyword saves succeeded. The coverage banner set "✓ Added" and Market Research auto-capture was fire-and-forget. | Both read the response. The banner shows the server's error and keeps the button; the capture shows a "was not saved" toast. **Verified through the actual UI** (see below). |
| 2 | Filter-before-limit was partial: the preferred set was still cut to 200 **by deadline** inside the fetch, before newness, dedupe and ranking. | `keepAllPreferred` (renamed `fullMarketKeywordScan` in round 4 and made opt-in): daily-alerts receives every preferred row (≤ 4,000) and makes the final cut after eligibility and ranking. Tested at fetch level with 260 matches, where the only title match is 250th by deadline. The #1718 cron test covers the sent email. |
| 3 | Exactly 4,000 rows was reported as truncated. | After a full final page, probe one row past the bound. A failed probe is disclosed as possible truncation, never as complete. Tests: exactly 4,000 → complete; 4,001 → truncated. |
| 4 | The admin fixture send and the retry path rendered no reason line or stage. | The fixture scores with `scoreOpportunityDetailed`. Failed sends now store `evidence`, and the retry maps stored fields back onto the ones the email reads (department / NAICS / due date were blank before). Rows that failed before this change carry no evidence and render no reason line. |
| 5 | "In your NAICS market" was printed for PSC-only profiles. | Evidence now records **which market admitted the row** (`market`), computed with the same rule as the market filter: NAICS via `naicsInSavedMarket`, PSC by prefix. The label reads "NAICS market", "PSC market", or claims no market when neither admits the row (e.g. a fixture row). ⚠️ A first version inferred PSC from the scoring field `naics === null`. The #1718 fixture test caught it labelling a row admitted through a saved code's 4-digit NAICS group as "PSC market". Fixed before push; pinned by a test. |
| 6 | Adding one keyword at the limit said "You entered 61 … remove 1". | `keywordAddLimitError`: "You have 60 saved keywords; adding 1 would make 61…". |
| 8 | Paged reads over a live table can repeat or skip rows. | notice_id de-duplication removes **repeats only**. ⚠️ A row that moves backward across a page boundary before its page is read is **not recoverable**. A pinning test proves that limitation is real, so no one reads de-dup as a consistency guarantee. |
| 10 | The limit was counted differently per surface: Settings didn't split a comma paste; onboarding and add-keywords lowercased. | One normalizer, `validateKeywordSave` / `normalizeKeywordInput`, for Settings, onboarding, add-keywords and admin: <br>• split real separators; <br>• case-insensitive de-dup keeping the first spelling; <br>• an unusable entry (over-long blob, bare NAICS code) rejects the save with nothing written. <br>The same paste stores the identical list on all three user surfaces (tested on the real handlers). The prefill no longer re-cases saved keywords. |

**UI verification.** Three surfaces, all using the real components rendered in jsdom, with real
buttons clicked and only `fetch` intercepted. These are component renders, not a real browser.
- **Settings.** The real panel's save request goes into the **real** preferences handler over a write-recording fake.
  - 61 keywords → "Codes/keywords did NOT save: You entered 61 keywords… remove 1", zero writes, prior keywords kept.
  - 53 keywords → saved intact, with "Settings saved" shown.
- **Market Research build.** Its capture request goes into the **real** add-keywords handler.
  - At the limit → 400, zero writes, "“drone repair” was not saved to your keywords. You have 60 saved keywords…".
  - With room → saved, no warning.
- **Coverage banner "+ Add all".**
  - 400 → the server message shows and "✓ Added" never does.
  - A network failure → "Not saved".
  - 200 → "✓ Added".

**Large-market cost (measured on prod data, read-only, median of 3).** The heap figure is the delta per call.

| Profile | Rows scanned | Old | New | Heap |
|---|---|---|---|---|
| Emergency management | 449 | 441 ms | 663 ms | +5.3 MB |
| Fire alarm / security | 841 | 355–422 ms | 590–779 ms | +6.8 MB |
| Reported customer | 893 | 450 ms | 567 ms | +10.8 MB |
| Largest (80 NAICS, construction) | 4,000 (truncated) | 511 ms | **3,674 ms** | +22.5 MB |

- Process RSS: 163–189 MB.
- Of 286 daily keyword profiles, 5 have raw NAICS markets over 4,000. Raw counts overstate the real scan: one profile's raw count of about 2,000 scanned 841 after the set-aside and deadline filters.
- **Worst case +3.2 s per large profile.** Parallel page reads, or moving the keyword filter into SQL, is the obvious follow-up if batch timings approach the 300 s cap. Not done here.

**#9 — RESOLVED by isolation (round 4).** The replay below showed that routing the other callers
through the new scorer changed their ordering. That was a regression introduced through shared
code, so both shared entry points are now daily-alerts-only:
- `scoreOpportunity` is restored **byte-for-byte from main** (diff-verified, together with every
  helper it calls: certification, set-aside, VA, research-notice, description-term,
  deadline and `scoreContractDKeywords`). Daily alerts call `scoreOpportunityDetailed` explicitly.
- The full-market keyword scan is **opt-in** (`fullMarketKeywordScan`); only daily-alerts passes it.
  Weekly-alerts, send-briefings-fast, market-dossier, save-profile and the admin tools fetch
  exactly as on main.
- **Proof:**
  - `legacy-scorer.unit.test.ts` pins main's scores for 5 profiles × 19 notices (golden values generated by running main's code; every branch exercised) plus the orderings they imply. Re-routing the legacy scorer through the new one fails 5 of those cases.
  - A wiring test allows only daily-alerts to use the evidence scorer or opt into the scan.
  - Live replay (read-only), running each caller's own fetch and scorer on main vs the branch: identical rows, scores and ordering for 4 of 5 profiles on the first pass. The 5th differed once, when main and the branch were run CONCURRENTLY; sequentially they were identical 4/4 times. That market's 200-row cut falls inside a run of identical deadlines (rows 195–205 all 2026-09-28 00:00), so main's own unordered tie can vary between calls. That is pre-existing on main and untouched here.
- Migrating those callers to evidence ranking is a separate PR.

**Whole daily batch vs the 300 s budget (round 4, production data, read-only).**
- `cron_job_runs.duration_ms` records DISPATCH time (max 12 s), not execution. The job's real
  execution was measured from its own `alert_log` rows, grouped into per-run bursts:
  284 runs since 2026-09-19.
- **Today, before this change:**
  - A run processes a median of **44 users** (the configured batch is 70), at **6.57 s per user** (p90 6.92).
  - The first→last user span is p50 **284 s**, p90 **289 s**. Runs are already stopped at the platform limit, and rotation carries the rest to later runs.
  - About 34 of the 73 scheduled runs a day do work; 1,228–1,733 alerts a day.
  - So the batch does not "fit" 300 s today. It is time-capped by design, and throughput is the real constraint.
- **Added by this change**, measured on a deterministic random sample of 40 of the 706 affected users (distinctive keywords + NAICS; 47% of 1,493 targeted users). Fetch old vs new, sequential:
  - mean **+0.36 s** · p50 +0.15 · p90 +0.79 · max +1.95 per affected user (rows scanned p50 861, p90 1,733, max 4,000);
  - ranking the extra rows is included in the earlier per-profile measurement and is negligible (< 10 ms at ~900 rows);
  - rendering and sends are unchanged: the same number of cards and one email.
- **Estimate:**
  - average per-user cost 6.57 → ≈ 6.74 s, so ≈ 44 → ≈ 43 users per 290 s run (**−2.6%**);
  - a pathological run where all 44 users are affected at p90 would lose about 5 users (−11%);
  - with ~39 spare scheduled runs a day, every user should still be processed; the tail should finish about one run (~10 min) later.
  - Memory: +22.5 MB heap worst case (4,000 rows); process RSS 163–189 MB.
- **Pre-existing and NOT changed here:** runs end at the 300 s kill with a user possibly in flight. If
  the −2.6% is not acceptable, parallel page reads or SQL-side keyword filtering shrink the delta.

**#9 check (round 3, superseded by the isolation above) — callers that still sort by the capped score** (weekly-alerts, send-notifications,
diff-engine, trigger-alerts). Replay of that ordering on 5 profiles:
- **Top-10 overlap** old vs new: 5–10 of 10.
- **Emergency-management profile:** ties at 100 went from 10 to 4 and title-match rows from 1 to 3 (better); heads-up notices went from 3 to 5 (**worse**).
- **Reported customer:** heads-up 1 → 2 and no-keyword rows 7 → 8 (**slightly worse**).
- **Largest profile:** heads-up 2 → 0.

The mixed result comes from those callers not using the new unclamped rank, which carries the heads-up demotion. **Not neutral for those jobs.** Tracked with #9.

## Replay — main vs this branch (live data, read-only, 2026-09-26)

Five real daily-alert profiles in unrelated sectors. Columns count the top 10 rows.

| Profile | Rows with a title-level keyword | Rows with no match on the user's own keywords | Heads-up (nothing to submit) |
|---|---|---|---|
| A — AI / acquisition support (the reported case) | 1 → 3 | 0 → 0 | 2 → 0 |
| B — fire alarm / security systems | 3 → 3 | **6 → 0** | 0 → 0 |
| C — courier | empty market both | — | — |
| D — emergency-management consulting (40 keywords) | 1 → 2 | 0 → 0 | 3 → 0 |
| E — medical linen / janitorial | 0 → 0 | 1 → labelled market fallback | 0 → 1 (ranked last) |

**Improvements:**
- **A:**
  - VA Enterprise *Artificial Intelligence* Support Services, SeaPort-NxG *Program Management* Support and Think Trends (FDA, workflow automation) enter the top 10.
  - The MTCCS ceiling increase and the FHWA special notice drop out.
- **B:** three "Berlin Roof Replacement" notices (admitted only by vocab `roof`) drop out. The top 10 is now 5 rows, each with real evidence.
- **E:** the previous single row ("Residential Reentry Services", admitted only by vocab `reentry`) is now shown honestly as a NAICS-market fallback with the note. Protective Clothing and Laundering now leads.

**Relevance losses (reported, not hidden):**
- **A:** NOAA Mobile Device Management SaaS (FedRAMP/FISMA in description) and ARTS-V3 Third-Party Software (software development) leave the top 10. Both are plausible fits.
- **B:** `W50S8126QA014`, a notice whose title is only a solicitation number, leaves. Its relevance is unknown.
- **D:** an ARPA-H SBIR/STTR notice with a **title** keyword hit is demoted by the stage penalty (it is a heads-up notice).
- The 10 matches the full-market scan recovers for A are mixed: SeaPort PM support, Agile Professional Services and PM Support Bridge 4 fit; a wastewater monitor, an A&E IDIQ and submarine combat systems do not.

**Still wrong on A after this PR:**
- "Warehouse Support Services Recompete" ranks #6 on one boilerplate "compliance" description hit plus NAICS, agency and SDVOSB points.
- Duplicate notices (the same PTAG RFI twice) take two slots.
- A title-level program-management match (PMA-231) now edges Think Trends, which has four description hits. Which of two real fits leads is a weighting choice I did not tune to one customer.

**D:** the ranking cannot fix the profile's own keywords ("Department of Defense", "subcontractor", "Sam.gov").

## Explicitly OPEN — the attachment findings this PR does NOT repair

1. **Two railway grants** (FR-CRS-23-005 Vermont Amtrak Stations Rehabilitation; FR-CRS-23-006 Bellows Falls Intermodal Center).
   - Zero keyword evidence in either synopsis.
   - Each passed on agency identity alone. DOT and FRA are both in his list: +25, a genuine agency match, not the substring bug. Add +15 closing-soon and +10 ceiling ≥ $1M.
   - They are congressionally directed awards to named recipients, not open to a services firm.
   - `scoreGrant` has its **own** substring agency bug: today's only passing grant for this profile (NRCS "Easement Restoration") passes on "VA" ⊂ "conser**va**tion".
2. **Deadline handling.**
   - A grant that had already closed (09/23 → Sep 23 00:00 UTC, `daysUntil = -1` at send) was mailed and even earned the closing-soon bonus. `searchGrantsByNAICS` has no closed filter.
   - The email date and subject use the server's UTC date ("SEP 24") while the profile timezone is America/New_York, where the send was Sep 23, 11:44 PM.
3. **Recompete ("Coming back to market") relevance.**
   - Rows are ranked window → prime-fit → **dollar value**; keyword hits are explicitly not a sort key, and agency is not considered.
   - All five emailed rows had a keyword hit in their description. Two were "compliance" in another sense (IT systems compliance; taxpayer compliance). One was Splunk license resale.
   - The email showed none of that evidence. It printed NAICS provenance instead.
4. **"size-fit prime".**
   - Means any contract under `MEGA_TEAMING_USD` = $250M for a small business, so an $88.6M ceiling reads "prime" for a small SDVOSB.
   - It and "inferred NAICS · stored without direct evidence" are internal classification text printed into customer HTML.
5. **Headline counts.**
   - The subject took the fallback path ("9 opportunities in your market"), but the body always says "9 **new** opportunities match your market" (`daily-alerts/route.ts`, unconditional). The existing fallback test does not cover that sentence.
   - 9 = 7 opportunities + 2 grants, beside "View all 7 matches".
   - "7 are set-aside" counts SAM's `NONE` because the code compares against `'None'`.

## Other open items found along the way

- PSC codes are still silently capped at 30 in the `preferences` and `profile` routes.
- Several briefing paths truncate keywords for their own queries (10 or 20). That is outside daily alerts.
- Keyword-only profiles (no NAICS/PSC) still query with the first 15 distinctive keywords.
- Migrate weekly-alerts / send-notifications / diff-engine / trigger-alerts (and the non-daily fetch callers) to evidence ranking — separate PR; they are pinned to main's behaviour until then.
- Scan cost: −2.6% daily-alert throughput expected (budget section above); parallel reads or SQL keyword filtering if that is not acceptable.
- Same-title duplicate notices are not collapsed (PTAG ×2, Berlin Roof ×3, Hydrologic ×4).
- Whether `VOCAB_ALERT_EXPANSION` earns a rank-only role.
- Rarity weighting as a measured experiment.

## Tests

- `src/lib/keywords/keyword-save-handlers.unit.test.ts` — the real save handlers against a write-recording fake: 53/60 intact; 61 → 400, zero writes, prior list preserved; keywords/add at and over the limit; an existing over-limit row is never trimmed; the prefill exception.
- `src/lib/alerts/alert-relevance-case.unit.test.ts` — frozen real-data case plus two unrelated profiles, the stage label, "no vocab admission", and the ranking NON-guarantees (bonuses can reverse title > description; heads-up is a 40-point demotion only).
- `src/lib/alerts/agency-match.unit.test.ts` — NIST vs Administration, VA vs Veterans Affairs / Naval, State vs "United States", parent vs component.
- `src/lib/briefings/pipelines/sam-cache-filter-before-limit.unit.test.ts` — a match at row 420 of 450 is found. With the only match beyond row 4,000: the fetch misses it, reports `scanTruncated`, and the note daily-alerts prints discloses incomplete coverage instead of "no keyword match". Also checks that the route wires the fetch's coverage into that note.
- `src/lib/keywords/keyword-limit.unit.test.ts` — the 53-keyword list fits; over-limit is reported; the preferences route rejects before any write; no writer keeps a silent keyword cap.

Each new guard was proven by injecting the old behaviour (red) and reverting (green).
