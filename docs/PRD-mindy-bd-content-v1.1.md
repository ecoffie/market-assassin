# PRD: "Mindy writes your BD content" (Content Reaper woven in) — v1.1

> Eric: Content Reaper is a proven, fine-tuned app we'll lose when shop pages
> shut down. Don't make it a sidebar tab (noise). Weave it into Mindy at the
> moment of BD intent. v1.1 — after the rest of launch is done.

**Status:** Scoped + feasibility CONFIRMED — 2026-06-07. Build in v1.1.

---

## 0. Feasibility (checked the engine)

`/api/content-generator/generate` (the Content Reaper engine, Grok + fine-tuned):
- **ONE hard requirement: `targetAgencies`** (errors without it). Everything else
  is optional with defaults.
- `companyProfile` (companyName, userRole, coreServices, differentiators,
  certifications, contractVehicles, pastPerformance, naicsCodes) — OPTIONAL,
  maps ~1:1 to Mindy's **Vault**.
- `previousAngles` — the no-repeat list (Eric: "we wired in factors to not
  repeat the post"). We pass the user's prior posts so each is unique.

**Verdict:** generating a post FROM a Target List agency card works — the agency
is the required input (we have it), Vault auto-fills the profile. Zero extra
input needed; the user can enrich via Vault.

---

## 1. Placement (Eric's call)

**On Target List agency cards** — "✍️ Draft a post" next to "Who to contact".
That's the moment of BD intent: you're looking at an agency you want to win work
with → Mindy drafts a LinkedIn post to get on their radar. Enhancement, not a
tab. (Possible later: also on Pursuit cards.)

NOT a sidebar tab. NOT a standalone destination.

---

## 2. Minimum for a GOOD (non-generic) post

The engine runs on the agency alone, but for quality the minimum is:
1. **Target agency** — auto, from the card.
2. **Company name** — from Vault identity.
3. **Core services** (1-2 lines of what you do) — from Vault capabilities.

With those three + the agency's pain points (already in the engine), Mindy writes
a credible, agency-targeted post. Certs / past performance / differentiators make
it stronger but aren't required.

**If Vault is thin:** prompt for the 2 missing fields (name + services) inline
before generating, rather than producing generic filler.

---

## 3. The flow (v1.1)

1. User expands a Target List agency card → clicks **✍️ Draft a post**.
2. A lightweight composer opens, pre-seeded: agency (required), Vault profile
   (auto), template choice (story / data / question / thought-leadership), and
   the user's `previousAngles` (no-repeat).
3. If Vault lacks name/services → inline prompt for those two.
4. Mindy generates 1-3 grounded posts. User copies / edits / saves.
5. Saved posts feed `previousAngles` so the next batch never repeats.

---

## 4. What we reuse vs. build

- **Reuse:** the whole Content Reaper engine (`/api/content-generator/generate`),
  its templates, agency pain-point grounding, the no-repeat logic, the fine-tune.
- **Build (small):** a Vault→companyProfile mapper, the inline composer modal,
  the "Draft a post" trigger on the agency card, storing previousAngles per user.

---

## 5. Why this fits Mindy (the strategic point)

Content that's GROUNDED in the user's target agency + their real Vault is
something ChatGPT structurally can't produce (it doesn't know your bid or your
company). So "Mindy writes your BD content" reinforces the bid-aware moat — it's
not a generic post generator bolted on, it's Mindy helping you build the exact
agency relationships she's already mapping. See [[proposal_assist_v1]] for the
"reuse what's built, ground in real data" pattern.

---

## 6. Decision log
| Date | Decision |
|---|---|
| 2026-06-07 | Feasibility confirmed (targetAgencies = only hard req, maps to Target List; Vault → companyProfile). Placement: "Draft a post" on Target List agency cards. Min for quality = agency + company name + core services. v1.1, after launch QC. Don't build yet. |
