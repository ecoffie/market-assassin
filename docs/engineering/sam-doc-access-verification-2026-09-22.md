# SAM document access — verification record + incident log (2026-09-22)

Branch `feat/mcp-doc-paging`. Companion to the PR. Two things belong here rather
than in a commit message: the reconciliation of two figures that look like they
contradict each other, and an incident I caused.

---

## 1. Reconciliation — "all seven reconstructed exactly" vs "88.9%"

Both statements are true; they measure different quantities, and the earlier
packets did not say which was which. Measured on VA `36C24226Q0857`
(notice `2d232f3ce1f04085be52cbfe43a0e463`), cache disabled, cold path:

| document | available (`char_count`) | reconstructed | byte-compared | sha256(reconstructed) |
|---|---|---|---|---|
| `36C24226Q0857_1.docx` | 148,483 | **148,483** | 120,000 | `0fb0259c2869f543` |
| `WD Essex.docx` | 41,803 | **41,803** | 41,803 | `0c8ab7a17d569d1b` |
| `WD Somerset.docx` | 41,803 | **41,803** | 41,803 | `0c8ab7a17d569d1b` |
| `LINE ITEM PRICING SHEET…xlsx` | 12,937 | **12,937** | 12,937 | `62734fd29fa3335a` |
| `EXHIBIT C — Past Performance Questionnaire.docx` | 6,050 | **6,050** | 6,050 | `8b03e79ba4bc5b57` |
| `VAAR 852.219-75.docx` | 3,100 | **3,100** | 3,100 | `c6b0bd32ffb9e99a` |
| `EXHIBIT B — Sample Transmittal Letter.docx` | 1,388 | **1,388** | 1,388 | `f3e066a76f73de7c` |
| **TOTAL** | **255,564** | **255,564** | **227,081** | — |

- **Reconstruction: 7/7 exact, shortfall 0.** Every document's paged assembly
  equals its full available length. This is the claim "all seven documents
  reconstructed exactly", and it holds.
- **Byte-comparison: 227,081 / 255,564 = 88.9%, shortfall 28,483.**

**The 28,483 missing characters are not missing from the data.** They are
`148,483 − 120,000` on the single document that exceeds `MAX_WINDOW_CHARS`
(120,000). Its text WAS reconstructed in full; what is bounded is the
*independent verification method*, not the retrieval.

**What the denominator represents:** total stored/extracted characters across
the notice's seven documents (`sum(char_count)`), i.e. the text Mindy holds —
**not** the text in the original files. Two ceilings sit above it and are out of
scope for this figure: PDF/DOCX extraction fidelity, and
`MAX_EXTRACTED_TEXT_CHARS` (1,000,000).

**Why the byte check is bounded at all:** it compares the paged assembly against
a *single unpaged read*, and a single response is capped at `MAX_WINDOW_CHARS`.
For any document above that cap, the comparison covers the first 120,000
characters — which still spans the first paging boundary, the place a tiling
defect (overlap or dropped character) would appear. The acceptance script prints
the bound it achieved rather than implying totality.

⚠️ **Note the two are 100% and 88.9% of the SAME denominator.** Quoting either
without its metric is how "exactly" and "88.9%" came to look contradictory.

---

## 2. Incident — unscoped production DELETE (self-inflicted)

**Correcting the record:** earlier statements in this work said "no production
writes". That was wrong. A production DELETE executed.

| | |
|---|---|
| **What** | `DELETE FROM mcp_external_cache WHERE api_type = 'solicitation_docs'` |
| **Where** | `scripts/acceptance/va-solicitation-acceptance.mts` (and an ad-hoc probe) |
| **Window** | Present in committed code from `c50bbe73` to `8f80c627`, 2026-09-22 |
| **Executions** | At least 3 (acceptance runs + one probe). Exact count not recoverable. |
| **Scope** | All rows of ONE `api_type`, across every notice — not just the notice under test |
| **Rows affected** | **NOT RECOVERABLE.** No pre-delete count was taken and the table keeps no tombstones or audit log. |
| **Credentials** | `SUPABASE_SERVICE_ROLE_KEY` |

**Assessed impact.** `mcp_external_cache` is a pure response cache.
`external-cache.ts` states a tool "MUST still work without the cache" and
degrades to upstream fetches on any miss. Deleted rows self-heal on next access;
the cost was redundant upstream calls (SAM/CALC/EDGAR/Federal Register), not
data loss. Post-state confirms containment: `solicitation_docs` = 1 row, while
`calc:pricing` (798), `edgar:*` (33), `fedreg:documents` (20),
`fpds_competition_depth` (35) and `recompete:task-orders` (114) were untouched —
92,781 rows total.

**Remaining uncertainty (stated, not resolved):**
1. Exact number of deleted rows is unknown and unknowable from here.
2. Whether any deleted entry was expensive to rebuild (a `fetchPricingIntel`
   entry can represent 20–180 upstream CALC calls) — but `calc:pricing` was not
   in the deleted `api_type`, so this is bounded to `solicitation_docs`.
3. No recovery writes have been attempted, by instruction and by judgment: the
   cache is self-healing, and writing to "restore" it would be a second
   unrequested production write.

**Fix — the capability is gone, not merely narrowed.** The acceptance script now
performs **no writes of any kind**: no `delete()`, no `createClient`. It sets
`MCP_EXTERNAL_CACHE=off` (new, `external-cache.ts`), which makes every cache read
miss and every write a no-op for that process — forcing the same cold path with
zero effect on stored data.

**The lesson worth keeping:** the script was *labelled* read-only acceptance and
was not. A scoped delete would have made the hazard smaller while leaving it a
production write inside a verification script; removing the write entirely is
what actually closes it.

---

## 3. Extraction-quality detectors are NOT proof of readability

`container_stub` and `unreadable_encoding` are **positive detections of known
failure shapes**. `extraction_quality: 'ok'` means *no known failure matched* —
it does not certify that text is readable or complete. A measured blind spot is
pinned in `src/lib/sam/extraction-quality.ts` and its unit test: documents
between ~50–60% symbol density with 5–10% ASCII letters clear both gates. It is
left open deliberately, because tightening re-opens the false positive that
would suppress a real Section K certifications page — the more expensive error.
