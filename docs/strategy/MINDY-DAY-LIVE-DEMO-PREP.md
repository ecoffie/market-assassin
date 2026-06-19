# Mindy Day — Live Demo Prep Runbook (June 27)

**The moment:** on stage, paste a real company's profile and watch Mindy surface federal
contracts their NAICS search would have MISSED (the hidden-match "💡" engine).

**The risk (measured 2026-06-19):** the engine needs a *capability vector*, and only ~8
accounts have one; only ~5K active opps are SOW-embedded. A COLD demo on a random
volunteer finds **nothing ~99% of the time**. So we PRE-STAGE and VERIFY, never demo cold.

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

## Verified demo-ready candidates (2026-06-19)

Run `--verify-only` the morning of to confirm matches are still live (opps expire).

| Account | Space | Verdict (Jun 19) |
|---|---|---|
| `demo@govcongiants.com` | Federal IT / program mgmt (Tantus-style) | 🟢 5 strong — incl. "IT Managed Service Provider", "Enterprise Financial Services" |
| `brian.polser@dobermanemg.com` | Emergency mgmt consulting/training | run to confirm |
| `obi@attendantsinc.com` | Construction & facilities support | run to confirm |
| `andrellanos@hotmail.com` | Environmental & scientific (coastal) | run to confirm |

**Recommended primary:** `demo@govcongiants.com` — it's an internal demo account (no
real customer's data on stage), already GREEN, and the matches read cleanly for a
federal IT audience.

---

## Stage checklist

- [ ] **Night before:** run `demo-prep.ts <primary>` and `<backup>` → confirm GREEN.
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
