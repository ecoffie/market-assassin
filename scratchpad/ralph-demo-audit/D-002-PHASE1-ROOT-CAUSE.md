# D-002 Phase 1 failure (after accept fix)

## Reproduction
- Host: `https://getmindy.ai` (market-assassin `dpl_H6ktLmci…` / `4b6dff52`)
- Auth: minted MI session `eric@govcongiants.com`
- `POST /api/app/market-research` → **202** (accept OK)
- Job `vvKZaCzIuD7CQMxCrNzZ7g` advanced:
  `queued → §5 → §9 → §11 → §12 → §15 → assembling_documents → failed`

## Exact exception (on job.error after 4b6dff52)
```
Market research generation failed. ENOENT: no such file or directory, open 'src/lib/mrr/templates/mrr-rfo-may-2026-prototype.docx'
```

## Call chain
1. `after(() => startMrrJob)` — runs
2. Sections 5/9/11/12/15 — succeed (MarketScope retrieval OK)
3. `assembleMrr` → `readDocxParts(TEMPLATE_PATH)` → `readFileSync('src/lib/…/mrr-rfo-may-2026-prototype.docx')`
4. File is **not in the Vercel serverless bundle** — nothing `require()`s a `.docx`, so NFT omits it
5. CLI `scripts/mrr-run.mts` works because the workstation checkout has `src/lib/mrr/templates/`

## Fix
- Resolve template via `join(cwd, 'src','lib','mrr','templates',…)`
- `outputFileTracingIncludes` for `/api/app/market-research` (+ `/**/*`) listing that `.docx`
