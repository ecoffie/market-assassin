# Association Quarterly Outcomes Scorecard

**Purpose:** Metrics association leadership shows the board to justify license renewal.  
**Adapted from:** [`tasks/USHCC-Atlanta-pilot-runbook.md`](../../tasks/USHCC-Atlanta-pilot-runbook.md) (quarterly funder report)  
**Data sources:** Supabase org tables + Market Research APIs

---

## Board slide formula (one line)

```
[Association] members accessed $[X]M in federal SAT/set-aside market,
pursued [N] qualified opportunities, and won $[Y] in attributed contracts (Q_).
```

---

## Tier 1 — Report now

Data exists today or ships without new product work.

| Metric | Definition | How to measure | Source |
|--------|------------|----------------|--------|
| **Members enrolled** | Firms with active org seat | Count `org_clients` or provisioned workspaces where `status=active` | `org_clients`, `org_members` |
| **Activation rate** | Enrolled ÷ seats purchased | % | License cap vs enrolled |
| **Profiles completed** | NAICS + certs + keywords on file | Count rows with non-default NAICS | `user_notification_settings` |
| **Addressable federal market** | $ in SAT/micro + set-aside in member NAICS/state | Aggregate Market Research `target-market-research` per member trade | `/api/app/target-market-research` |
| **Set-aside opportunities surfaced** | Alerts matched to member certifications | Count alert sends with set-aside match | Alert log / opportunity feed |
| **Target agencies identified** | Starred agencies per member | Count distinct agencies | `user_target_list` |
| **Pursuits tracked** | Pipeline adds (qualified opps) | Count non-archived pipeline rows | `user_pipeline` |
| **Briefing engagement** | Email opens / in-app views | Opens, clicks, dashboard visits | `mindy_engagement`, alert logs |
| **Proposal waste avoided** | Pursuits killed at gate vs submitted | Narrative: fewer bids, higher qualification | `pipeline_history` stage changes |

### Tier 1 pull checklist (quarterly)

```sql
-- Example queries (adapt org_id):
-- Members provisioned: org_clients WHERE org_id = ? AND status = 'active'
-- Pursuits: user_pipeline joined to org client workspaces
-- Profiles: user_notification_settings for client emails
```

---

## Tier 2 — Contract win proof (NAPEX build)

Credibility metric for renewal and case studies.

| Metric | Definition | Source |
|--------|------------|--------|
| **Member contract wins (UEI-attributed)** | $ obligated to roster UEIs in quarter | UEI roster + USASpending award match |
| **Win count** | Number of distinct awards | Same |
| **Win rate by competition type** | Wins on set-aside vs unrestricted | Award `extent_competed` / set-aside fields |
| **Avg competition level pursued** | Shift from high → low competition over time | `competitionLevel` on pursued opps vs awards |

**Honest eval language until GA:** *"Eval includes UEI win attribution when live; Tier 1 metrics available immediately."*

---

## Tier 3 — Industry-specific (association vertical)

Customize the narrative slide by trade.

### Construction (AGC, ABC, NECA, NACC-type)

| Metric | Example value |
|--------|----------------|
| Fed construction NAICS spend in member state | $X M (USACE, VA, DLA offices) |
| SAT/micro contract count in vertical | N contracts under $350K |
| Member pursuits in facilities / A-E / GC services | Count by NAICS 236/237/238 |
| Low-competition sample awards | 3 examples with bid count ≤2 |

### Manufacturing (WMA, NAM affiliates)

| Metric | Example value |
|--------|----------------|
| Manufacturing NAICS federal spend | $X M in state |
| Top PSC "what was bought" | e.g. industrial supplies, fabricated metals |
| Member pursuits in MRO / parts / fabricated goods | Count by PSC |
| Set-aside addressable % | % of spend in member cert lanes |

### Veteran fraternal (Legion, VFW)

| Metric | Example value |
|--------|----------------|
| SDVOSB set-aside opps surfaced | Count last 90 days |
| Members with SDVOSB cert on profile | % of enrolled |
| SDVOSB-attributed wins | $ (Tier 2) |

---

## Quarterly report template (one-pager PDF)

**Header:** `[Association Name] — Federal Member Intelligence Impact Report — Q_ 20__`

| Section | Content |
|---------|---------|
| **Summary** | Board slide formula (one line) |
| **Enrollment** | N enrolled / N licensed seats; activation % |
| **Market access** | $ addressable SAT/set-aside; top 5 agencies in trade |
| **Activity** | Pursuits tracked; alerts engaged; agencies starred |
| **Wins** | UEI-attributed $ (or "tracking begins Q_") |
| **Qualification story** | Avg competition level trend; set-aside pursuit % |
| **Next quarter** | Activation goal; cohort event; seat expansion |

**Template file name:** `[Association]-Federal-Impact-Q_20__.pdf`

---

## ROI narrative (license cost vs outcomes)

| License | $18K/yr (20 seats) | $50K/yr (100 seats) |
|---------|-------------------|---------------------|
| Cost per member firm | $900/yr | $500/yr |
| Retail equivalent | $1,788/yr @ $149/mo | $1,788/yr @ $149/mo |
| **Member savings** | ~50% vs self-serve | ~72% vs self-serve |
| Break-even for association | 1 member wins $100K+ contract in year | 2–3 member wins |

Use conservatively — association ROI is **retention + differentiation**, not guaranteed contract wins.

---

## GHL / CRM fields (optional sync)

| Field | Value |
|-------|-------|
| Pipeline | APEX/SBDC Partnerships → Association sub-pipeline |
| Stage | Research → Outreach → Eval → Paid → Renewal |
| Custom: `seats_licensed` | Number |
| Custom: `q_enrolled` | Number |
| Custom: `q_pursuits` | Number |
| Custom: `q_wins_usd` | Currency |

---

*Last updated: June 28, 2026*
