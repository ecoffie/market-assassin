# R2 LIVE shadow disagreement report (2026-10-06)

**Window:** 2026-10-05 03:40Z → 2026-10-06 23:39Z (~44 h, two US business days). Production traffic only: the synthetic probe identity and the probe window are excluded.

**Status:** `ENTITLEMENT_SHADOW=true` (Production) since 2026-10-05 02:33Z. Shadow logging only:
- No enforcement, no access grants or revocations.
- No Stripe, customer-record, pricing or Learn change.

**R3 has NOT started; it waits on Eric's review of this report.**

## Headline

| Calls | Accounts | Disagreements | Unknown (resolver incomplete) |
|---|---|---|---|
| **301** | **36** | **0** | **0** |

Every observed call got the same decision from today's gates and from the canonical policy, on both sides:
- **Paid allowed:** Pro, unattributed Pro, manual grant, membership.
- **Free denied:** 9+ accounts with no source.

## Live matrix (capability | current | canonical | source | calls / accounts)

| Capability | Current | Canonical | Source | Calls | Accounts |
|---|---|---|---|---|---|
| `target_list.manage` | ALLOW | allow | legacy + pro_unattributed | 82 | 1 |
| | ALLOW | allow | pro_unattributed | 2 | 1 |
| | ALLOW | allow | stripe_pro | 1 | 1 |
| `briefings.ai` | ALLOW | allow | stripe_pro | 20 | 6 |
| | ALLOW | allow | pro_unattributed | 17 | 2 |
| | ALLOW | allow | legacy + pro_unattributed | 16 | 5 |
| | ALLOW | allow | manual_grant | 11 | 1 |
| | ALLOW | allow | membership + stripe_pro (+legacy) | 7 | 2 |
| | ALLOW | allow | manual_grant + stripe_pro | 4 | 1 |
| | ALLOW | allow | membership_unruled + stripe_pro | 1 | 1 |
| | DENY | deny | (none) | 3 | 3 |
| `bid_decision.ai` | ALLOW | allow | legacy + pro_unattributed | 43 | 1 |
| | ALLOW | allow | stripe_pro | 3 | 1 |
| | DENY | deny | (none) | 11 | 5 |
| | DENY | deny | mcp_credit_balance only | 2 | 1 |
| `market_research.full` | ALLOW | allow | stripe_pro | 20 | 1 |
| | ALLOW | allow | pro_unattributed | 9 | 1 |
| | ALLOW | allow | manual_grant | 2 | 1 |
| | ALLOW | allow | legacy + pro_unattributed | 2 | 1 |
| | DENY | deny | (none) | 19 | 9 |
| `chat.ask` | ALLOW | allow | legacy + pro_unattributed | 8 | 1 |
| | ALLOW | allow | pro_unattributed | 6 | 1 |
| `market_narrative.generate` | ALLOW | allow | stripe_pro | 3 | 1 |
| | ALLOW | allow | pro_unattributed | 2 | 1 |
| `market_report.generate` | ALLOW | allow | stripe_pro | 1 | 1 |
| | DENY | deny | (none) | 3 | 1 |
| `proposal.build` | ALLOW | allow | manual_grant | 3 | 1 |

*(`mcp_credit_balance` appears beside most sources. It grants nothing and is omitted above for readability.)*

## Shadowed capabilities with NO live traffic in the window

These are where the offline run (2026-10-04, `entitlement-r2-shadow-report-2026-10-04.md`) predicts disagreement. None was triggered live.

| Capability / class | Live calls | Offline expectation |
|---|---|---|
| `pipeline.manage` (stage beyond tracking) | 0 | D3: 4 Free accounts currently managing stages → current ALLOW / canonical DENY (grandfather existing rows) |
| `proposal.build` by a Free account | 0 (the 3 calls were a paid manual grant) | D2: 15 Free accounts with drafts → ALLOW / DENY (grandfather read/export) |
| `proposal.compliance`, `proposal.export` | 0 | Free → ALLOW / DENY |
| `teaming.manage`, `relationships.manage` | 0 | ALLOW / DENY for Free; 0 Free users historically |
| `workspace.share` (invite / team upgrade) | 0 | Non-Team invite ALLOW / DENY (0 historical use); staff D→A on team/upgrade |
| `outreach.log`, `pricing_intel.view`, `competitor.analyze`, `mcp.playbook` | 0 | D7 staff and D8 advocate would be DENY / ALLOW; others agree |
| D6 members who lack Pro today (13) | 0 calls on a gate | DENY / ALLOW once seen |
| D1 grandfather-only accounts (78) | 0 calls where the grandfather was the deciding source | Designed to agree (keeps today) |

## Source evidence health

| Check | Result |
|---|---|
| Daily reconciliation `reconcile-entitlement-sources` | 2026-10-05 08:15Z **HTTP 200**, 2026-10-06 08:15Z **HTTP 200** (`cron_job_runs`) |
| Membership | 20 active · 1 past_due · **1 ended** (the subscription lapsed between runs, and the source closed automatically) · unruled 8 active + 1 past_due |
| D1 grandfather | 78 active, unchanged since seeding |
| Shadow writes | Only `entitlement_shadow_log` (rows written ≈200–350 ms after the response) |
| Parity | 56/56 (flag off), 56/56 (flag on), re-checked on the new prod build `0c008872`: still logging post-response |

## Reading for R3 (Eric decides)

1. **On every path real users exercised in two days, switching to the canonical policy would change nothing.** That includes the D1 grandfather and the union of sources.
2. **The remaining disagreements live only in low-traffic, already-ruled classes:** D2/D3 grandfathering, D7 staff, D8 advocate, D6 members. Their sizes are the offline counts above, not live calls. If you want live confirmation before R3, the shadow keeps running at no cost. These classes may take weeks to appear organically.
3. **Open items not decided here:**
   - Unruled memberships: past_due, $799 annual, Ongoing Coaching.
   - Optional REVOKE of anon/authenticated grants on the two new tables (RLS already blocks access).
   - `pro_unattributed`: 54 live grants with no recorded origin. It is the most common paid source in live traffic, and attribution is worth doing before any source-specific policy.

**Reproduce:** `.claude/auth-r2/live-report.mts` and `live-breakdown.mts` (private; they exclude probe traffic).
