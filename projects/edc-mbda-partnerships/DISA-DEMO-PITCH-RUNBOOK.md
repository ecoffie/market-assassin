# DISA Demo — Step-by-Step Pitch Runbook

**For:** Eric, demoing the Vehicle Expiry Watch prototype to DISA KOs
**Goal:** Prove the prototype solves their manual IDIQ/IDV tracking → earn the next step (a pilot)
**Length:** 10–12 minutes. **Tone:** "I built the thing you described. Let me show you."

> The whole demo is **dry-run** — nothing gets emailed to anyone. Say that early; it removes fear.

---

## ⏱️ PRE-FLIGHT (do this 15 min before the call)

- [ ] **Log in works.** Go to **https://getmindy.ai/app** → sign in:
      **`disa-demo@getmindy.ai`** / **`DisaDemo!2026`** (if 2FA prompts, it's optional — skip/continue).
- [ ] **Open the panel:** left sidebar → **"Vehicle Expiry Watch"** (Bell icon, under Expiring Contracts).
- [ ] **Confirm the dashboard shows data** — should read ~**8 vehicles watched · 6 expiring ≤6 months**.
      (If empty, the demo data didn't load — text whoever set it up; do NOT demo an empty screen.)
- [ ] **Pre-click "Preview notices" once** so you've seen today's output and nothing surprises you.
- [ ] Have the **sample CSV** handy (`disa-demo-vehicles.csv`) in case you want to re-show the upload.
- [ ] Close other tabs / silence notifications. Share the **single browser tab**, not your whole screen.
- [ ] **One-line reset if needed:** if the data looks wrong, re-run
      `npx tsx scripts/provision-disa-demo.cjs` (reloads the 8 vehicles).

---

## 🎬 THE PITCH (follow in order)

### STEP 0 — Frame it (30 sec, before sharing screen)
> "You told me your team tracks every IDIQ and IDV vehicle by hand in spreadsheets, and when one
> gets close to expiring you manually figure out who holds it and notify them. I built a working
> prototype that does that automatically. It's a dry run today — nothing actually emails anyone —
> so we can look at it safely. Let me share my screen."

**Why:** sets the before/after and disarms the "are you about to email my vendors?" fear immediately.

---

### STEP 1 — "This is your spreadsheet, now automated" (2 min)
**Do:** Share the tab showing the **Vehicle Expiry Watch dashboard** (already loaded).
**Point to the summary cards, top to bottom:**
> "Eight vehicles being watched — this is the spreadsheet, except it updates itself. Six are
> expiring within six months. Three are inside ninety days. And it's already flagged one vehicle
> that's **missing an incumbent email** — so you know exactly what's incomplete."

**Then scroll the table:**
> "Every vehicle, sorted by what's expiring soonest. Each shows the incumbent, the expiration date,
> a live countdown, the ceiling value, and which notification stage it's in — six months, ninety
> days, thirty days."

**Why it lands:** they recognize their own spreadsheet — but it's watching the dates *for* them.

---

### STEP 2 — The payoff: "Preview notices" (3 min) ← the moment
**Do:** Click **"Preview notices."**
**Say:**
> "Here's the part that replaces the manual work. The system already knows which incumbents are due
> for a notice today, and it's **written the email for each one.** This is exactly what your team
> types by hand, every time — done automatically."

**Walk ONE notice end to end** (pick a 90-day / red one):
> "This vehicle, HC1028…, expires in [X] days. Here's the notice ready to go to the incumbent —
> the contract number, the expiration date, the days remaining, and the recompete heads-up.
> Your team didn't write a word of this."

**Then the honesty moment — point to the blocked one:**
> "And notice this one is **blocked** — Beacon Telecom — because there's no incumbent email on file.
> The system won't guess or send to the wrong place. It tells you exactly what to fix. That's the
> difference between a real tool and a demo."

**Reinforce the dry-run:**
> "Nothing here has been sent. The big DRY RUN badge means this is preview-only. When you're ready,
> *you* decide the wording and approve the list before a single email goes out."

**Why it lands:** they SEE the manual work eliminated, AND you've shown the tool is honest about its
own gaps — which is what earns a contracting officer's trust.

---

### STEP 3 — "And it started from your spreadsheet" (1.5 min) — optional but strong
**Do:** Scroll up to the **Upload CSV** box. (Optionally upload `disa-demo-vehicles.csv` live.)
**Say:**
> "Setup is one step: you upload the spreadsheet you already keep. It reads your columns —
> contract number, incumbent, email, expiration — and starts watching. No new system to learn,
> no data re-entry. You hand it what you've got."

**Why:** kills the #1 objection ("we don't have time to set up another tool").

---

### STEP 4 — The close (1 min)
> "That's the prototype — built specifically around what you described. Two quick questions so I can
> make it exactly right for DISA:
> 1. When a vehicle nears expiration, do you want the system to **email the incumbent directly**,
>    or **draft the notice for your team to send**?
> 2. What should that notice actually **say** — a courtesy heads-up, a recompete prompt, a
>    sources-sought nudge?
>
> Give me those two answers and a sample of your real vehicle list, and I'll have a version running
> on your actual data for a small pilot. No cost to look."

**The ask:** a follow-up working session + their real vehicle spreadsheet. NOT a contract today.

---

## 🛡️ ANTICIPATED QUESTIONS (have these ready)

| They ask… | You say… |
|---|---|
| "Is this sending emails to my vendors right now?" | "No — everything is dry-run. It previews what *would* send. Live sending only turns on after you approve the wording and the list." |
| "Where does the contract data come from?" | "Two ways: you upload your vehicle spreadsheet (it has the incumbent contact email), and we can auto-enrich the rest — ceiling, expiry, recipient — from public USASpending data. Your spreadsheet is the source of truth." |
| "How does it know who the incumbent is / their email?" | "From your spreadsheet — that's the one thing public data doesn't have. We fill in everything around it automatically." |
| "Is this approved / authorized to use?" | "It's a prototype on commercial infrastructure — I built it to show you the concept works. Standing it up for real DISA use is exactly what a pilot would scope, including any IT/security review on your side." *(Be honest — don't overclaim an ATO you don't have.)* |
| "What does it cost?" | "The pilot is no-cost to evaluate. If it works and you want it in production, it's a simple commercial software subscription — your office can buy it directly, no big acquisition." |
| "Can it do [X other thing]?" | "Today it does expiry-watch + incumbent notification, because that's the problem you raised. It's built on a platform that also does market research, incumbent analysis, and recompete intel — so yes, that's a natural next step. Let's nail this first." |
| "We have a system that does this." | "Great — does it write and queue the notices automatically, or does your team still do that part? That's the gap I'm solving." |

---

## 🚫 DON'T

- **Don't claim it's sending live** — it's dry-run; say so.
- **Don't overclaim authorization/ATO/FedRAMP** — it's a prototype; be straight, frame production as the pilot's job.
- **Don't demo an empty screen** — verify data loaded in pre-flight.
- **Don't pitch the whole platform** — this demo is the wedge (the one problem they have). Expansion comes after.
- **Don't ask for a contract** — ask for their real vehicle list + the two answers (send direct vs. draft; notice voice).

## ✅ THE ONE-LINE TAKEAWAY (if they remember nothing else)
> "You hand it your vehicle spreadsheet, and it watches every expiration and writes the incumbent
> notices for you — automatically, with your approval before anything sends."

---

## Reference
- **URL:** https://getmindy.ai/app · **Login:** disa-demo@getmindy.ai / DisaDemo!2026
- **Panel:** sidebar → "Vehicle Expiry Watch"
- **Sample data:** `disa-demo-vehicles.csv` · **Reload:** `npx tsx scripts/provision-disa-demo.cjs`
- **The two open decisions** (from `DISA-VEHICLE-WATCH-SPEC.md`): direct-send vs. draft · notice voice
- **Bigger strategy context:** `GOVT-GTM-STRATEGY.md` (this is Track 1 — sell direct; land DISA, expand)

*Created June 14, 2026.*
