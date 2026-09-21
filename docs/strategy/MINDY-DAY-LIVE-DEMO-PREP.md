# Mindy Day — Live Demo Prep Runbook (June 27)

**The moment:** on stage, paste a real company's profile and watch Mindy surface federal
contracts their NAICS search would have MISSED (the hidden-match "💡" engine).

**The risk (measured 2026-06-19):** the engine needs a *capability vector*, and only ~8
accounts have one; only ~5K active opps are SOW-embedded. A COLD demo on a random
volunteer finds **nothing ~99% of the time**. So we PRE-STAGE and VERIFY, never demo cold.

---

## Demo account & prototype tabs — UPDATED Jun 22, 2026

**What changed (deploy `fe3de6ac`):**
- **Prototype tabs are now allowlist-gated, not staff-gated.** *Vehicle Expiry Watch*,
  *SMB Market Research*, and *Market Research Report* no longer show for ANY account by
  default — including `@govcongiants.com` staff and demo accounts. To show them for a
  demo, add the demo account's email to the **`MINDY_PROTOTYPE_EMAILS`** Vercel env var
  (comma-separated) and redeploy. Unset = hidden everywhere. This is the only way to
  surface those three tabs now.
- **`getmindy.ai` is now a staff/company domain** (alongside `govcongiants.com` /
  `govconedu.com`). Being staff no longer reveals the prototype tabs — that's the
  `MINDY_PROTOTYPE_EMAILS` allowlist's job now.
- **The default demo view is the clean Pro-member view** (no prototype clutter) — which
  is what you want for a customer-facing demo.

**Logging into a demo account (the `demo@govcongiants.com` inbox is NOT accessible):**
- Magic-link / Google sign-in to `demo@govcongiants.com` won't work (no inbox access). Either:
  - **Set a password via admin**, then sign in at `getmindy.ai/app` with email + password:
    `POST /api/admin/set-mindy-password?password=<ADMIN_PASSWORD>` with body
    `{"email":"<demo>","newPassword":"<8+ chars>"}` (account must already exist; 404 → create it first).
  - **Or use a `getmindy.ai` demo address** whose inbox you CAN read (magic link / signup confirm).
- `@getmindy.ai` and `@govcongiants.com` are auto-staff (no access grant needed). A demo
  email on any other domain needs `/api/admin/grant-team-access` or `/api/admin/grant-ma-tier` first.

**Seeding a demo persona** — `scripts/seed-demo-vault.ts` now takes the target email as an arg:
```bash
npx tsx scripts/seed-demo-vault.ts                  # demo@govcongiants.com (default)
npx tsx scripts/seed-demo-vault.ts demo@getmindy.ai # seed a getmindy.ai demo account
```
Guarded against `eric@govcongiants.com` / `eric@getmindy.ai` so it never clobbers Eric's real account.

---

## The tool: `scripts/demo-prep.ts`

Builds (or refreshes) an account's capability vector with the **real production
function** (same as the nightly cron), runs the **real matcher**, and prints exactly what
Mindy would show on stage with a GREEN / YELLOW / RED verdict.

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npx tsx scripts/demo-prep.ts <email>                 # build vector + verify
npx tsx scripts/demo-prep.ts <email> --verify-only   # just re-check (no rebuild)
npx tsx scripts/demo-prep.ts <email> --threshold 0.30 --max 8   # preview weaker matches
```

**Verdicts:**
- 🟢 **GREEN** — ≥2 strong matches (≥0.40). Demo-ready. Use the top result on stage.
- 🟡 **YELLOW** — matches exist but few are strong. Demo-able; pick the top result
  carefully and keep the Vimeo fallback ready.
- 🔴 **RED** — no vector or empty pool. Do NOT demo this account.

---

## Ranked demo-ready shortlist (all 8 candidates verified 2026-06-19)

Run `--verify-only` the morning of to confirm matches are still live (opps expire).
"Strong" = cosine ≥ 0.40. GREEN = ≥2 strong.

| Rank | Account | Space | Verdict | Headline match(es) |
|---|---|---|---|---|
| 🥇 | `brian.polser@dobermanemg.com` | Emergency mgmt consulting/training | 🟢 **7 strong** | Ground Ambulance @ Ft. Polk · Forensic Behavioral Science (State) |
| 🥈 | `demo@govcongiants.com` | Federal IT / program mgmt | 🟢 **5 strong** | IT Managed Service Provider · Enterprise Financial Services |
| 🥉 | `obi@attendantsinc.com` | Construction & facilities (HUBZone) | 🟢 **6 strong** | Fire-panel replacements · Automatic-doors maintenance |
| 4 | `andrellanos@hotmail.com` | Environmental/scientific (USVI) | 🟢 **5 strong** | Munitions clearance · Marsh creation · Eelgrass survey |
| 5 | `tavin@alfordcontracting.com` | Energy/construction (8(a)+WOSB) | 🟢 **4 strong** | Army microgrid · Airfield lighting vault |
| — | `candice@capglobalworks.com` | Multimedia production | 🟡 1 strong | Chaplain Corps Multimedia |
| — | `miazhudson@gmail.com` | Admin/mgmt consulting | 🟡 1 strong | Freshworks licenses |
| ⛔ | `eric@govcongiants.com` | Strategic planning (generic) | 🟡 **0 matches** | — (too generic; do NOT use) |

**Recommended PRIMARY: `brian.polser@dobermanemg.com`** — most compelling story. Its
matches (Ground Ambulance, Forensic Behavioral Science) are exactly the "your NAICS search
would NEVER have shown these" moment — vivid proof of the 💡 hidden-match value.
⚠️ It's a real customer account — **get Brian's OK** before featuring his company on stage.

**Recommended BACKUP: `demo@govcongiants.com`** — the SAFEST pick: internal demo account
(no real customer data in lights), still GREEN, reads clean for a federal IT audience. Use
as primary instead if you'd rather not put a customer on stage.

**Notes / do-not-use:**
- `obi@attendantsinc.com` is GREEN but its #1 result was a noisy "IT Managed Service
  Provider" (it's a construction firm) — fine as a backup, skip for the headline demo.
- `eric@govcongiants.com` → 0 matches (generic "strategic planning" profile). This is the
  engine being HONEST (it won't invent matches), not a bug — but don't demo it.

---

## Stage checklist

- [ ] **Confirm the demo company:** get Brian's OK to feature `dobermanemg.com`, OR fall
      back to `demo@govcongiants.com` (internal — no permission needed).
- [ ] **Night before:** run `demo-prep.ts brian.polser@dobermanemg.com` and
      `demo-prep.ts demo@govcongiants.com` → confirm both 🟢 GREEN.
- [ ] **Screen-record** the GREEN run (Vimeo) as the fallback if the live API stumbles.
- [ ] **Morning of:** `--verify-only` both accounts (opps may have expired overnight).
- [ ] On stage: open the account, trigger hidden-match, point at the 💡 matches +
      explain "their NAICS search would never have shown these."
- [ ] If the live call hangs >5s: cut to the recorded Vimeo, keep narrating.

---

## Why we are NOT expanding coverage before launch

SOW embedding is already maxed: **8,790 of 8,799 opps that *have* SOW text are embedded.**
The ceiling is SOW-text *extraction* (only ~9% of opps have it) — a separate multi-day
pipeline (notice descriptions + attachments), not a cron we can run harder. Chasing it 8
days out is the wrong risk. We work within the embedded pool and pre-stage instead.
(See memory `hidden_match_coverage_reality`.)
