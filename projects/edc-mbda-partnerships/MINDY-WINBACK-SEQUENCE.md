# Mindy Win-Back Email Sequence (GHL)

**Audience:** GHL contacts tagged `mindy-profile-incomplete` (~4,324) in location `AMkIivLuREYwsX5GhAAL`.
Warm bootcamp/webinar alumni with a live, **already-paid-for** Mindy account who never configured a
profile (no custom NAICS), so alerts are generic and they've gone quiet (~30+ days idle).

**Single goal:** get them to **set up their Mindy profile** (pick NAICS / keywords) so alerts become
relevant. NOT a paid upsell — setup first.

**Copywriting method (from `~/Bootcamp/email-sequence-bootcamp-january-2026.md`):** GovCon Giants
**Buyer-Psychology framework** + **fear-of-loss**. Each email is tagged with the buyer type(s) it targets:
- 🔴 **Rock Bottom** — tried for years, nothing worked, needs the transformation
- 🟡 **Almost There** — has the pieces, missing the "final piece" *(dominant fit here — they HAVE the account)*
- 🟢 **Identity** — wants to BE a federal contractor
- 🔵 **Escape** — wants freedom / out of the 9–5
- 🟣 **Revenge** — prove the doubters wrong

**Fear-of-loss calibration (decided 2026-06-30): REAL loss, no fake scarcity.** The loss is true and
specific — *matched contracts in their lane are passing them by every week while their account sits
blind.* No invented deadlines or "sells out" framing — that rings false to warm alumni and oversells.
The urgency is the opportunity cost that's *already happening*, not a manufactured clock.

---

## Setup / send notes (do this in GHL before launch)

- **Trigger:** tag `mindy-profile-incomplete` AND not `mindy-configured`.
- **CTA `{{SETUP_URL}}`:** `https://getmindy.ai/profile/setup` (generic link — keeps the bulk send on the
  GHL/marketing rail; GHL can't mint Mindy's per-user secure links).
- **From:** Eric Coffie / GovCon Giants.
- **Cadence:** Day 0, 2, 5, 9, 14.
- **Exit:** when the sync flips a contact to `mindy-configured`, remove from workflow (re-run
  `scripts/sync-mindy-tags-to-ghl.ts` during the campaign to refresh tags).
- **Merge fields:** `{{first_name}}`.

---

## Email 1 — Day 0 · "Your Mindy is on. It's just blind."
**Psychology:** 🟡 Almost There (you have it, it's missing one piece) + seed 🔴 Rock Bottom
**Fear-of-loss:** the matched opportunities you're already missing, right now

**Subject A:** Your Mindy account is on — but it's blind
**Subject B:** The contracts in your lane are passing you by (2-min fix)
**Preview:** It's already paid for. It just doesn't know what you do yet.

Hey {{first_name}},

Straight with you: you've got a Mindy account that's been running this whole time — your 24/7 federal
contracting research assistant. It's on. It's paid for. And it's been **flying blind.**

Because out of the box, Mindy doesn't know what you do. So every day it's been showing you a generic
feed instead of the contracts that actually fit your business. You're not behind because you can't do
the work — you're behind because **the right opportunities have been scrolling past you unseen.**

Here's what flips on the moment you tell it your industry:

- Daily opportunities matched to **your** NAICS — not a generic list
- Expiring contracts in your space (recompetes you can get ahead of)
- Win-probability scoring on each one

You're one 2-minute step from the version of Mindy you were supposed to have.

👉 **[Tell Mindy what you do — 2 minutes]({{SETUP_URL}})**

— Eric Coffie, GovCon Giants

---

## Email 2 — Day 2 · "What slipped past you this week"
**Psychology:** 🔴 Rock Bottom (years of trying, nothing landed) + 🟡 Almost There
**Fear-of-loss:** quantify what's moving without them

**Subject A:** While your profile sat empty, these moved
**Subject B:** You've been doing the hard part. You're skipping the easy part.
**Preview:** $700B+ moves a year. Your slice is in there.

{{first_name}},

If you've been grinding at federal contracting for a while and it just hasn't clicked — I want to name
why that happens, because it's almost never effort.

It's **relevance.** Hundreds of billions move through federal contracting every year. A real chunk of it
is in *your* lane. But if you never see those specific contracts — or you see them too late — none of
the effort matters. That's the wall most people hit, and quietly give up at.

You already cleared the hard part: you showed up, you've got the account. The easy part — the part
that's still undone — is telling Mindy which contracts are yours so it stops hiding them from you.

Every week it stays blank is another week of matched opportunities you never knew opened.

👉 **[Stop missing your contracts]({{SETUP_URL}})**

— Eric

---

## Email 3 — Day 5 · "It's 3 fields. Don't overthink it."
**Psychology:** 🟡 Almost There (kill the friction on the missing piece)
**Fear-of-loss:** low-key — the cost of "I'll do it later"

**Subject A:** It's literally 3 fields (here's the walkthrough)
**Subject B:** No NAICS memorized? A sentence works.
**Preview:** You can change it anytime. Blank is the only wrong answer.

