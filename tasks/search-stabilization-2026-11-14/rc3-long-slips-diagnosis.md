# RC3 long-search slips: diagnosis (analysis only, no RC3 change), 2026-11-15

Method: the holdout runner (agent3/holdout-runner @ c47a0f68d) on the RC2 tag (065451a66) and the RC3 head (34aad5828), using
the same Nov 14 snapshot (9,701 notices). A "distinct" solicitation is the solicitation number plus the title.

## Finding 1: the paving long and medical long drops are duplicate copies leaving the top 20

| phrasing | distinct in top 20, RC2 | distinct in top 20, RC3 | RC2 distinct lost in RC3 | copies RC2 counted more than once |
|---|---|---|---|---|
| paving#1 (long) | 16 | 20 | **0** | Parking Lot Repairs ×2, Seal & Stripe Parking Lots ×2, NE Pavement Preservation ×3 |
| medical#1 (long) | 17 | 20 | **0** | Roche reagents ×2, DLA Safety Gloves ×3 |
| paving#0 (short) | 15 | 20 | 0 | NE Pavement ×5, St. Lucie Jetty ×3 |

RC3 keeps every distinct RC2 solicitation and adds new ones in the freed slots. Under raw counting, RC2 counted 4 (paving) and
3 (medical) extra copies of relevant notices. That matches Agent 4's raw drops: paving 15–17 → 12–14 and medical
16–17 → 13–17. Under "count each solicitation once", these are not regressions. **This depends on Eric's top-20 counting
decision.**

## Finding 2: the slots freed in the top 20 are filled with weak DIRECT matches on single words (the real quality lever)

Rows that entered RC3's top 20 at tier 0 DIRECT with basis `buy_side_text`:

- **paving#1:**
  - "MITR Chemically Milled Plate" (FSC 9650). "mill" is a verb in the business's sentence.
  - "Concrete Shield Blocks" (AJ13, an R&D code). This is a product, not concrete work.
  - "Acid Mine Drainage Remediation". "drainage" is out of context.
  - Already present in RC2: "STABILIZER BAR DAMPER … PAVE HAWK" (FSC 1615), matched on "pave".
- **medical#1:**
  - Already present in RC2: "PERCUSSION CONSUMABLES" (FSC 7720) and "NATIONAL MENU - DRESSING AND CONDIMENTS" (FSC 8950).
    Both match because "consumables" and "dressings" are list words.

Cause: in a long capability list, each list word is an eligible alternative. One of those words in the title head is enough
for DIRECT, with no check on the word's sense or on whether the PSC family fits. This is the same family of problem as
"parts … for vehicles" and the IT-long drift into services.

Candidate fix, not built, pending Eric's approval:
- For long-list queries, a single list word in the title head is DIRECT only when the notice's PSC family agrees with the
  business's trade (construction Y/Z for paving; 65xx for medical). Otherwise the row is RELATED.
- Labels never drop a row.
- Measure on the benchmark: paving, medical, parts, IT long; with a no-regression check on short phrasings.

## Other lost distinct solicitations (intended RC3 effects, already scored by Agent 4 as wins)

- ithardware#0/#1: IT services notices left the top 20 (14 and 16 lost). They were replaced by hardware PSC items.
- steelbldg#0: steel material and supply buys left (11 lost). They were replaced by building and roofing work.
- nursing#1: 10 lost. The nurse-staffing trade replaced loosely related hospital notices. Agent 4 still has nursing long
  below 40%, so worth a look if RC3 continues.

## Result: long-list family guard (branch agent3/long-list-family-guard, based on RC3 preview 34aad5828)

Built per Finding 2. It is development only: no tag, no deploy, and not on the RC3 line. Code is in
`src/lib/opportunities/evidence-classifier.ts` (`longListGuard`). Tests are in `long-list-family-guard.unit.test.ts`
(11 tests). With the guard disabled, 5 of them fail.

Scope and safety, measured with the holdout runner on the Nov 14 snapshot (9,701 notices, 28 public phrasings):
- **Matched sets:** 0 of 28 changed. Retrieval is untouched.
- **Short phrasings:** 14 of 14 have the same top 20, including labels.
- **Rows:** none are dropped. A guarded row moves from DIRECT to RELATED (basis `single_list_word`) and gets a reason
  shown to the user.
