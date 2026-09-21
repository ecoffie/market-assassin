# Beta-Preview → v1.0 Trial Extension (executed 2026-06-10)

**What:** The original beta-preview MI/Mindy access (PHASE_1_BETA_END = 2026-06-30)
was extended +30 days so beta users can try the new **Mindy v1.0** (not the beta).

## The cohort (725)
- = `user_notification_settings.briefings_enabled=true AND is_active=true` (749)
  MINUS protected real payers (ultimate/pro-giant/$498+ = 26) = **725**.
- Bootcamp (9,916) NOT included. Real lifetime/dated payers NOT included.

## What was written to user data
1. **Schema** (hand-run): `user_notification_settings.trial_ends_at` + `trial_source`.
2. **Seed:** 725 rows set `trial_ends_at='2026-07-30T23:59:59Z'`,
   `trial_source='beta_preview_v1_extension'`. Verified 725/725.
3. **KV move:** deleted the PERMANENT `briefings:{email}` KV grant for the 725
   (393 had a key) so resolveAccess falls through from the paid path to the TRIAL
   path. Protected payers' KV keys were NEVER touched (delta 0).

## How it resolves now (proven)
- Beta → `pro (trial)` ends 2026-07-30 → drops to `free` after (fail-open).
- Lifetime/paid → `pro (stripe)` (untouched).
- Bootcamp → `free`.

## REVERSAL (if needed)
- Re-grant: `kv.set('briefings:{email}','true')` for the cohort, OR
- Clear trial: `UPDATE user_notification_settings SET trial_ends_at=NULL,
  trial_source=NULL WHERE trial_source='beta_preview_v1_extension';`

## Still TODO
- [ ] **Launch email** to the 725: "We switched to Mindy v1.0 — your access didn't
      expire, you have 30 more days (through July 30). Log in to claim it →" (drives
      login → profile creation → Auto-setup → conversion).
- [ ] On/before July 30: convert (Stripe) or let drop to free. MINDY_TRIAL_OPEN can
      hard-close early if needed.
- [ ] The ~5% (KV-missing) drift was already on the trial path — fine.
