# P0-1 Task 0 — the anchor selection path, traced

**Status: trace complete, no fix written.** The PRD's stated root cause is **not confirmed**;
the actual mechanism is upstream of where the PRD looked. Recorded before any code changes,
per the standing rule that PRD root causes are hypotheses.

## The live path

`capability_market_match` routes to `capabilityMarketMatch()` in
`src/mcp/tools/capability-market-match.ts` (registry line 1808).
`src/mcp/tools/capability-match.ts` is a DIFFERENT, older tool (`capabilityMatch`, imported
only by `src/mcp/server.ts:283`). Do not edit it for this defect.

## The decisive line

```
src/mcp/tools/capability-market-match.ts:125
    const lead = keywords[0];
```

Every downstream section — market coverage, NAICS anchor, vocabulary, competitors,
forecasts, recompetes — is derived from **one keyword: the first one**. The entire market
read for a company rests on a single token winning a cosine-similarity sort.

## Why "small" won

`src/lib/market/semantic-keywords.ts:89`

```
if (w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
```

Any word ≥4 chars not in `STOP` becomes a standalone candidate. `small` is not in `STOP`
(verified). So `"small parts"` / `"small batch"` in a machine shop's description emits the
bare unigram **`small`** as a candidate.

Candidates are then ranked by cosine similarity against the whole input blob
(lines 168-183). A high-frequency generic adjective embeds close to the blob's centroid,
so `small` can outrank `precision machining`. It won, and `keywordCoverage('small')`
returned the **small-arms ammunition** market — 332993 at 55% of $16.3B.

This is the same defect the PRD filed separately as **P2-1 (unigram vocabulary)**. It is not
a cosmetic vocabulary issue. It is the P0-1 root cause. **P2-1 should be re-scoped or merged
into P0-1.**

## Why removing "small" still failed

With `small` gone, the lead became `made-to-print` → 333244 **Printing Machinery**. The
tokenizer has no way to know "made-to-print" is a machining term of art, not printing. So
the failure is not one bad word — it is that **a single keyword cannot carry a company's
market**, and nothing downstream can recover from a wrong pick.

## Why the existing guard never fired

Lines 137-143:

```
const GENERIC_SERVICES = new Set(['561210','561990','541990','561499','541611','541618']);
const isPscPinned = Boolean(coverage?.pinnedPscCodes?.length);
const nonGenericLead = coverage?.allNaics?.find((n) => !GENERIC_SERVICES.has(n.code))?.code;
const leadNaics = isPscPinned ? (nonGenericLead ?? …) : (coverage?.allNaics?.[0]?.code ?? …);
```

Two independent reasons it cannot fix this:

1. **`nonGenericLead` is only consulted when `isPscPinned`.** On the non-pinned path the
   code takes `allNaics[0]` unconditionally.
2. **332993 is not in `GENERIC_SERVICES` anyway.** The set catches facilities/admin
   catch-alls. Ammunition Manufacturing is a specific manufacturing code — a *precise* answer
   to the *wrong question*. The guard was built for FM-U10 (EOD → 561210 Facilities Support)
   and correctly does not fire here.

**This is why FM-U10 was "fixed" twice and reopened.** The fix was real for its own case and
had no bearing on a bad lead keyword. `capability-match-anchor.unit.test.ts` asserts
`expect(src).toContain('GENERIC_SERVICES')` — it passes on source text while the tool returns
Ammunition Manufacturing for a machine shop. Confirms the Task 0 finding.

## The defect, restated

> A single embedding-ranked keyword — which may be a bare generic adjective — is the sole
> anchor for the entire market read, and no downstream stage validates that the resulting
> NAICS is consistent with the company's described work.

Two candidate remedies, both to be validated against the harness, not assumed:

- **A. Fix the candidate generator** (narrow): suppress bare generic modifiers as standalone
  candidates; require unigrams to be domain nouns. Cheap, but only moves which single
  keyword wins — `made-to-print` still fails.
- **B. Anchor on a keyword SET with a consistency check** (structural): resolve coverage
  over the top-N keywords and require the lead NAICS to be corroborated by more than one.
  Addresses both observed failures.

B addresses the mechanism; A addresses one symptom. Recommend B, with A as a component.
**Confirm against a red test before writing either.**

## Next

Extend the seam layer to invoke `capabilityMarketMatch()` with only `embedText` and the
coverage data boundary stubbed — reproducing `keywords[0] === 'small'` deterministically —
and watch it go red. Do not stub `keywordCoverage`; it contains the coverage selection
under test.
