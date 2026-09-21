# Mindy Power Users — Team Discussion List

**For:** team discussion (customer-hero selection, case studies, advisory, references).
**Source:** `user_pipeline` + `user_engagement` + `user_notification_settings`, pulled
2026-06-19. Staff/test/advocate accounts excluded. **67 real power users** (pursuits>0
OR ≥8 engagement events).

**Power score = pursuits×5 + engagement events** (action weighted over passive opens).

---

## Tier 1 — Heavy active users (pipeline + cert) — best for hero/case study

| Email | Pursuits | Pursuing | Events | Cert | NAICS focus |
|-------|---------:|---------:|-------:|------|-------------|
| proposals@griffincpl.com | **62** | 0 | 144 | WOSB | logistics/IT (484/488/493/518210) |
| hello@eganrose.com ⭐ | 19 | **14** | 71 | 8(a) | consulting (5411xx) |
| candice@capglobalworks.com | 18 | 1 | 143 | — | media/consulting (5121/5411) |
| david.elliott@oscedge.com | 7 | 0 | **205** | Native American/Tribal | IT (518210/5411) |
| kashif6331@gmail.com | 7 | 2 | — | Small Business | construction (236/237) |
| paul@therivercompany.co | 7 | 0 | — | — | IT (5415xx) |
| office@getmore.llc | 6 | 5 | — | Small Business | construction (236/237/238) |

⭐ = recommended June 27 customer-hero (8(a), 14 active pursuits — real intent). See
`MINDY-DAY-CUSTOMER-HERO-BRIEF.md`.

## Tier 2 — High engagement, no pursuits yet (activation candidates)

| Email | Events | NAICS focus |
|-------|-------:|-------------|
| a.hill@heliosvanguard.com | 64 | consulting (5411xx) |
| 247metou@gmail.com | 58 | consulting |
| abbey.oasonubi@gmail.com | 55 | — |
| ali.chathiwala@burhanienterprisesinc.com | 53 | — |
| 2livingafulllife@gmail.com | 43 | consulting |
| amakacomms@gmail.com | 43 | consulting |
| amjazz007@comcast.net | 42 | consulting |
| aleonsoon@atspartners.org | 35 | 8(a) consulting |
| alant@olomana.agency | 34 | consulting |
| allyson.hassett@fed.csaassociates.com | 31 | consulting |

*(Full 67-user list: re-run `npx tsx scripts/data-quality-audit.ts`'s sibling query, or
ask Claude to regenerate. Truncated here to the top 17 for discussion.)*

---

## How to use this list (discussion prompts for the team)

1. **Customer hero (June 27):** Sikander/Shanoor outreach to Tier-1 top 3 (see hero brief).
2. **Case studies:** Tier-1 = real usage stories (WOSB running 62 pursuits; 8(a) chasing 14).
3. **Advisory / references:** Tier-1 cert mix (8(a)/WOSB/Tribal) = credible diverse references
   for gov stages + pitches.
4. **Activation play:** Tier-2 (high engagement, 0 pursuits) = ready to convert — they're
   reading everything but haven't tracked a pursuit. A nudge to "save your first pursuit"
   likely moves them to Tier-1.

## Honest caveat (from the data-quality audit)
- "Win" tracking is barely used (1 logged win, internal). These heroes are **activity-based**,
  not closed-deal-based — true and compelling, but we can't claim dollar wins from this data.
- The real fix (so future hero lists write themselves): make it one-tap to mark a pursuit
  "won" in-app. See `DATA-QUALITY-AUDIT.md` follow-ups + the activity-tracking note below.

---

## Activity / outcome tracking — why it's thin (the root fix)

Only 216 pursuits tracked total, 1 win logged. The pipeline feature exists but users
rarely advance stages or mark outcomes — so we can't mine wins. To fix at the root:
1. **One-tap "I won this"** on a pursuit card (today it's a multi-step stage change).
2. **Prompt for the award $** when they mark won (optional) — that's the dollar figure
   we lacked for the hero.
3. **Periodic "did you win anything?" nudge** to active users (Sikander/Shanoor or email).
Then every future stage (Navy Gold Coast, PSC Vision) has real customer wins to feature.

*Regenerate anytime: the mining queries are reproducible from the three tables above.*
