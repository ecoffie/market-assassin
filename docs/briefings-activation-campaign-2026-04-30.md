# Briefings Activation Campaign - 2026-04-30

No emails have been sent from this document. This is the review packet for the 401 entitled users.

Campaign clarification:

- All 401 entitled customers receive standard activation messaging based on their cohort.
- Launch begins Friday, May 1, 2026 in the morning. Exact send time: `[time]` / default proposed time: 9:00 AM ET.
- No apology emails.
- No access corrections.
- No special handling for the 7 earlier "missing-access" customers; live access verification confirmed they already have full Ultimate access.
- Mia Hudson receives a personal email that covers both activation and the $500 payment context.

## Signup Flow Verification

- `/briefings?email={{email}}&setup=true` now pre-fills the email, stores it locally, verifies the briefings entitlement, and opens onboarding/settings when needed.
- Access verification checks the briefings entitlement by email. For this campaign, Stripe-only customers already have entitlement by billing email, so the link works when the email parameter matches Stripe billing email.
- Onboarding writes to `user_notification_settings`, captures NAICS/basic preferences, enables `briefings_enabled`, sets `is_active=true`, and makes the user eligible for the daily briefings cron on the next run.
- Current daily briefings cron builds its send audience from `user_notification_settings` and `smart_user_profiles`, not from entitlement alone. Entitled Stripe-only users must complete onboarding before receiving daily briefings.

## Segment Counts

Source files:

- `scripts/briefings_activation_segments_2026-04-30.csv`
- `scripts/briefings_activation_segments_2026-04-30.json`

| Cohort | Variant 1: account/audience ready | Variant 2: setup needed | Personal email | Total |
|---|---:|---:|---:|---:|
| Ultimate Giant Bundle | 14 | 3 | 1 | 18 |
| Inner Circle Active | 0 | 5 | 0 | 5 |
| Past Event Attendee | 3 | 115 | 0 | 118 |
| Pro Member Active | 18 | 33 | 0 | 51 |
| Pro Giant Bundle | 0 | 0 | 0 | 0 |
| MI Subscription | 1 | 0 | 0 | 1 |
| Standalone Preview | 12 | 196 | 0 | 208 |
| Total | 48 | 352 | 1 | 401 |

Ultimate verification notes:

- The 7 previously flagged "missing-access" customers all have full Ultimate access and should receive standard Ultimate activation messaging.
- `kydun00@yahoo.com` and `sylvester.anderson@andslylegacy.com` are included in standard Ultimate setup-needed messaging.
- `miazhudson@gmail.com` receives the personal Mia email below.

## Send Schedule

Mia Hudson is excluded from the templated batch. Operationally, this is 400 templated sends plus 1 personal email from Eric.

| Day | Segment | Count |
|---|---|---:|
| Day 1 | Ultimate Giant + Inner Circle | 22 templated + 1 personal Mia email |
| Day 2 | MI Subscription + Pro Member Active batch 1 | 50 |
| Day 3 | Pro Member Active remainder + Past Event batch 1 | 50 |
| Day 4 | Past Event batch 2 | 50 |
| Day 5 | Past Event remainder + Standalone batch 1 | 50 |
| Day 6 | Standalone batch 2 | 50 |
| Day 7 | Standalone batch 3 | 50 |
| Day 8 | Standalone batch 4 | 50 |
| Day 9 | Standalone batch 5 | 28 |

Daily end-of-day report:

- Emails sent
- Open rate
- Click rate
- Signup conversions
- Replies received
- Deliverability issues
- Customer questions/issues needing escalation

## Revoked User Alert Safety

- Revoked cohort checked: 1,221
- Existing audience rows: 932
- Existing audience rows with active daily alerts after fix: 932
- Existing disabled rows fixed today: 9
- No audience record: 289

## Templates

Use `{{activation_url}}` as the CTA link. Suggested URL format:

`https://tools.govcongiants.org/briefings?email={{email}}&setup=true&utm_campaign=briefings_activation&utm_cohort={{cohort}}&utm_variant={{variant}}`

### A1 - Ultimate Giant, Account/Audience Ready

Subject: Your Ultimate Bundle now includes briefings

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an Ultimate Giant Bundle owner, I am adding lifetime access to this new briefings feature to your account.

Your access is already active. You can open the briefings dashboard, review your settings, and start using it now:

{{activation_url}}

The daily briefings are built to help you quickly see relevant opportunities, deadlines, and market signals without digging through everything manually.

Eric

P.S. If you are joining the May 30 bootcamp, this will pair nicely with that work.

### A2 - Ultimate Giant, Stripe-Only Activation

Subject: Set up your lifetime briefings access

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an Ultimate Giant Bundle owner, I am adding lifetime access to this new briefings feature for you.

I found your purchase under this email, but you still need to set up your briefings profile before we can send them to you.

Start here:

{{activation_url}}

It should only take a couple minutes. Use the same email, add your NAICS/preferences, and your briefings will start on the next daily run.

Eric

P.S. If you are joining the May 30 bootcamp, this will pair nicely with that work.

### A3 - Mia Hudson Personal Email

Subject: Your briefings access and payment note

Hi Mia,

I wanted to send this personally instead of putting you into the regular campaign email.

We just launched Daily Market Intelligence Briefings inside GovCon Giants, and your Ultimate Giant access includes lifetime access to this new feature.

You can set up your briefing profile here:

{{activation_url}}

Use the same email, add your NAICS/preferences, and the daily briefings will start on the next run.

