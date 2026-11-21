# Cloud Agents handoff (Eric away ~2 weeks from primary Mac)

**Date:** 2026-11-21  
**Rule in repo:** `.cursor/rules/cloud-agents-away.mdc` (also copied to `~/.cursor/rules/` on the primary Mac)

## How to run work from a phone / other PC

1. Open [cursor.com/agents](https://cursor.com/agents) (or Cursor iOS).
2. Environment: **`mindy data core`** — edit it and set **Repositories** to `ecoffie/market-assassin` (it was blank; blank = agents cannot clone).
3. **New Run** → pick branch (usually `main` or `fix/ask-mindy-doc-structure-repair`) → paste a concrete task.
4. Or in Desktop: open a window with **only** market-assassin (multi-root with govcon-giants-os blocks in-chat `environment: cloud` Task launches), then choose **Cloud** under the agent input.

GitHub is connected (SCM). Prefer Cloud Agents for anything that should finish without this Mac.

## Always

- Finish → commit → **`git push`**. Portable work lives on GitHub, not on this Mac’s dirty tree.
- Do not merge agent branches to `main` unless Eric asks.
- Prod deploy is **`npx vercel --prod`** from a checkout whose `.vercel/project.json` has `projectName: "market-assassin"`. Green READY is not proof — grep the live URL for the change.

## Secrets for cloud deploys / live API

Add in [Cloud Agents Secrets](https://cursor.com/dashboard/cloud-agents) (injected at agent start):

| Secret | Why |
|--------|-----|
| `VERCEL_TOKEN` | Cloud `vercel --prod` |
| Existing app secrets as needed | Supabase / Resend / etc. only if the task must hit prod APIs |

Without Vercel secrets, cloud agents should open PRs and stop; Eric (or a linked Mac) runs deploy.

## In flight — Export UX (Ask report)

| Item | Value |
|------|--------|
| Branch | `fix/ask-mindy-doc-structure-repair` |
| PR | https://github.com/ecoffie/market-assassin/pull/2204 |
| Behavior | Open report card only; **Export** menu in open pane (`amk-export-toggle`); no PDF/Word chips under the answer; vault download URLs stripped from chat text |
| Live check | `curl -sL https://getmindy.ai/opportunity-map \| grep amk-export-toggle` |

## Product priority (do not invent a new roadmap)

From repo `CLAUDE.md`: speaking campaign first; only build product that supports that or fixes something users hit. Measurement-integrity tidy and new internal dashboards are default **no**.

## Paste-ready New Run prompts (phone / cursor.com/agents)

Use environment with repo `ecoffie/market-assassin`. Base branch: `fix/ask-mindy-doc-structure-repair` unless noted. Always commit+push; do not merge to `main` unless asked.

**1 — Export regression (map)**  
`On getmindy.ai/opportunity-map, confirm Ask create_document shows Open report only (no PDF/Word/Excel/CSV chips on the card). Open the report pane and confirm one Export control (amk-export-toggle) lists formats. If broken, fix on a cloud branch from fix/ask-mindy-doc-structure-repair, push, and say whether vercel secrets are needed to redeploy.`

**2 — Export regression (/app chat)**  
`In /app Ask Mindy, create_document should put Export in the ChatReportPreview header, not under the answer. Strip vault /api/app/vault/documents/download bullets from answer text. Fix + unit tests + push if regressing.`

**3 — FMP content vs Claude gold (only if Eric reports thin report)**  
`Federal Market Profile for a civil/highway firm must prefer named pathway vehicles (Inspection MATOC, JBAB, Capitol Perimeter, Clara Barton / GWMP forecasts) over random open RFQs; contacts must be people not agencies; no tax-software / security-admin pathways. Measure first against live Ask or fixtures in fmp-writeup-grounding — only change what fails.`

**Desktop unblock:** this Cursor window is multi-root (market-assassin + govcon-giants-os), which blocks in-chat Cloud Task. Close govcon-giants-os or open a market-assassin-only window, then Cloud works from chat too.
