# Proposal Eval Harness

Train / iterate Proposal Assist **outside the app** — no clicking, no auth — then
ship the hardened prompts in the next deploy. Same arc as Content Reaper.

It drives the EXACT app library (`src/lib/proposal/generateAllSections`), so what
you tune here is what users get.

## The loop

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"

# 0. (once, or to refresh) auto-pick a spread of real notices from the cache
npx tsx scripts/proposal-eval/pick-cases.ts          # → cases.json
#    N=20 npx tsx scripts/proposal-eval/pick-cases.ts

# 1. generate drafts for every case (the "render separate" engine)
npx tsx scripts/proposal-eval/run-eval.ts            # → out/drafts.json

# 2. grade them (LLM judge + hard fabrication fact-check)
npx tsx scripts/proposal-eval/score.ts               # → out/report.md

# 3. read out/report.md → fix prompts in src/lib/proposal/sections.ts (or v2.ts)
#    → re-run steps 1-2. Repeat until: avg ≥ 90 AND fabrications = 0.

# 4. ship — the prompts are already in the libs the app calls, so:
#    git commit && git push && vercel --prod   (the release IS the deploy)
```

## Scoring

- **Fabrication = auto-fail (score 0).** Any number / % / $ / contract ref /
  email / phone / org name in a draft that isn't in the vault or the notice is an
  invented fact. This is the #1 proposal failure (e.g. "15% savings", "John Doe").
- **Quality 0-100** (only counts if no fabrication): responsiveness, structure,
  federal voice, concision. 90+ = submission-ready.

## Files

| File | Role |
|---|---|
| `pick-cases.ts` | Auto-select real notices (with real body text) → `cases.json` |
| `run-eval.ts` | Generate drafts via the real lib → `out/drafts.json` |
| `score.ts` | Judge + fact-check → `out/report.md` + `report.json` |
| `lib.ts` | Shared notice-body resolution + vault known-facts loader |

Vault used: `eric@govcongiants.com` (GOVCON GIANTS INC). Change `vaultEmail` in
`cases.json` to test a different bidder.

Notes:
- `out/` is git-ignored (generated artifacts).
- Fabrication detection is a loose substring check — it's conservative by design
  (better to flag a borderline fact for human review than to miss an invented one).
