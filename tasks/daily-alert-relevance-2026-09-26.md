# Daily-alert relevance — investigation + fix batch (2026-09-26)

Customer case: an SDVOSB AI / acquisition-support firm ("Customer A"). He reported the
2026-09-24 alert and his keyword list, and believed "the algorithm just needs a few more
days to refine". Identity is kept out of the repo on purpose; the named investigation lives
outside version control.

**His account was not changed and nothing was sent to him.** All production access was read-only.

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
   market (bounded at 4,000 rows) before applying the limit. Hitting the bound is reported
   as `scanTruncated`, never silent.
2. **Evidence ranking.** Keyword hits are split into title and description.
   - One title hit (30) outweighs the most descriptions can add (3 × 6).
   - Ordering uses an unclamped `rank`; the display score stays 0–100.
   - Notices with nothing to submit (Special Notice, Presolicitation, Award, Justification) rank below actionable work.
3. **Anchored agency identity** (`src/lib/alerts/agency-match.ts`):
   - toptier via the canonical resolver;
   - sub-agencies via curated alias full names;
   - never substring.
4. **Evidence + stage in the email.**
   - "Keyword “x” in title / in description", or "No keyword match — in your NAICS market".
   - "Bid" / "Respond, not priced" / "Heads-up only, nothing to submit".
   - SAM's `NONE` set-aside is no longer printed as a reason, and no longer earns +5.
5. **Never silently discard keywords.** One shared `KEYWORD_MAX_COUNT` (60) across all five
   writers (was 40/30/40/30, each a silent slice).
   - Over-limit saves return 400 and write nothing.
   - The Settings panel already surfaces a failed save.
   - The vault prefill never trims existing keywords.
6. **Vocabulary terms no longer admit rows** (separate commit, easy to drop). The
   `VOCAB_ALERT_EXPANSION` flag is inert until someone decides whether vocab earns a rank-only role.

⚠️ **Decision needed:** 60 is my choice. It admits the largest real list on record (53) with
headroom. Daily alerts match keywords in memory, so the count does not grow the SQL query.

**Rarity weighting was NOT shipped.** It remains an experiment: rare words are not necessarily relevant.

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
- Same-title duplicate notices are not collapsed (PTAG ×2, Berlin Roof ×3, Hydrologic ×4).
- Whether `VOCAB_ALERT_EXPANSION` earns a rank-only role.
- Rarity weighting as a measured experiment.

## Tests

- `src/lib/alerts/alert-relevance-case.unit.test.ts` — frozen real-data case plus two unrelated profiles, the stage label, and "no vocab admission".
- `src/lib/alerts/agency-match.unit.test.ts` — NIST vs Administration, VA vs Veterans Affairs / Naval, State vs "United States", parent vs component.
- `src/lib/briefings/pipelines/sam-cache-filter-before-limit.unit.test.ts` — a match at row 420 of 450 is found; truncation is reported.
- `src/lib/keywords/keyword-limit.unit.test.ts` — the 53-keyword list fits; over-limit is reported; the preferences route rejects before any write; no writer keeps a silent keyword cap.

Each new guard was proven by injecting the old behaviour (red) and reverting (green).