{{first_name}},

I know how this goes — "I'll set it up later," and later is where good intentions go to die. So let me
remove every excuse.

Setting up your profile is **three things**:

1. **Your industry** — type your NAICS codes, or just describe what you do in plain English and Mindy
   maps them. (Don't know your codes? A sentence is enough.)
2. **Keywords** (optional) — words in the contracts you want: "janitorial," "IT support," "logistics."
3. **Save.** Your first matched alert goes out on the next cycle.

Change anything later, anytime. Getting *something* in beats a blank profile that keeps feeding you noise
you'll just keep ignoring.

👉 **[Do the 2-minute setup]({{SETUP_URL}})**

— Eric

---

## Email 4 — Day 9 · "This is the line between bidders and watchers"
**Psychology:** 🟣 Revenge (prove the doubters wrong) + 🟢 Identity (be the contractor) + 🔵 Escape
**Fear-of-loss:** the identity cost of staying a spectator

**Subject A:** The difference between people who win contracts and people who watch
**Subject B:** Watchers vs. bidders — which inbox is yours?
**Preview:** Relevance is the whole game.

{{first_name}},

Everyone who told you federal contracting was "too hard" or "not for small players" — this is the email
that's actually about them.

Here's the quiet truth about who wins: it's not the smartest or the most connected. It's the ones who
**see the right opportunities first and move while everyone else is still scrolling.** That's the entire
job Mindy does — but only once it knows your business.

A blind account keeps you a *watcher*: 200 irrelevant contracts, tuned out, nothing acted on.
A matched profile makes you a *bidder*: the handful in your lane this week, scored, with the recompetes
you can see coming months out.

You didn't come through a GovCon Giants program to stay a spectator. Flip the switch.

👉 **[Become the one who sees them first]({{SETUP_URL}})**

— Eric

---

## Email 5 — Day 14 · "Last note — should I leave it on?"
**Psychology:** ALL TYPES — final push + clean opt-out + last fear-of-loss
**Fear-of-loss:** loss framed as a real, closing choice (not a fake deadline)

**Subject A:** Last note — should I leave your Mindy on?
**Subject B:** I'll stop bringing this up after today
**Preview:** Two minutes, or it keeps sitting idle.

{{first_name}},

I'll keep this short and stop nudging after today.

You have a fully paid Mindy account sitting idle because it still doesn't know your industry. Every week
it stays that way, the matched contracts in your lane keep opening and closing without you. Not because
you couldn't win them — because you never saw them.

Two minutes ends that:

👉 **[Set up your profile]({{SETUP_URL}})**

If federal contracting isn't your focus right now, no hard feelings — ignore this and I'll stop. But if
it still is, don't let a blank profile be the reason it never happened for you.

Glad you came through one of our programs either way.

— Eric Coffie, GovCon Giants

---

## Buyer-Psychology Distribution (per the bootcamp framework)

| Email | Day | Primary | Secondary | Fear-of-loss anchor |
|-------|-----|---------|-----------|---------------------|
| 1 | 0  | 🟡 Almost There | 🔴 Rock Bottom | matched opps already passing you by |
| 2 | 2  | 🔴 Rock Bottom | 🟡 Almost There | what moved this week without you |
| 3 | 5  | 🟡 Almost There | — | the cost of "later" |
| 4 | 9  | 🟣 Revenge | 🟢 Identity + 🔵 Escape | staying a watcher, not a bidder |
| 5 | 14 | ALL | — | a real, closing choice (no fake clock) |

---

## Optional: single-email test variant (run FIRST to gauge the list)

Send **Email 1 only** to the full segment. Healthy open rate → launch the full 5 to non-openers + rest.
Soft opens → the list is colder than expected; trim to 2–3 emails to protect deliverability.

---

*Drafted 2026-06-30. Method = GovCon Giants Buyer-Psychology + fear-of-loss (real loss, no fake scarcity),
per `~/Bootcamp/email-sequence-bootcamp-january-2026.md`. Audience = `mindy-profile-incomplete` (~4,324).
Goal = profile setup. Value props from the real product (see src/app/api/admin/send-profile-reminders/route.ts).*
