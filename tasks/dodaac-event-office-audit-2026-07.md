# DoDAAC / event-office resolution audit (2026-07-10)

## The user-visible bugs (Target List cards, /app?panel=target-list)
1. **"337 events" repeated across different Army offices** — dept-wide DoD event
   count leaking onto office cards. It's a STALE STORED SNAPSHOT (user_target_list
   .upcoming_event_count is written at save time, never recomputed) AND the number
   drifts (whole-DoD count today = 295).
2. **"from NAICS 33451,336411,…" raw pill** — provenance badge rendered the whole
   comma-list. ✅ FIXED (hidden; source_naics still stored + used server-side).
3. **Pain points on some agencies not others** — WORKING AS DESIGNED: pain points are
   NAICS-indexed; offices without a NAICS-aligned pain point correctly show none.

## Root cause (measured, not guessed)
`sam_events.agency` is DEPARTMENT-level only — every DoD event = "DEPT OF DEFENSE"
(295 upcoming). Real buying office is encoded in the solicitation-number DoDAAC
(6-char prefix). `event-office.ts` decodes it → office. **NOT a live-USASpending
issue** — it's stored SAM notice data + an incomplete office-resolution layer.

## How HigherGov / GovTribe solved it
Not a magic API — a MORE COMPLETE version of our pipeline:
(a) a decoder that tolerates SAM's messy sol-number formats,
(b) a near-complete DoDAAC directory,
(c) SAM office/sub_tier as a FIRST-CLASS fallback (not last resort),
(d) resolve-to-canonical-office AT INGEST, then count by GROUP BY office.

## Decode-gap audit — 295 upcoming DoD events
| bucket | count | % | fix |
|---|---|---|---|
| decoded + in directory | 150 | 51% | working |
| decoded but NOT in dodaac_directory | 38 | 13% | fill directory (~25-30 real) |
| sol present, decode FAILS | 82 | 28% | **decoder regex (~50 real DoDAACs)** |
| no sol number | 25 | 8% | needs SAM-office fallback |

dodaac_directory = 4,813 entries. stored inferred_dodaac = 64% populated.

## The decoder bug (src/lib/gov-contacts/dodaac.ts, line 94 guard)
`decodeDodaac` requires a plausible FY at chars 7-8 (anti-false-positive guard).
Two real DoDAACs get rejected:
- **Suffix hyphens:** `W911S626QA025-SSN` → dashed branch splits on '-', parts[1]='SSN'
  → fyStr='' → null. But W911S6 is a valid Army DoDAAC (FY is at 7-8 of the COMPACT
  string, not after the hyphen). The '-SSN'/'-SourcesSought' suffix is NOT the FY delimiter.
- **Underscore formats:** `FA8105_CCR_Rev2` → compact FA8105CCRREV2, chars 7-8 = 'CC'
  → not digits → null. FA8105 = valid Air Force DoDAAC.

Fix idea (CAREFUL — the FY guard prevents garbage decodes): try FY at the compact
chars 7-8 FIRST (always), and only use the dashed-split FY when the compact FY isn't
a valid year. Keep the UUID reject + the letter-first + FY-range guards. Validate the
6-char prefix against dodaac_directory as an additional real-DoDAAC signal so we can
safely relax the FY requirement when the prefix IS a known DoDAAC.

## Recommended order (all measured; do NOT bulk-write without Eric's ok)
1. **Decoder regex fix** (dodaac.ts) — ~50 events, pure code, no migration, helps all
   future events. Highest leverage / lowest risk. Add unit tests for the failing samples.
2. **Fill dodaac_directory gaps** — add the ~25-30 real missing codes (PANMCC, PANERD,
   FD2030, HQ0100, N4571A, FA8105, FA8507, W911S6…). Config/data add.
3. **SAM-office fallback into the count key** (TMR route line 1018/1190) — rescue the
   civilian + no-sol events; count by resolved office, not just inferred_dodaac.
4. **Backfill** existing sam_events inferred_* + recompute saved-target snapshots so
   the stale 337/295 clears. (Bulk write → ask Eric first, dry-run, show counts.)
5. Longer term: resolve-at-ingest into a canonical office id (the HigherGov model).

## Directory-fill investigation (2026-07-10) — DEAD END, redirected
Checked all 38 "missing decodable" codes against FPDS (BigQuery awards.awarding_office,
the authoritative name source). **0 of 38 exist in FPDS.** Root cause:
- **67/71 (94%) of these events are RFI / Sources Sought / Industry Day = PRE-AWARD.**
  FPDS only records AWARDS, so it structurally has no office name for a code that
  hasn't awarded yet. 16 are Panama/overseas PAN* codes (same story).
- Many "codes" were FY-heuristic FALSE POSITIVES from title slugs (IPOPFY←"IPOP-FY26",
  NISTSS←"NIST-SS26", REQUIR←"REQUIREMENTS", TREXII, RFIFOG…). The new
  directory-authoritative decoder already rejects these in production.
**Conclusion:** cannot fill from FPDS, and must NOT hand-write office names (rule #1:
no LLM-guessed data). Directory-fill is NOT the lever.

**REDIRECT → the real remaining lever is SAM's own office field.** SAM populates
`office`/`sub_tier` (and we store inferred_office/inferred_subagency) on these pre-award
notices even when FPDS can't. Next step = wire the SAM-resolved office into the TMR
count key (route.ts line 1018/1190) so pre-award events count to their SAM office
instead of the whole-DoD bucket. (resolveEventOffice() in event-office.ts already does
DoDAAC→then→SAM-office; the COUNT path just doesn't use the SAM-office result yet.)

## Fixed this session
- NAICS/PSC provenance pill hidden (MyTargetListPanel.tsx). ✅ committed.
- decodeDodaac: suffix-hyphen + underscore formats + directory-authoritative. ✅ committed
  (51%→60% office resolution, 12 unit tests, 217/217 suite green).
- Directory-fill: investigated, found to be a dead end (above) — no bogus rows added.