- **Sentence structure:** read from `plan.raw`. The residual strips periods and colons, so a "for" clause swallowed the
  rest of the paragraph. An early build that read the residual demoted real trash-removal notices; this is fixed and
  pinned by a test.

Top 20 against the benchmark labels Agent 3 holds (v4–v6 merged; not v7, not sealed):
- `raw lo-hi/labelled` counts every row in the top 20. `dist` counts each solicitation once.
- Many top-20 rows are unlabelled, so these are **lower bounds on coverage**. Agent 4's v7 labels are the real score.

| long phrasing | RC2 | RC3 preview | RC3 + guard |
|---|---|---|---|
| janitorial | raw 5-5/6 dist 3/4of11 | raw 7-7/8 dist 7/8of20 | raw 8-8/8 dist 8/8of20 |
| nursing | raw 2-2/4 dist 1/2of15 | raw 0-0/8 dist 0/8of20 | raw 0-0/8 dist 0/8of20 |
| hvac | raw 7-8/9 dist 7/8of17 | raw 6-7/9 dist 7/9of20 | raw 6-7/9 dist 7/9of20 |
| guards | raw 8-10/17 dist 6/11of14 | raw 4-6/17 dist 6/17of20 | raw 4-6/17 dist 6/17of20 |
| steelbldg | raw 1-2/2 dist 1/1of16 | raw 3-3/3 dist 3/3of20 | raw 4-5/10 dist 5/10of20 |
| grounds | raw 16-19/19 dist 11/11of12 | raw 14-17/19 dist 17/19of20 | raw 14-17/19 dist 17/19of20 |
| paving | raw 10-10/10 dist 7/7of16 | raw 7-7/7 dist 7/7of20 | raw 9-10/10 dist 10/10of20 |
| parts | raw 0-0/1 dist 0/1of13 | raw 6-6/7 dist 6/7of20 | raw 15-15/17 dist 15/17of20 |
| fasteners | raw 10-10/10 dist 10/10of20 | raw 10-10/10 dist 10/10of20 | raw 10-10/10 dist 10/10of20 |
| electrical | raw 9-9/9 dist 8/8of19 | raw 8-8/8 dist 8/8of20 | raw 8-8/8 dist 8/8of20 |
| valves | raw 14-16/18 dist 13/15of16 | raw 14-15/17 dist 15/17of20 | raw 14-15/17 dist 15/17of20 |
| aircraft | raw 3-3/4 dist 2/3of19 | raw 2-2/3 dist 2/3of20 | raw 3-3/4 dist 3/4of20 |
| medical | raw 7-8/8 dist 8/8of17 | raw 7-10/10 dist 10/10of20 | raw 8-11/12 dist 11/12of20 |
| ithardware | raw 0-1/2 dist 1/2of17 | raw 1-1/3 dist 1/3of20 | raw 1-1/3 dist 1/3of20 |

Rows the guard moved out of the top 20 (long phrasings):
- **paving:** the "PAVE HAWK" damper (1615), Concrete Shield Blocks (AJ13), Chemically Milled Plate (9650).
- **medical:** Percussion Consumables (7720), Dressing and Condiments menu (8950), Safety Gloves (4240), fall-detection
  devices (6350).
- **parts:** 11 whole-vehicle, vehicle-lease and vehicle-barrier notices.
- **steel:** steel plate, welding wire, poles and gas cylinders (product buys for a work business).
- **aircraft:** hydraulic dispensing units.
- **janitorial:** window-assembly parts (9340, 2040).
- **Known cost:** "Prefabricated steel sheds" (5410, labelled FIT for steel buildings) moved to RELATED. It is still shown,
  just lower.
- **Not addressed:** IT long stays at 1/3 labelled. Its weak rows are RELATED product-code fill (e.g. engine manuals filed
  under 7E20), not single-word DIRECT, so this guard does not reach them. Nursing long (0/8) is untouched; trade presets
  are out of scope.
