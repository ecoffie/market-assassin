# DISA Vehicle Expiry Watch — Prototype Build Spec

**For:** DISA contact (the first warm gov prototype — `GOVT-GTM-STRATEGY.md` Track 1)
**Status:** Spec — June 14, 2026 (build after Eric confirms shape)
**Thesis:** Replace DISA's MANUAL spreadsheet tracking of IDIQ/IDV vehicles with automated
expiry-watch + auto-notification to the **incumbent vendor** up to 6 months before expiration.

---

## The real problem (Eric, from the DISA contact)

> DISA tracks **all their IDIQ/IDV vehicles by hand in spreadsheets.** When a vehicle nears
> expiration they manually figure out who holds it and notify the incumbent. They want this
> **automated** — alert the **incumbent vendor** up to **6 months** before a vehicle expires.

So this is **NOT** a search/lookup tool (we almost built that). It's an **outbound notification
workflow that replaces a manual process.** The before/after is the pitch:
- **Before:** spreadsheet + manual date-watching + hand-typed emails to vendors
- **After:** upload once (or auto-seed) → system watches every expiry → auto-emails the incumbent at
  6mo / 90d / 30d → DISA sees a dashboard, never touches a spreadsheet

---

## What we already have to build on (don't reinvent)

| Piece | Exists | Reuse for |
|---|---|---|
| IDV/IDIQ pull from USASpending | `/api/app/idv-contracts` + `src/lib/bigquery/recipients.ts` | Auto-seed DISA's vehicles (incumbent, end date, NAICS, ceiling) |
| Batch/resumable alert cron + email | `/api/cron/pursuit-changes` + `sendEmail()` (Resend primary) | The expiry-watch cron pattern, copy it |
| Dispatcher cron model | `cron_jobs` row → `/api/cron/dispatch` (NEVER vercel.json) | Schedule the daily expiry check |
| Recompete/expiry UI | `RecompetesPanel.tsx` | The dashboard surface |
| Award detail (ceiling, expiry, recipient) | `src/lib/usaspending/award-detail.ts` | Vehicle facts |

**This is assembly, not net-new infra.** That's why DISA is the fastest prototype.

---

## Data source — HYBRID, spreadsheet-anchored (resolves Eric's "not sure")

DISA already HAS the list (in spreadsheets). So:
1. **Primary: CSV upload.** DISA uploads their vehicle spreadsheet → we parse (PIID/vehicle #,
   incumbent name, **incumbent vendor email**, expiry date, optional NAICS/ceiling). Their data is
   authoritative — it's what they track today.
2. **Assist: auto-enrich from USASpending.** For each PIID/vehicle, pull our IDV data to fill
   missing fields (end date, ceiling, recipient/UEI) and flag mismatches ("spreadsheet says
   exp 2026-09, USASpending says 2026-12 — confirm").
3. **The gap USASpending CAN'T fill: the vendor's CONTACT EMAIL.** USASpending has the recipient
   name + UEI but **not a notification email.** DISA's spreadsheet has it (or they add it on
   upload). This is why upload is primary, not pure auto-pull.

---

## Build plan (the prototype)

### 1. Table (hand-run SQL — no in-app DDL)
`disa_watched_vehicles` (migration → pbcopy → Eric runs in Supabase → confirm):
```
id uuid pk, org_email text (the DISA account), vehicle_piid text, vehicle_title text,
incumbent_name text, incumbent_uei text, incumbent_email text,  -- the notify target
expiration_date date, ceiling_value numeric, naics text, agency text,
notify_6mo bool default true, notify_90d bool default true, notify_30d bool default true,
last_notified_stage text,        -- '6mo' | '90d' | '30d' | null (so we don't double-send)
source text default 'upload',    -- 'upload' | 'usaspending'
created_at timestamptz, updated_at timestamptz,
unique(org_email, vehicle_piid)
```

### 2. Ingest — CSV upload
- `POST /api/app/disa/vehicles/upload` — parse CSV, upsert rows, auto-enrich from `idv-contracts`,
  return a confirm list (filled vs. needs-attention). Strip NUL bytes from any pasted text.
- Reuse the upload/parse pattern from Proposal Assist's RFP upload.

### 3. Watch + notify — cron (the core)
- `GET /api/cron/disa-vehicle-watch` — batch/resumable, modeled on `pursuit-changes`:
  - Find vehicles whose `expiration_date` crosses a threshold (≤6mo / ≤90d / ≤30d) AND
    `last_notified_stage` not yet at that stage.
  - `sendEmail()` the **incumbent** ("Your contract [PIID] expires [date] — N months out") + cc the
    DISA org. Stamp `last_notified_stage`.
  - First run = snapshot only / no backfire on already-past dates.
- Schedule via a **`cron_jobs` row** (daily) → dispatcher. **NOT vercel.json.**

### 4. Dashboard — DISA-facing surface
- A panel (new tab or a DISA view of RecompetesPanel): table of watched vehicles, expiry countdown,
  notify status per stage ("6mo ✅ sent / 90d ⏳ / 30d —"), and the manual-override "notify now."
- The screenshot moment: **"47 vehicles watched · 12 expiring in 6mo · 8 incumbents auto-notified
  this month"** — the spreadsheet they used to maintain, now automated.

### 5. Demo access
- Stand up a DISA demo account (KV `briefings:{email}` + Supabase) so they can log in and see THEIR
  uploaded vehicles. (Per `app_auth_header_pattern` — every /app fetch sends getMIApiHeaders.)

---

## Honest scope notes

- **The notification email content** needs DISA's voice — is it a courtesy notice, a recompete
  heads-up, a sources-sought prompt? Confirm with the contact before first send (don't auto-email
  real vendors on a guess).
- **Sending to real vendors is outward-facing** — gate the live cron behind an env flag / "dry-run
  mode" until DISA approves the template + the vendor list. Demo = dry-run (show what WOULD send).
- **This is a workflow tool, not market intel** — it's a different product surface from Mindy's
  search. That's fine; it's what DISA actually needs, and it's the wedge (Anduril: solve their real
  problem first, expand later).
- **Expansion path:** once DISA's vehicles are in, the SAME data powers recompete intel, incumbent
  analysis, and the market-research story — land the watch tool, expand to the platform.

---

## Open items
- [ ] Confirm spec shape with Eric (this doc) → then build
- [ ] Confirm the notification email content/voice with the DISA contact
- [ ] Confirm: does DISA want the incumbent emailed directly by us, or a draft DISA sends? (changes
      whether we need their vendor emails or just generate the notices)
- [ ] Hand-run the `disa_watched_vehicles` migration
- [ ] Build ingest → watch cron → dashboard → demo account
- [ ] Keep live sends behind a dry-run flag until DISA approves

---

*Created June 14, 2026. The DISA prototype is an EXPIRY-WATCH + INCUMBENT-NOTIFICATION workflow that
replaces manual spreadsheet tracking of IDIQ/IDV vehicles — assembled from existing pieces
(idv-contracts pull + pursuit-changes cron pattern + sendEmail + dispatcher). NOT the search/export
tool first scoped. Build after Eric confirms shape + notification voice.*
