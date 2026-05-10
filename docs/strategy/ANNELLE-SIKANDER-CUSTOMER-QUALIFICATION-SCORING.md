# Annelle / Sikander Customer Qualification Scoring

**Status:** Draft  
**Date:** May 9, 2026  
**Purpose:** Turn the customer-first outreach list into a repeatable scoring system for Annelle and Sikander.

## Strategy

Customers first. Advisory second.

This outreach should focus on people who have already demonstrated commitment by buying, configuring, attending, clicking, replying, or otherwise engaging. The goal is not to ask cold people what they want. The goal is to learn from customers who are most likely to become proof customers, MI Pro champions, white-glove candidates, or 10-10 Forever relationships.

## Source Files

Use these as current inputs:

- `ANNELLE-SIKANDER-QUALIFIED-CUSTOMER-OUTREACH.csv` - current 60-person outreach tracker in workspace root.
- `scripts/paid_customers_unified_2026-04-28.csv` - paid customer purchase history export.
- `scripts/briefings_activation_segments_2026-04-30.csv` - briefing account/profile/setup signals.
- `ERIC-10-10-FOREVER-LIST.md` - proof customer and 10-10 candidate context.

## Scoring Model

| Signal | Points |
| --- | ---: |
| White-glove or high-ticket purchase | 30 |
| Ultimate / bundle purchase | 25 |
| Direct MI / Briefings buyer | 25 |
| Current recurring subscriber | 20 |
| Multiple purchases / repeat buyer | 20 |
| Profile configured / custom NAICS | 15 |
| Briefings enabled or alerts enabled | 15 |
| Recent purchase in last 30 days | 15 |
| 10-10 proof or bench customer | 15 |
| Execution-stack buyer: AI tools + CRM + research | 15 |
| Lower-ticket tool buyer | 10 |
| No profile/account setup visible | -10 |

## Priority Bands

| Band | Score | Meaning | Action |
| --- | ---: | --- | --- |
| A1 | 80+ | Highest-value proof, white-glove, or MI validation target | Personal/high-priority outreach |
| A2 | 65-79 | Strong current buyer/subscriber | Send first-wave Annelle invite |
| B | 45-64 | Good customer validation candidate | Send second wave |
| C | 25-44 | Tool buyer / upgrade-path feedback | Send after A/B |
| Hold | <25 | Not enough signal | Low-touch only |

## First Outreach Batch

These are the top contacts to prioritize first because they have the freshest buyer intent, highest value, or strongest MI/proof-customer signal.

| Rank | Email | Segment | Score | Why Qualified | Recommended Ask |
| --- | --- | --- | ---: | --- | --- |
| 1 | trungh@lifestylesolarinc.com | White Glove / Highest Value | 90 | White-glove/high-ticket buyer, highest premium signal | Premium customer validation call |
| 2 | tavin@alfordcontracting.com | 10-10 Proof / AI Tools Buyer | 85 | Named proof customer plus recent execution-stack purchase | MI setup + proof customer call |
| 3 | james.banks@coreglobalconsultants.com | Recent Ultimate Buyer | 80 | Recent $1,497 Ultimate purchase | Onboarding + MI value call |
| 4 | office@getmore.llc | Recent Ultimate Buyer | 80 | Recent $1,497 Ultimate purchase | Onboarding + MI value call |
| 5 | shelley@integratedfire.org | MI Annual Buyer | 80 | Direct MI annual buyer, fresh intent | MI-specific setup/value call |
| 6 | sylwiak@hjgovcontractingcorp.com | Ultimate / Active Profile Buyer | 80 | High-value buyer, briefings enabled, alerts enabled, profile configured | MI/profile feedback call |
| 7 | rhendricks@horrangi.com | High Value / Active Profile Buyer | 75 | High-value buyer with briefings, alerts, and NAICS profile | MI/profile feedback call |
| 8 | kenworthbudd@yahoo.com | High Value / Briefings Buyer | 70 | High-value buyer with briefings and alerts enabled | MI-specific feedback call |
| 9 | miazhud1111@gmail.com | Repeat Buyer | 70 | Recent Ultimate plus Opportunity Hunter purchases | Repeat-buyer onboarding call |
| 10 | peter@valorgovcon.com | Recent High-Value Buyer | 70 | Recent $997 product purchase | Customer validation call |
| 11 | eduardo@trunorthgovx.com | AI Tools + CRM Buyer | 65 | Recent execution-stack buyer | Deal Flow / CRM validation call |
| 12 | daphne@yellowbirdtech.com | AI Tools + CRM Buyer | 65 | Execution-stack buyer | Deal Flow / CRM validation call |
| 13 | hello@eganrose.com | Pro Member / High Lifetime Buyer | 65 | Current subscriber plus high historical value | Pro/FHC retention call |
| 14 | james.bdavis@outlook.com | FHC / Tool Buyer | 65 | High lifetime value and current subscription behavior | FHC/tool validation call |
| 15 | coaching@familylifeenhancement.com | Recent Tool Buyer | 60 | Recent contractor database purchase | Tool-to-MI validation call |
| 16 | jhennings@footprintsfloors.com | MI Buyer | 60 | Direct MI buyer | MI setup call |
| 17 | altonseth@gmail.com | Alert Buyer | 55 | Direct Alert Pro buyer | Alert-to-MI validation call |
| 18 | qbcleaningllc@gmail.com | AI Tools Buyer | 55 | Recent AI tools buyer | Product consolidation call |
| 19 | mdula@cordgroupinc.com | Pro Member Buyer | 55 | Recent Pro buyer | Pro retention call |
| 20 | yvette@sharpernewaxe.com | 10-10 Bench / Ultimate Buyer | 55 | Named bench customer and previous Ultimate buyer | Customer-first validation call |

## Outreach Lanes

### Lane 1: MI / Briefings Buyers

Ask:

- Did you get access?
- Did you complete setup?
- Did the briefing show useful opportunities?
- What was confusing?
- What would make you use it weekly?

### Lane 2: Ultimate / Bundle Buyers

Ask:

- Did the bundle make sense?
- What did you expect to happen after purchase?
- What one thing would make the bundle feel like an obvious win?
- Which MI feature should be the front door?

### Lane 3: Execution-Stack Buyers

Ask:

- Are you trying to manage opportunities, partners, proposals, or content?
- Would a Deal Flow Board help your team work together?
- What would make this feel like software instead of disconnected tools?

### Lane 4: High-Ticket / White-Glove Candidates

Ask:

- What outcome did you expect us to help produce?
- Where are you stuck: finding, qualifying, teaming, proposing, or winning?
- What would make a done-for-you offer worth real money?

## Call Outcome Tags

Use these tags after each call:

- `needs_profile_setup`
- `needs_login_help`
- `mi_value_confirmed`
- `mi_confusing`
- `too_many_matches`
- `not_enough_matches`
- `wants_team_access`
- `wants_deal_flow_board`
- `white_glove_candidate`
- `case_study_candidate`
- `10_10_candidate`
- `do_not_prioritize`

## Next Step

Create the next outreach batch from the first 20 contacts, then update the tracker after each touch:

- Sent
- Replied
- Booked
- Completed
- Quote captured
- Need identified
- Next action
