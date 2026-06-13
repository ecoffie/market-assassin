# USHCC Atlanta — Mindy Pilot Runbook

**Status:** Ready to send (June 2026)  
**Proposal:** `docs/proposals/USHCC-Atlanta-Mindy-Proposal.html`  
**SQL:** `scripts/provision-ushcc-atlanta-org.sql`

---

## Before the call

1. Open proposal in browser → Print → Save as PDF  
   ```bash
   open "/Users/ericcoffie/Market Assasin/market-assassin/docs/proposals/USHCC-Atlanta-Mindy-Proposal.html"
   ```
2. Fill in `[Director Name]` and `[Date]` in the HTML (or note in cover email).
3. Get director email for provisioning.

---

## Recommended pitch (Option C)

> "Start with a **complimentary 60-day director eval** — you manage up to 20 training
> participants as client workspaces in Mindy. When your federal training funding clears,
> flip on **20 member seats at $18,000/year** — about half of retail, with a quarterly
> report for your funders."

**Ask:** *"Do members need their own logins on day one, or do you run the cohort from your dashboard first?"*

| Answer | Sell |
|--------|------|
| Dashboard first | Option A → Option C Phase 1 (free eval) |
| Member logins now | Option B ($18K/yr) or Option C Phase 2 |

---

## Provision director eval (5 min)

1. Replace `{{DIRECTOR_EMAIL}}` in `scripts/provision-ushcc-atlanta-org.sql`
2. `pbcopy < scripts/provision-ushcc-atlanta-org.sql` → paste in Supabase SQL editor → Run
3. Confirm verify SELECTs show org + org_admin row
4. Director must have a **Mindy account** at that email (invite to `/app/signup` if needed)
5. She opens **My Clients** → adds first cohort business with capability text

**Access:** `org_members` row grants My Clients via grandfather (even on Pro). Uncomment SQL block 4 for `access_team` if you want Teams tier label in UI.

---

## Phase 2 — 20 member seats (after contract)

For each cohort member email:

```bash
# Admin grant Pro/briefings (repeat per member)
curl "https://getmindy.ai/api/admin/grant-briefings?password=galata-assassin-2026&email=MEMBER@example.com"
```

Or batch via Command Center / `grant-ma-tier` when invoice clears.

**Invoice:** $18,000/yr prepaid — chamber partner rate ($75/seat/mo effective).  
**Upsell:** $24,000/yr = +2nd coach seat + priority support.

---

## Funder report (quarterly deliverable)

Pull from Supabase / Command Center:

| Metric | Source |
|--------|--------|
| Members provisioned | `org_members` + grant log |
| Profiles completed (NAICS) | `user_notification_settings` |
| Target agencies added | `user_target_list` per workspace |
| Pursuits tracked | `user_pipeline` per workspace |
| Briefing engagement | `mindy_engagement` / email opens |

Template: one-pager PDF — "USHCC Atlanta Federal Training Cohort — Q_ 20__"

---

## National USHCC path

If Atlanta closes → pitch **regional license** (5 chapters × 20 seats): **$75K–$90K/yr**.  
Atlanta = proof point (activation %, pursuits per member).

---

## Files

| File | Purpose |
|------|---------|
| `docs/proposals/USHCC-Atlanta-Mindy-Proposal.html` | Send to director |
| `scripts/provision-ushcc-atlanta-org.sql` | Supabase org setup |
| `docs/PRD-my-clients-access-pricing.md` | Internal tier gating reference |
