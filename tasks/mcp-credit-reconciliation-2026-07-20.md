# MCP Credit Reconciliation & Allocation Decision (2026-07-20)

## Headline
The **accidental 1,000-credit giveaway is ALREADY cleaned up.** Of the original 713 beta users
wrongly granted 1,000 on 2026-07-15, **629 are now at balance=0** (revoked by
`scripts/revoke-wrong-pro-grants.ts`). The **70 still at balance=1,000 are the intentional KEEP
set — real Pro / lifetime members**, not the accident. **Zeroing them would nuke ~48 verified
payers** (Ultimate Giant, $2,997 lifetime, Teams-Annual buyers). Do NOT reset them.

The grant cron is **fixed** (`grant-mcp-pro-credits/route.ts:31-48` — internal-team + advocates
only, no KV scan), so there is **no re-grant risk**. `PRO_MONTHLY_CREDITS` was 1,000 at the time
of the accident; now defaults to 250 (`packages.ts:59-62`).

## Balance distribution today (717 rows)
- **629 @ 0** — revoked beta (cleanup complete)
- **70 @ 1,000** — real Pro / grandfathered / lifetime (KV `briefings:*` gate) — KEEP
- **8 @ 25,000** — internal team (comp)
- **9 @ 1–6,000** — comp/testimonial 500s + spent-down + team seats

## Cohort map
| Cohort | Count | Current MCP state | Recommended |
|---|---|---|---|
| Internal team | 8 | 25,000 each | keep (comp) |
| Advocates (Sue) | 1 | 1,000 (in the 70) | keep (comp) |
| Comp/testimonial | 7 | 500 one-time | keep |
| Real Pro (KV `briefings:*`) | 78 (70 hold 1,000) | frozen 1,000 one-time | **DECISION: ongoing 250/mo?** |
| Founders / lifetime ($2,997/$4,997) + Ultimate Giant | (subset of the 70) | **no dedicated allocation** | **DECISION: rate?** |
| Beta (accidental 713) | 629 now @ 0 | revoked | none — done |

## The 70 @ 1,000 — classification (ALL must-keep, 0 accidental)
- **Verified payers (48)** incl. Ultimate Giant ($1,497), Mindy lifetime ($2,997), Teams Annual
  ($6,000), White Glove BD ($6,000): adrienne@armproperty.com, broseg3l@yahoo.com,
  rhendricks@horrangi.com, parks_robert_l@yahoo.com, john.k.miley@gmail.com, elmbiz5@gmail.com,
  trungh@lifestylesolarinc.com, office@getmore.llc, james.banks@coreglobalconsultants.com,
  kydun00@yahoo.com, founder@siemable.com, bonitascott15@hotmail.com … (full list in agent recon).
- **Entitled-Pro, KV briefings but no synced purchase row (17):** andre@3dubcorp.com,
  info@lcmanagementsolutions.com, danxavier2001@icloud.com, keidra@eganrose.com … — keep.
- **Staff (3):** ryan@ / service@ / zach@ (govcongiants). **Advocate (1):** westover105 (Sue).
  **Personal comp (1):** coffiemiami@gmail.com.

## Decisions needed (numbers are Eric's — never invented)
1. **Founders / lifetime ($2,997 / $4,997 / Ultimate Giant) MCP allowance** — currently UNDEFINED.
   They only have MCP credits today by happening to be in the KV Pro gate. Options: match Team
   (750/mo), higher (1,500/mo), or a large one-time. **← the main open decision.**
2. **Ongoing Pro ($149) monthly allowance** — the fix cron is internal-only, so real Pro members
   are NOT currently getting their 250/mo; they hold a frozen 1,000 from the accident. Decision:
   turn on a monthly 250 grant for KV `briefings:*` holders (carefully — the thing that caused the
   accident), or leave Pro as the one-time 1,000 they have.
3. **The 70's grandfathered 1,000** — recommend LEAVE as-is (goodwill; never claw back a payer's
   credits). Not a reset.
4. **Beta** — already 0. No action.

## Detection logic (file:line)
`INTERNAL_TEAM_EMAILS` api-auth.ts:111-120 · advocates advocate-accounts.ts:8-11 ·
comp campaign-exclusions.ts:5-13 · KV `briefings:` access.ts:44,59 · grant cron (internal-only)
grant-mcp-pro-credits/route.ts:31-48 · revoke KEEP-list revoke-wrong-pro-grants.ts:72-86 ·
founders founders-seats.ts:18-19,78-102 · credit constants packages.ts:59-62 (Pro 250), 80-82 (25000).