Also, on the $500 payment context: I have you noted separately on that so it does not get mixed up with the briefings activation. This email is just to make sure you know your access is active and you can start using the new feature.

Eric

### B1 - Inner Circle, Account/Audience Ready

Subject: Your Inner Circle membership now includes briefings

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an Inner Circle member, I am adding lifetime access to this new briefings feature to your account.

Your access is already active. You can open your dashboard and review your briefing settings here:

{{activation_url}}

The goal is simple: bring the market signals, deadlines, and opportunities to you instead of making you hunt for them every morning.

Eric

P.S. If you are joining the May 30 bootcamp, this will pair nicely with that work.

### B2 - Inner Circle, Stripe-Only Activation

Subject: Set up your Inner Circle briefings access

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an Inner Circle member, I am adding lifetime access to this new briefings feature for you.

I found your membership under this email, but we need a briefings profile before we can send the daily emails.

Set it up here:

{{activation_url}}

Use the same email, add your NAICS/preferences, and you will be in the next daily briefing run.

Eric

P.S. If you are joining the May 30 bootcamp, this will pair nicely with that work.

### C1 - Past Event, Account/Audience Ready

Subject: A new briefing feature for past attendees

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

As a past GovCon Giants event attendee, I am giving you 6 months of access to try the new feature. Your access runs through October 29, 2026.

Your account is ready. You can open briefings and review your settings here:

{{activation_url}}

My goal is to make the follow-up easier: relevant opportunities, deadlines, and market signals in one daily briefing.

Eric

P.S. If the May 30 bootcamp is on your radar, this will help you come in sharper.

### C2 - Past Event, Stripe-Only Activation

Subject: Your 6-month briefings access is ready

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

As a past GovCon Giants event attendee, I am giving you 6 months of access to try the new feature. Your access runs through October 29, 2026.

I found your event purchase under this email, but you need to set up a briefings profile before we can send anything.

Start here:

{{activation_url}}

Use the same email, add your NAICS/preferences, and your daily briefings will start on the next run.

Eric

P.S. If the May 30 bootcamp is on your radar, this will help you come in sharper.

### D1 - Pro Member, Account/Audience Ready

Subject: Your Pro Member subscription now includes briefings

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an active Pro Member, your subscription now includes access to briefings while your subscription remains active.

Your account is ready. Open briefings and review your settings here:

{{activation_url}}

The point is to save you time by bringing useful opportunities, deadlines, and market signals into one daily email.

Eric

P.S. If you are joining the May 30 bootcamp, this should make the prep easier.

### D2 - Pro Member, Stripe-Only Activation

Subject: Set up briefings for your Pro Member account

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an active Pro Member, your subscription now includes access to briefings while your subscription remains active.

I found your subscription under this email, but you need to set up your briefings profile before we can send the daily emails.

Start here:

{{activation_url}}

Use the same email, add your NAICS/preferences, and your briefings will start on the next daily run.

Eric

P.S. If you are joining the May 30 bootcamp, this should make the prep easier.

### E1 - Pro Giant, Account/Audience Ready

Subject: Your Pro Giant Bundle includes briefings

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are a Pro Giant Bundle owner, I am adding 1 year of access to this new briefings feature.

Your account is ready. Open briefings and review your settings here:

{{activation_url}}

You will get daily market signals, deadlines, and opportunity highlights without having to sort through everything manually.

Eric

P.S. If you are joining the May 30 bootcamp, this should make the prep easier.

### E2 - Pro Giant, Stripe-Only Activation

Subject: Set up your Pro Giant briefings access

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are a Pro Giant Bundle owner, I am adding 1 year of access to this new briefings feature.

I found your purchase under this email, but you need to set up your briefings profile before we can send anything.

Start here:

{{activation_url}}

Use the same email, add your NAICS/preferences, and your daily briefings will start on the next run.

Eric

P.S. If you are joining the May 30 bootcamp, this should make the prep easier.

### F1 - MI Subscription, Account/Audience Ready

Subject: Your briefings subscription is active

Hi {{first_name}},

Quick confirmation: your Market Intelligence subscription is active, and your Daily Market Intelligence Briefings access is already live.

You can review your briefing settings here:

{{activation_url}}

Eric

### F2 - MI Subscription, Stripe-Only Activation

Subject: Finish setting up your briefings subscription

Hi {{first_name}},

Quick confirmation: your Market Intelligence subscription is active.

I found your subscription under this email, but you need to set up your briefings profile before we can send the daily emails.

Start here:

{{activation_url}}

Eric

### G1 - Standalone Preview, Account/Audience Ready

Subject: Try the new briefings feature

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an existing customer, I am giving you preview access through June 30, 2026.

Your account is ready. You can open briefings and review your settings here:

{{activation_url}}

Use it to see relevant opportunities, deadlines, and market signals in a daily format. If it helps, we will show you the ongoing options before the preview ends.

Eric

P.S. If you are joining the May 30 bootcamp, this will help you come in sharper.

### G2 - Standalone Preview, Stripe-Only Activation

Subject: Your briefings preview access is ready

Hi {{first_name}},

We just launched Daily Market Intelligence Briefings inside GovCon Giants.

Because you are an existing customer, I am giving you preview access through June 30, 2026.

I found your purchase under this email, but you need to set up a briefings profile before we can send anything.

Start here:

{{activation_url}}

Use the same email, add your NAICS/preferences, and your daily briefings will start on the next run.

Eric

P.S. If you are joining the May 30 bootcamp, this will help you come in sharper.
