# PRD — Event Contact Follow-Up (Mindy V2)

**Status:** Draft / backlog (V2). Not started.
**Author:** Claude (from Eric's V2 idea, 2026-06-27)
**One-liner:** Turn the contacts you meet at an event into a worked pipeline —
input them, Mindy sends the follow-up emails, and the next touches land on your
calendar on a cadence. "Never lose a business card again."

---

## 1. The problem

A small-biz contractor goes to an industry day / matchmaking event and walks out
with 15 business cards. Within two weeks, 13 of them are cold — no follow-up, no
system, no reminder. The relationships that win subcontracts die in a stack of
cards. They don't need a heavyweight CRM (Salesforce is overkill and jargon-heavy);
they need: **capture fast → first email goes out → remind me when to reach out
again.**

This is squarely Mindy's lane: Mindy is the BD analyst. BD is relationships, not
just opportunities. We already track teaming partners + pipeline — this is the
"people I met" front door to that pipeline.

## 2. Scope guard (Eric's principles — read first)

- **Reuse, don't add surface.** Build on `user_teaming_partners` (it already has
  `contact_name/email/phone`, `notes`, `outreach_status`, `last_contact`,
  workspace columns). Do NOT create a parallel `contacts` system.
- **Low-floor / high-ceiling.** The floor: paste a name + email, get a follow-up
  scheduled. The ceiling: full cadence + calendar sync. Ship the floor first.
- **Free = capture + reminders. Paid (Pro) = Mindy writes/sends the emails.**
  (Automated outbound is a Pro "answers/does-the-work" feature; manual capture +
  a reminder is reasonable on Free.)
- **Plain language.** "Follow-ups," "people you met," "reach out again." NOT
  "leads / sequences / cadences / nurture / drip" in the UI (those are fine in
  code/this doc). Federal acronyms OK.
- **No personal brand in UI** (exit-strategy rule) — it's "Mindy," not "Eric."

## 3. The flow (user-facing)

1. **Capture** — After an event, the user adds contacts. Three input speeds:
   - Quick paste: name + email + one line of "what we talked about."
   - One-by-one form (name, company, email, phone, notes, met-at).
   - (V2.1, later) bulk paste / business-card photo OCR — explicitly deferred.
2. **First touch** — On save, Mindy drafts a follow-up email grounded in the
   note ("Great meeting you at [event]; you mentioned [X]…"). User reviews →
   send now, or schedule. (Pro: auto-send; Free: copy/send yourself.)
3. **Cadence** — User picks a re-touch schedule per contact (default
   **Day 1 → Day 7 → Day 30 → Day 90**, editable). Each touch:
   - drops a **reminder on their calendar** (Google Calendar link + .ics), and/or
   - (Pro) Mindy sends the scheduled follow-up email automatically.
4. **Track** — Contact moves through `outreach_status`
   (none → contacted → responded → meeting → partnered). Replying/advancing
   pauses the automated cadence (don't keep nudging someone who answered).

## 4. Data model (reuse `user_teaming_partners`)

Add a few nullable columns via a hand-run Supabase migration (this DB has no
in-app DDL — write SQL, pbcopy, user runs it, verify columns, then use them):

| Column | Type | Purpose |
|--------|------|---------|
| `source` | TEXT | 'event' \| 'manual' \| 'import' — segment event contacts |
| `met_at` | TEXT | event/context label ("AFCEA West 2026") |
| `met_on` | DATE | when met (cadence anchor) |
| `followup_cadence` | INT[] | day offsets, e.g. `{1,7,30,90}` (default) |
| `followup_paused` | BOOLEAN | true once they respond / user opts out |
| `last_followup_day` | INT | highest cadence day already fired (dedupe) |

`outreach_status`, `contact_name/email/phone`, `notes`, `last_contact` already
exist — no new table. Workspace columns already present → Coach Mode multi-client
works for free (a consultant can run this per client).

## 5. Plumbing (all existing infra — no new external deps)

- **Email** — `src/lib/send-email.ts` `sendEmail()` via the verified
  `mail.getmindy.ai` sender (the path proven in the Mindy Launch). New
  `emailType: 'contact_followup'`. Respects suppression; NOT transactional
  (it's outbound the user initiated, but still cap-aware).
- **Email drafting** — `callLLM({ job:'reasoning' })` (gpt-4o-mini-first, the
  cost-disciplined path) grounds the draft in `notes` + `met_at`. Ground every
  fact in the note; never invent a detail about the person (the #1 data rule).
- **Scheduling** — the **dispatcher** (`cron_jobs` row → `/api/cron/dispatch`,
  hourly). One new daily job mirrors `upgrade-drip`:
  `/api/cron/contact-followups` computes `age = daysBetween(met_on, now)` per
  non-paused contact; when `age` hits the next cadence day, it (a) sends the
  scheduled email [Pro] and/or (b) is already covered by the calendar invite the
  user got at capture. Stamp `last_followup_day` to dedupe. **No vercel.json
  cron** (project rule).
- **Calendar** — reuse the Google Calendar URL builder + inline `.ics` generator
  from `launch-confirmation-email.ts` / the launch thank-you page. Each cadence
  touch → an "all-day reminder: reach out to [name]" event. No Google Calendar
  API / OAuth in MVP (link + .ics only — low-floor).

## 6. UI (a panel, not a new route)

Per the Unified MI architecture, this is a **panel inside the app sidebar**, not
a separate route. Candidate: extend the existing **Teaming/Contacts (CRM)** panel
with a "People I Met" view + an "Add contacts" quick-capture. Reuse
`ContactsPanel` / teaming components; don't build a parallel surface.

## 7. MVP (smallest shippable slice)

1. Migration: the 6 columns above.
2. Quick-capture (name + email + note + met_at) → writes `user_teaming_partners`
   with `source='event'`, default cadence.
3. On save: generate a Google Calendar reminder link for Day 1 + an AI-drafted
   first email the user can copy/send (Free) — **no auto-send yet.**
4. `contact-followups` dispatcher job: for Pro users, auto-send the Day-N email;
   for Free, no send (calendar reminders only).
5. Status change → `followup_paused = true` when status ≥ 'responded'.

Defer: business-card OCR, two-way email threading, reply detection automation,
Google Calendar API sync, SMS.

## 8. Open questions (decide before build)

- **Auto-send on Free?** Recommend NO — capture + calendar reminders on Free;
  Mindy-sends-for-you is the Pro hook. (Confirm with Eric.)
- **Deliverability of user-as-sender:** outbound "from" the user to their contact
  — send via `mail.getmindy.ai` with reply-to = user's email, or require the user
  to connect their own mailbox? MVP: send from Mindy w/ reply-to user (simplest);
  flag that some contacts may see "via getmindy.ai."
- **Anti-spam / consent:** these are warm contacts the user met, but bulk outbound
  has CAN-SPAM exposure. Cap per-day, include an unsubscribe, never let it become
  cold mass-mail. (Ties to the existing suppression list.)
- **Compliance with the "no cold mass-mail" posture** — this is 1:1 warm
  follow-up, not list-blasting; keep it that way in product + copy.

## 9. Why this fits Mindy

It converts Mindy from "find the opportunity" to "work the relationship that wins
it" — the other half of BD — using infra we already have (teaming table, verified
sender, dispatcher, calendar helper, LLM drafting). High ceiling, low floor, no
new surface area. A natural V2 headline feature: **"Mindy remembers everyone you
meet — and tells you when to follow up."**
