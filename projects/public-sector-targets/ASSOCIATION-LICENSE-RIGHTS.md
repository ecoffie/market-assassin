# Association License Rights — SKU Sheet

**Purpose:** Define exactly what an association acquires, how members redeem, and how it compares to retail.  
**Template proposal:** [`docs/proposals/Association-Mindy-Proposal-Template.html`](../../docs/proposals/Association-Mindy-Proposal-Template.html)  
**Provisioning:** [`scripts/provision-edc-pilot-org.sql`](../../scripts/provision-edc-pilot-org.sql), USHCC runbook [`tasks/USHCC-Atlanta-pilot-runbook.md`](../../tasks/USHCC-Atlanta-pilot-runbook.md)

---

## What the association acquires

An **annual org license** grants the association **usage rights** to deploy Mindy to a defined roster of member firms. The association is the **contracting party**; members are **entitled users**, not retail customers.

### Rights bundle

| Right | Base license | Plus / Industry | Notes |
|-------|--------------|-----------------|-------|
| Member seat entitlements (N firms) | Yes | 50–100 seats | Hard cap; +$1,500/yr per 10 seats over bundle |
| Daily federal alerts | Yes | — | Per-member profile (NAICS, certs, keywords) |
| Market Research (Market Map, Analytics) | Yes | — | Includes Entry Accessibility / competition view |
| Contractor search (317K) | Yes | — | Teaming / Find Partners |
| Association-branded Org Tab | Yes | — | Internal news + cross-member deadlines (coach view) |
| Staff coach dashboard | Eval + paid | — | `org_admin` manages member workspaces |
| Quarterly board impact report | Plus tier | Custom PDF | See OUTCOMES-SCORECARD |
| Industry Federal Market Snapshot template | — | Industry tier | Pre-built NAICS bundle per vertical |
| GovCon Giants bootcamp delivery | — | +$25K | Eric/Sikander live cohort |
| UEI win attribution | Eval promise → GA | — | Prove member contract wins |

---

## Pricing tiers (association pays; members do not)

| Tier | Annual | Member rights | Best for |
|------|--------|---------------|----------|
| **Chamber Standard** | $18,000 | 20 seats | USHCC-style chambers, fraternal chapters |
| **Industry Association** | $25,000–$50,000 | 50–100 seats | NACC-type construction, WMA/manufacturing, AGC chapter |
| **Industry Plus** | $75,000–$100,000 | 100 seats + bootcamp | National affiliate + live training |
| **State / multi-chapter** | $75,000–$150,000 | Multi-org rollup | WMC-style state associations |

**Retail comparison (use on close slide):**

| Seats | Retail (@ $149/mo Pro) | Chamber partner (~50% off) |
|-------|------------------------|----------------------------|
| 20 | $35,760/yr | $18,000/yr |
| 50 | $89,400/yr | ~$37,500/yr effective |
| 100 | $178,800/yr | ~$50,000/yr effective |

---

## Two-step pilot (recommended — Option C from USHCC)

| Phase | Cost | What association gets |
|-------|------|-------------------------|
| **Phase 1 — 60-day eval** | $0 | `org_admin` + Coach Mode for up to 20 member workspaces; prove activation |
| **Phase 2 — Full license** | Prepaid annual | N member entitlements + quarterly report + member self-serve logins (optional) |

**Discovery question:** *"Do members need their own logins on day one, or do you run the first cohort from your staff dashboard?"*

| Answer | Sell |
|--------|------|
| Dashboard first | Phase 1 eval → staff provisions members |
| Member logins now | Full license day one |

---

## Member activation paths

### A. Staff-provisioned (best for cohorts)

1. Association `org_admin` adds member firm in **My Clients**
2. Pastes capability statement → NAICS, keywords, agencies auto-seeded
3. Member receives invite when association flips on self-serve access

### B. Member self-activate (best for 100+ firms)

1. Association distributes unique invite link or org code
2. Member signs up at getmindy.ai/app → entitlement applied automatically
3. Seat count decrements from org bundle

### C. Hybrid

Staff onboards first cohort (20–30); self-activate for renewals and new members.

---

## Contracting & billing

| Item | Standard |
|------|----------|
| Term | 12 months prepaid |
| Budget line | Member benefit / workforce development / technology (not advocacy) |
| Invoice | Annual upfront; PO acceptable for associations |
| Seat overage | Pro-rated add-on or true-up at renewal |
| Renewal | 90-day scorecard review + seat count reconciliation |

---

## Technical provisioning (5 min)

1. Replace `{{DIRECTOR_EMAIL}}` in `scripts/provision-edc-pilot-org.sql` (or association-specific script)
2. Run in Supabase SQL editor
3. Director signs up at getmindy.ai/app if needed
4. Add member firms under **My Clients**

---

## What we do NOT sell associations

- Per-member retail checkout (undermines the benefit story)
- Counseling services (APEX owns that lane — refer members to local APEX)
- Replacement for association advocacy or lobbying staff
- State procurement data as primary wedge (federal-first; state is Phase 2)

---

*Last updated: June 28, 2026*
