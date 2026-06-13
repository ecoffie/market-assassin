# Customer Qualification Agent

**Status:** Draft  
**Owner:** GovCon Giants / Sales + Customer Success  
**Mission:** Identify the users and customers most worth personal outreach based on purchase history, MI access, product usage, engagement, and outcome potential.

## Job To Be Done

The agent helps the team answer:

- Who should Annelle and Sikander contact next?
- Who has paid enough or engaged enough to deserve personal outreach?
- Who is likely ready for MI Pro?
- Who is likely ready for white-glove?
- Who belongs on the 10-10 Forever candidate list?
- Who is disengaged and should not receive high-touch founder attention?

## Source Systems

Initial sources:

- Stripe purchases and subscriptions
- MI entitlement records
- Supabase user profiles
- Supabase auth users
- Briefing opens/clicks
- Alert opens/clicks
- App activity
- Pipeline/tracking activity
- Profile completion data
- Prior event attendance lists

Future sources:

- Slack replies
- Webinar attendance
- Call notes
- CRM notes
- Win/loss reports
- Support tickets

## Qualification Signals

### Purchase Signals

- Bought Ultimate Giant Bundle
- Bought MI Pro / Briefings
- Bought multiple products
- Paid premium price
- Active subscription
- No refund or dispute

### Engagement Signals

- Logged into MI
- Completed profile
- Selected custom NAICS
- Opened briefings
- Clicked alert links
- Searched contractors
- Viewed forecasts
- Viewed recompetes
- Saved/tracked opportunities
- Used pipeline/team features

### Intent Signals

- Attended livestream or bootcamp
- Replied to emails
- Asked specific product questions
- Requested help finding opportunities
- Asked about teaming, proposals, or white-glove
- Has active federal contracting business

### Fit Signals

- Has relevant NAICS
- Has business type set
- Has capacity to bid
- Has past performance or subcontracting path
- Operates in a funded agency/category
- Could benefit from MI repeatedly

## Score Model

| Signal | Points |
| --- | ---: |
| Ultimate Giant Bundle or high-ticket purchase | 30 |
| Active MI Pro / Briefings access | 25 |
| Multiple product purchases | 20 |
| Profile completed | 15 |
| Custom NAICS selected | 10 |
| Opened/clicked briefing | 10 |
| Used MI app in last 7 days | 15 |
| Saved/tracked opportunity | 20 |
| Viewed contractors/recompetes/forecasts | 10 |
| Attended livestream/bootcamp | 15 |
| Replied or asked specific question | 20 |
| Refund/dispute/inactive subscription | -30 |
| No profile and no engagement | -20 |

## Segments

| Segment | Score / Criteria | Action |
| --- | --- | --- |
| 10-10 Candidate | 80+ and strong fit | Founder/customer success call |
| White-glove Candidate | 70+ and clear business need | Sales call |
| MI Pro Upgrade Candidate | 50+ and free/currently limited | Upgrade campaign |
| Activation Candidate | Incomplete profile (default NAICS only), score 30+, has Mindy access | Profile setup nudge — keywords + NAICS (description optional) |
| Rescue Candidate | Paid but inactive | Customer success outreach |
| Audience Only | Low purchase and low engagement | Low-touch nurture |

## Output Format

The agent should produce:

| Rank | Email | Name/Company | Segment | Score | Why Qualified | Recommended Action |
| --- | --- | --- | --- | ---: | --- | --- |

Also include:

- Top 25 outreach candidates
- Top 25 activation candidates
- Top 10 white-glove candidates
- Top 10 rescue candidates
- Exclusions and why
- Data gaps to resolve

## Annelle / Sikander Outreach Use Case

The first operating use case is expanding the Annelle and Sikander outreach list.

The agent should:

1. Start from the current qualified outreach CSV.
2. Cross-reference Stripe purchasers.
3. Add MI usage and profile completion signals.
4. Remove advisory-board-only targets.
5. Rank customers by outreach priority.
6. Suggest the best reason to contact each person.
7. Produce a CSV-ready list for execution.

## Guardrails

- Do not expose full customer lists in public channels.
- Do not send outreach automatically without approval.
- Keep internal/test users out of customer rankings.
- Do not treat free signups as qualified unless engagement is strong.
- Always show why someone qualifies.
- Separate paid entitlement from actual identity/account setup.

## Definition Of Done

The agent is useful when Annelle, Sikander, or the founder can open the output and know:

- Who to call
- Why that person matters
- What offer or ask fits them
- Whether they are MI Free, MI Pro, or white-glove potential
- What evidence supports the outreach
