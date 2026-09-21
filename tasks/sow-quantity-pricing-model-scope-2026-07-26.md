# SOW-Quantity Pricing Model — Scope & Feasibility (2026-07-26)

**The idea:** get a *point* dollar estimate (not just a range) by extracting quantities from an
opp's SOW ("17 acres of herbicide treatment," "50 units") and multiplying by a per-unit rate.
This is the ONLY honest path to "$100K-accurate" on high-variance NAICS where the comparable-award
band is genuinely millions wide (the underlying contracts really do span that much).

## Feasibility — MEASURED against real data (11,248 active opps)

| Gate | Reality | Verdict |
|---|---|---|
| Opps with real SOW text (>200 chars) | **2,502 / 11,248 = 22%** | Ceiling: model can only ever touch ~1 in 5 opps |
| SOWs mentioning a quantity (hours/units/area) | ~1,200–1,500 (raw regex) | ~12% of all opps |
| **Quantities that are REAL SCOPE** (not noise) | **~1 in 5–8 of matches** | ⚠️ THE PROBLEM |

**The killer finding (sampled real SOW text):** naive "number + unit" matches are mostly NOT the
contract's sizing. Real examples pulled from live SOWs:
- "24 hours a day/7 days a week" → a *schedule*, not labor hours
- "4 hours, initiate work within 6 hours" → a *response time*
- "48 hours prior to the scheduled hot work" → a *notice period*
- "each with a 24 US Tray capacity" → an *equipment spec*
- "3 acres" → ✅ actually real scope (the minority)

So a regex/grep approach ships GARBAGE most of the time (the 94-char-stub trap). Distinguishing
"3 acres of treatment" (scope) from "48 hours notice" (not) requires **semantic understanding** —
i.e. an LLM extraction, not a regex.

## The SECOND hard blocker: no per-unit rate source

Even with a clean quantity, quantity × rate needs a **rate**. We do NOT reliably have per-unit
rates ($/acre, $/unit) for arbitrary work:
- GSA CALC gives **labor $/hr** (already used in the pricing-intel section) — helps ONLY for the
  ~38% of SOWs quantified in hours, and only if we also know the FTE/duration.
- No source for $/acre-herbicide, $/unit-widget, $/sq-ft-roofing that generalizes across NAICS.

So even the clean-quantity subset can't be multiplied to a dollar figure for most work types.

## Honest verdict

A SOW-quantity model is **NOT worth building as a general estimator.** It would apply to a small
slice (~12% raw, far less after removing noise), needs an LLM to extract (not a regex), AND lacks a
per-unit rate source for most work — so it can't produce a dollar figure even when it finds a clean
quantity. It's a plausible-but-weak feature that would ship wrong numbers.

## What IS worth doing instead (ranked)

1. **Keep the comparable-award RANGE as the honest unit** (done). The band, not a point estimate,
   is the truthful representation of genuinely-variable federal contract sizes. 25-75 + sub-agency
   is the tightest honest version.
2. **Labor-hours sub-model (NARROW, LLM-gated)** — for the ~38% of SOWs that quantify labor hours,
   an LLM could extract "estimated N labor hours" (when it's real scope, not a schedule) and pair
   it with the GSA CALC $/hr we already pull → a *labor-cost* estimate for services work. This is
   the ONE defensible slice: services (541xxx) where hours × loaded rate is a real costing method.
   Still LLM-cost + accuracy-gated; scope as its own experiment with an offline eval (like the
   proposal eval harness) before shipping.
3. **Set-aside conditioning** — if we ever get set_aside populated in recompete_opportunities (it's
   NULL today), conditioning the range on set-aside would tighten it more (a small-biz set-aside
   compares only to small-biz awards). Cheaper win than the SOW model.

## Recommendation

Do NOT build the general SOW-quantity model. If a tighter number is still wanted on services opps,
scope option #2 (labor-hours × CALC-rate, LLM-extracted, offline-eval-gated) as a separate small
experiment. Otherwise the tightened comparable-award band is the honest best.

---

## Option #2 (labor-hours sub-model) — SCOPED & MEASURED (2026-07-26). Verdict: NOT worth building.

Measured the addressable set for the narrow labor-hours×rate idea:
| Gate | Reality |
|---|---|
| Professional-services (541xxx) opps w/ real SOW | **236** |
| Broad services (541+561) w/ real SOW | **421** |
| Services SOWs with ANY labor-hours/LOE/FTE keyword | **26** (0.2% of all active opps) |
| Of those 26, keyword is a REAL level-of-effort | **~1–3** (sampled) |

**The 26 "hits" are the SAME noise problem, worse:** sampling the actual text, the labor-hours
keyword almost always matched something else —
- "24 hours per day, 7 days per week" → operating/coverage hours (4× of the 10 sampled)
- "manned 24 hours per day year-round" → staffing schedule
- "estimated to average 110 hours per response" → the **Paperwork Reduction Act OMB burden
  statement** — federal-form boilerplate, unrelated to the contract (2× of 10)
- "40 hours per week" → a work schedule
- "3 FTE), hospital physicians" → ✅ a real LOE fragment (the rare exception)

So even the narrow slice is **~1–3 usable opps out of 11,248**. Building an LLM extraction + rate
pairing for that is not justified — the effort/accuracy/cost ratio is terrible, and getting the
extraction wrong ships a confidently-wrong dollar figure on the very opps a user is scrutinizing.

**FINAL: no SOW-derived point estimate (general OR labor-hours).** The federal SOW corpus does not
carry level-of-effort in a machine-extractable, non-noise way at any useful scale. The comparable-
award BAND (25-75 + sub-agency conditioning, backtested) is the honest ceiling of what award data
supports. The remaining cheap tightening lever is **set-aside conditioning** IF/when set_aside gets
populated in recompete_opportunities (NULL today) — that's the next real win, not SOW extraction.
