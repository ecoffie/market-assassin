# PRD — Semantic Keyword Derivation from UEI Autofill (+ Vault teaching moment)

**Status:** Planned (BLOCKED on pgvector). Eric's call (2026-06-11): do this the RIGHT
way with true semantic search, not the deterministic NAICS-title shortcut.

**The gap (Eric):** When a user enters their UEI, SAM autofills NAICS + PSC + identity —
but produces **zero keywords**. So their profile matches on NAICS only and misses the
body-buried opportunities (the SAME root cause behind the zero-alert problem: 88% of
zero-alert users have NAICS-only profiles — see [[prefilled_naics_not_real_signal]]).
"Some people have no idea of the gap — this could be another teaching moment."

---

## Goal

After UEI autofill, **derive keywords by MEANING** from what the contractor has actually
done, seed them into alerts, and **teach the keyword gap** in the Vault so the user
understands *why* keywords matter (their NAICS says who they ARE; keywords say what they
SELL — and catch work the NAICS/title misses).

---

## Why semantic (not the deterministic shortcut)

We already have `deriveKeywordsFromNaics()` (splits NAICS title words) — fast but thin: it
only sees title words, not meaning. Eric chose to **wait and do it right**:

- Embed the contractor's **past-performance descriptions** (USASpending `scope_description`,
  already pulled during UEI prefill) + NAICS/PSC titles + the AI capability summary.
- Cosine-match against a keyword/term space to surface the words buyers actually use for
  this kind of work — catching nuance title-splitting misses (the "drones live in 70+
  NAICS" problem).

This is genuinely "semantic search" — keywords grounded in real work, by meaning.

---


---

## Build (once unblocked)

### 1. Derive keywords at UEI autofill — `src/app/api/app/vault/prefill/route.ts` (POST)
After writing identity + past performance:
- Build a "what this company does" text blob from: `primary_naics` titles + `psc` titles +
  past-performance `scope_description`s + the AI `one_liner`/`elevator_pitch`.
- `embedText()` it; cosine-match against the term space (NAICS/PSC vocab + a keyword
  thesaurus, or nearest terms in the embedded opportunity corpus) → top ~12 keywords.
- **Seed `user_notification_settings.keywords`** via the existing additive path
  (`/api/app/keywords/add` style — NEVER clobber tuned keywords; see [[naics_sync_vault_alerts]]).
- Return `keywords_derived: string[]` in the prefill response.

### 2. Teaching moment in the Vault — `src/components/app/panels/VaultPanel.tsx`
When `?onboarded=1` AND keywords were just derived:
- Show a panel: **"Here are your keywords — and why they matter."**
- List the derived keywords (editable — let them remove/add).
- Reuse **`MarketCoverageBanner`** (`src/components/app/market/MarketCoverageBanner.tsx`) for
  the top 1–2 keywords: "the obvious NAICS = X% of the market → searching it alone misses
  Y%." (Powered by `keywordCoverage()` in `src/lib/market/keyword-coverage.ts`.)
- One line: *"Your NAICS codes say WHO you are. Keywords say WHAT you sell — and catch work
  your codes alone miss."*
- "Looks good" confirms + enables them for alerts; "Edit" lets them tune.

### 3. Alerts use them immediately
`daily-alerts` cron already reads `user_notification_settings.keywords` and passes them to
SAM/grants search. No cron change needed — populating keywords is the whole job.

---

## Acceptance
- UEI user finishes autofill → has a real, meaning-derived keyword set (not empty, not just
  NAICS-title words).
- They see the gap lesson with THEIR keywords → understand why it matters.
- Alerts start matching on those keywords (body-buried opps surface — ties to the
  4-corpus search already shipped).
- Existing tuned keywords are never clobbered.

## Related
[[prefilled_naics_not_real_signal]] · [[sam_description_body_capture]] · [[naics_vs_psc_search]]
· [[naics_sync_vault_alerts]] · keyword forward-capture (onboarding, already shipped).

## ✅ BUILT + DEPLOYED 2026-06-11
Shipped: semantic-keywords.ts (deriveSemanticKeywords), vault/prefill seeds keywords additively + returns keywords_derived, VaultPanel keywords teaching stage. Reuses live embedText+cosineSimilarity (no pgvector). Pending: verify against a live authenticated UEI prefill.
