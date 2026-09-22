# POTETO — Pursuit Dossier Truth

Fixture: VA **36C24226Q0857** (demolition/asbestos IDIQ, East Orange & Lyons NJ).
Journey: SOLICITATION → INCUMBENT → COMPETITION → CONTACT → PRICE → ACTION → SHARE

## Production journey before the fix (hosted MCP, SHA 52b6fb4f)

| stage | verdict | evidence |
|---|---|---|
| SOLICITATION | ✅ | correct notice, open, NAICS 236220, PSC Z1DA, deadline 2026-10-14 |
| INCUMBENT | ✅ (P0 lock) | `incumbent: null`, no AT&T |
| COMPETITION | ✅ | rule-of-two met, depth 171, sample 200/34,302, caveats intact |
| CONTACT | ❌ **missing** | CO named **8x in the package**, absent from all 10 contacts |
| PRICE | ⚠️ **presentation** | refusal correct, reason factually wrong |
| ACTION | ❌ **wrong** | steered into an extractor with unverifiable citations |
| SHARE | — **N/A** | no hosted artifact in the tool contract |

## Corrections to the prior audit (reproduce-first)

Two reported defects **did not reproduce** and were deliberately NOT "fixed":
- name/title reversal — all 10 rows clean (`"Jeffrey Rozema"` / `"Contracting Officer"`)
- malformed phones — all well-formed; no `216791230049531`, no `(No Calls Will Be Accepted)`

The extractor problem is also **narrower** than reported: 63/72 quotes verify.

## Root causes and fixes

**CONTACT** — `pursuit-dossier.ts` sourced people only from
`searchFederalContacts({agency, office})`, a national directory. The package was
already fetched for the documents section and never read. Now
`extractPackageNamedContacts()` reads that text; the directory is kept as
fallback and deduped by email.

⚠️ **Ranking by job title was wrong, and measuring proved it.** Karmazyn and
McIntosh are both literally labelled "Contracting Officer" — but only inside a
past-performance questionnaire TEMPLATE dated January 2024. Spivack carries no
adjacent title yet the live solicitation routes the actual work to him twice
("all questions must be submitted in writing to…", "Quotes shall be emailed
to…"). Title-first ranking surfaced the stale template contact. Ranking on
**submission routing** surfaces the real one. A title makes someone plausible;
being the address the solicitation routes offers to makes them correct.

**PRICE** — the CALC refusal for sector 23 is correct and is preserved. The
REASON called NAICS 236220 "a manufacturing/product/wholesale code"; sector 23
is **Construction**. Added a sector label table and construction-specific
guidance (price from the Davis-Bacon wage determination, not CALC).

**ACTION** — removed `extract_compliance_matrix` from the recommendation.
Measured: 9/72 rows carry a `source_quote` absent from the 257,674-char package,
and 4 cite a "Section L" the package does not contain. The tool remains
available; the dossier no longer steers into it as if verified.

**SHARE** — N/A. `client_name` sets a label only; no share URL is promised.

## Deliberately out of scope

**An unrecognized argument charges 100 credits for an empty dossier.** Passing
`solicitation` (instead of `solicitation_number`) returns a `miss()` with
`grounded:false, degraded:false` — and bills. Preventing it needs a change to
shared metering semantics (`runMeteredTool`'s DEFECT-7 rule requires
`degraded && !grounded`, and a genuine no-match bills by design). Out of scope
per instruction. **Separate Poteto candidate.**

The compliance-matrix extractor itself is not fixed here — it needs its own
acceptance standard.
