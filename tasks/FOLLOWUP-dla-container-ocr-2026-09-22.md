# Follow-up: DLA package completeness — container unpacking + OCR

**Split out of** the shared SAM document-access repair (branch `feat/mcp-doc-paging`)
so that PR stays narrow. **Nothing here is claimed as fixed.** The shared PR
detects and DISCLOSES these conditions; it does not resolve them.

**Status:** open. **Do not claim DLA package completeness until this closes.**

---

## Why it is separate

The shared repair is source-agnostic: reuse the app's attachment discovery,
remove destructive cache truncation, provide bounded continuation, disclose
extraction limits. It is accepted against **VA `36C24226Q0857`**, where every
attachment extracts to usable text.

DLA `SPE60525R0222` needs two additional capabilities — a PDF Portfolio unpacker
and an OCR path. Both are new subsystems with their own dependencies and failure
modes. Shipping them inside the shared repair would widen the blast radius of a
fix that is otherwise pure text-plumbing.

**What the shared PR already does for DLA:** all 14 attachments are discovered
and downloadable, 2,380,326 characters are retrievable, and the four unusable
extractions self-report instead of claiming `complete`. That is honest partial
coverage, not completeness.

---

## Preserved findings (measured 2026-09-22, notice `d441cf3c3ee048548057c9fd52499db9`)

### 1. PDF Portfolio containers — content never reached

| Attachment | Bytes on disk | Pages | Extracted | Text |
|---|---|---|---|---|
| Attachment C - DLA Energy CQAP.pdf | 1,796,570 | 1 | **128** | "For the best experience, open this PDF portfolio in Acrobat X or Adobe Reader X, or later." |
| Attachment D - DLA Energy EQAP.pdf | 1,796,570 | 1 | **128** | same |

The Quality Assurance Provisions — which the solicitation makes **mandatory at
paragraph 20** — are files nested inside the container. `pdf-parse` reads only
the cover sheet.

**Now flagged** as `text_availability: 'container_stub'` and counted as
unavailable. **Not** recovered.

**To fix:** unpack embedded files from the PDF `/Names /EmbeddedFiles` tree and
extract each as a child document. Needs a per-document parent/child identity so
nested files get their own `document_id`.

### 2. Font-subset PDFs — extracted characters are not the document's words

| Attachment | Bytes | Pages | Extracted | Readable ratio |
|---|---|---|---|---|
| Updated Amendment 0003.pdf | 118,488 | 2 | 3,884 | **0.35** |
| Amendment 0001.pdf | — | 2 | 4,435 | **0.37** |

Genuine prose measures 0.98–1.00. These PDFs embed subset fonts with no usable
`ToUnicode` map, so the glyphs extract as control/private-use codepoints.

⚠️ **Amendment 0003 is the most recent amendment in the package.** Its content
is unknown, which means the current terms of this solicitation are not fully
established from our extraction.

**Now flagged** as `text_availability: 'unreadable_encoding'` with
`text_readable_ratio`. **Not** recovered.

**To fix:** rasterize + OCR when `readableRatio` is below `MIN_READABLE_RATIO`.
Needs an OCR dependency and a cost/latency budget (these are cold-path calls).

### 3. `extract_statement_of_work` returned `found:false, grounded:false`

On a solicitation that contains a full statement of work. Re-test **after** the
shared repair — the SOW body may simply have been past the old 20k window. If it
still misses, the heading-boundary detector needs DLA-format work. **Untested
here; do not assume either way.**

---

## Fixtures to reuse

| Purpose | Value |
|---|---|
| DLA notice id | `d441cf3c3ee048548057c9fd52499db9` (absent from `sam_opportunities` — exercises the pure cold path) |
| Solicitation number | `SPE60525R0222` |
| Portfolio container | file id `bca776a1556c4d26a2a9d237589b6bdf` (Attachment C) |
| Font-subset PDF | file id `99f946a3da0c4c2cb7e241d526773de2` (Updated Amendment 0003) |
| Large schedule | file id `0d7abdca7f674a58bfbd9431e6248afc` (274pp → 573,558 chars) |
| Detectors already shipped | `src/lib/sam/extraction-quality.ts` (+ unit tests) |

---

## Acceptance for THIS follow-up (not met today)

1. Attachments C and D yield the nested QAP documents, each with its own
   `document_id`, and no longer report `container_stub`.
2. Amendments 0001 and 0003 return readable text (ratio > 0.6) via OCR, and
   Amendment 0003's actual terms are established.
3. `extract_statement_of_work` returns `grounded: true` for this notice.
4. A DLA acceptance script mirroring `VA` proves all 14 attachments reach
   `complete`.

Until all four pass, DLA coverage is **partial and disclosed**, not complete.
