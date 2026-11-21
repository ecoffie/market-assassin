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
