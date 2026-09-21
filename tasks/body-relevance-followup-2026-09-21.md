# Follow-up: body relevance for /try (NOT started)

**Status: not started. Evidence frozen, nothing built.**
Fixtures: `src/lib/beginner/__fixtures__/body-relevance-cases.ts`
Origin: PR #1610, where a first attempt was built and removed the same day.

## The gap

`/try` admits an opportunity only when the **title** names the user's work,
because the title is the only text `search_sam_opportunities` returns. That is
correct — a match we cannot see is a match we cannot defend — and it also
hides real markets:

| probe | open titles |
|---|---|
| `lawn` | 0 |
| `mowing` | 0 |
| `grounds maintenance` + `groundskeeping` + `landscap*` | 24, of which 17 are NAICS 561730 |

A lawn-mowing company has ~18 open notices and sees none of them by name. The
corpus *does* connect the words — through the description ("…frequent mowing,
weeding, and general lawn maintenance year-round…").

## What was tried and removed (2026-09-21)

`detail-evidence.ts`: on an empty direct group, fetch `description`/`sow_text`
for candidates already returned, match the activity term, render the passage
under *"Your words are in this listing's details:"*.

Measured end-to-end against the live cache: **26 hits across 10 inputs, ~19
(73%) did not describe the user's work.** Because the card asserted the
notice's own text as evidence, each wrong hit was an affirmative false claim
with the proof attached. Removed rather than patched.

## What a replacement must handle

Every class in the fixture, with the real passage:

- **submission boilerplate** — *"a written condition report **detailing** the failure"*
- **site-access boilerplate** — *"Contractors must be **escorted** at all times"*
- **table of contents** — *"………26 5.4 **Escort** Requirements………"*
- **FAR clause text** — *"**tailored** in accordance with FAR 12.302"*
- **scope exclusion** — *"acoustic **caulking** … **is outside the scope of work**"*
- **negation** — *"**No pressure washing** historic buildings"*, *"PEST CONTROL (RESERVED)"*
- **wrong word sense** — *"collecting, preserving, **interpreting** … the history of USACE"*
- **product attribute** — *"Passenger **upholstery**: high-durability vinyl"*
- **buyer letterhead** — *"DEPARTMENT OF HOMELAND **SECURITY** UNITED STATES COAST **GUARD"***
- **proximity ≠ phrase** — *"low **pressure** fresh water **wash** down"*

…while still admitting the three genuine rescues in the fixture.

## Design notes for whoever picks this up

1. **`stripBuyerNames` already exists** in `relevance.ts` and is applied to
   titles. It was not applied to the body. Apply it.
2. **A phrase check must be ordered and adjacent.** The removed
   `DETAIL_PHRASE_SPAN = 40` was order-free proximity while its own comment
   claimed to be a phrase check: `findTermInText("the staffing plan shall
   address medical surveillance requirements", "medical staffing")` matched.
3. **Section matters more than distance.** Nearly every false positive sat in
   submission instructions, evaluation criteria, FAR incorporations, site-visit
   logistics or a TOC. Locating the SOW/PWS scope section and matching only
   inside it is probably worth more than any scoring change.
4. **Negation and exclusion need explicit handling** ("no", "not", "excluded",
   "outside the scope", "RESERVED").
5. **Accounting**: see `BODY_RELEVANCE_ACCOUNTING_RULES` in the fixture — pool
   must exclude title-matched rows, counts must match what renders, dedupe
   before counting, cap needs a ranking, and the live oracle's `toItem()` must
   carry `notice_id` or the path is not exercised at all.
6. **The copy must hedge in proportion to the evidence.** "Your words are in
   this listing's details" is a strong claim; at 27% precision it was unearned.

## Do not

- Do not revive the removed implementation.
- Do not substitute a synonym/code hop. Three have now been measured and
  rejected: `naics_vocabulary` activity ranking (`physical` outranks `guard`),
  market expansion from the direct hits' NAICS (562998 → "grease trap"), and
  `lawn` → 561730 (`lawn` → 333112 lawn-mower manufacturing, df 17). See
  `docs/engineering/try-relevance-regression.md`.
