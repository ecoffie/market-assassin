# Proposal Writer Fine-Tune Pipeline

Mirrors the Content Reaper LinkedIn fine-tune (`~/Linkedin App/data-collection/`)
— OpenAI `gpt-4o-mini`, `{system,user,assistant}` JSONL, `n_epochs: 3` — but
trained on Mindy's winning PROPOSAL corpus instead of viral LinkedIn posts.

## The flow (same as Content Reaper)

1. **`build-training-data.mjs`** — pull winning proposal docs from
   `mindy_rag_documents`, shape each into `{system, user, assistant}` training
   examples, write:
   - `proposal_finetune.jsonl` — the training file (OpenAI chat format)
   - `proposal_finetune_review.md` — human-readable, **REVIEW THIS BEFORE TRAINING**
2. **Eric reviews** the review file — fine-tuning is garbage-in-garbage-out, so
   bad examples = bad model. Cut/fix anything off-voice or fabricated.
3. **`submit-finetune.mjs`** — upload + start the OpenAI fine-tune job (suffix
   `govcon-proposals`), save the job id.
4. **`check-status.mjs`** — poll until done, print the `ft:gpt-4o-mini:...:
   govcon-proposals:...` model id.
5. Wire the model id into Proposal Assist via env `PROPOSAL_FINETUNED_MODEL`
   (the existing v2 engine stays as fallback).

## Data reality (2026-06-06)

| doc_type | count | usable? |
|---|---|---|
| sources_sought_loi | 17 | ✅ best — complete self-contained responses |
| technical_volume | 19 | ⚠️ huge (up to 57K words) — slice into sections |
| cap_statement | 6 | ✅ |
| past_performance | 3 | ✅ but thin |
| pricing_volume | 2 | ⚠️ mostly tables, low prose value |

We do NOT have the original RFPs these responded to, so the `user` prompt
(input) is reverse-engineered from each doc's own subject/scope. That's fine for
teaching VOICE + STRUCTURE (the goal) — the model learns "how a winning federal
response reads," then the live app supplies the real RFP + Vault at generation.

**Minimum for a useful fine-tune:** OpenAI needs ≥10 examples; 50-100+ is better.
With section-slicing of the technical volumes we can get to a usable count.

## Run

```bash
cd scripts/proposal-finetune
node build-training-data.mjs          # → jsonl + review.md  (REVIEW FIRST)
# ... Eric reviews proposal_finetune_review.md ...
OPENAI_API_KEY=... node submit-finetune.mjs
OPENAI_API_KEY=... node check-status.mjs
```

## Model strategy — DATA-DRIVEN (queried SAM cache 2026-06-06)

10,907 respondable opps: **73% full-proposal** (Combined Synopsis 41% +
Solicitation 32%), **9% Sources Sought** (LOI). RFQ/IDIQ/BPA/OTA are <1% by
keyword — they're CONTRACT VEHICLES, not response styles.

**→ Train 2 voice fine-tunes, not a model per type:**
- `govcon-loi` — Sources Sought / LOI (market-research responses). 11 examples.
- `govcon-technical` — full proposal / technical volume (the 73%). 125 examples.

**Everything else → RAG**, not new models:
- OTA / IDIQ / BPA / vehicle-specific + agency quirks → add winning examples to
  the `mindy_rag_documents` corpus, tagged by type. Instantly available at
  generation (retrieved as "write like this"), no retraining.
- RFQ → a pricing/quote template + the technical voice for any narrative.

**Getting better over time = hybrid:**
- Breadth: new response type → add docs to RAG (instant, free, no model).
- Depth: as you win more bids → add to RAG; periodically RE-RUN the 2 fine-tunes
  on the grown corpus to lift the baseline.
Fine-tune = house VOICE (stable, 2 models). RAG = situation KNOWLEDGE (grows
forever). This is how Perplexity/Harvey-class products scale.

## ⚠️ SAM is a biased sample — RAG is the GROWTH ENGINE, not a "long tail" (Eric)

IDIQ task orders = the bulk of real per-unit spend, but competed OFF-SAM. Serious
contractors bid in universes SAM never sees: National Labs (NREL + DOE labs),
NECO, Unison/PIEE, GSA eBuy, state/local.

**Voice fine-tunes TRANSFER across sources** — a technical volume reads the same
for SAM, NREL, or a GSA task order. So the 2 fine-tunes stay correct.

**RAG is how we onboard whole new solicitation universes** (not leftovers):
- New source/type (NREL response, NECO format, GSA task order, state RFP, OTA,
  `task_order_response`) → add winning examples to the corpus, tagged by type/
  source. Instantly usable, no retraining.
- `task_order_response` is its own corpus doc_type: shorter, vehicle-aware,
  references the base IDIQ. Technical voice + corpus shape.

The extraction layer is built SOURCE-PLUGGABLE (SAM = first adapter) so the same
pipeline absorbs many sources over time. See PRD-proposal-extraction-compliance.
