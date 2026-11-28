# Claude + Mindy MCP baseline benchmark for Ask Mindy (design, not built)

Status: DESIGN ONLY (2026-11-28). No code until after Mindy Day. Owner: Agent 1. Review: Agent 4.

## Why

Eric, 2026-11-27: "anything about Claude MCP should be a baseline benchmark", then: "we don't have to copy but we can
learn from them." The answer Claude gives using the Mindy MCP connector is the **reference** Ask Mindy is measured
against: its content, structure, dates, sourcing, outreach style and how it uses attached files. The reference is not a
target to match word for word. It is a fact floor and a source of techniques worth adopting.

Ask Mindy and Claude + MCP read the same data (the public MCP catalog). So a fact the baseline found that Ask Mindy
missed is a real gap, not a difference of opinion. The release gates are built on that point.

## What exists today (reuse, do not rebuild)

- `.claude/skills/verify-ask-mindy/SKILL.md`: drives prompts through the real `/api/app/chat` route on a preview with a
  signed-in TEST account. It has the Launch → Doctor → Drive → Evidence → Cleanup flow and the before/after rule.
- `scripts/ask-mindy-baseline.mts`: runner, `--regrade`, `--compare ... --md`.
- `src/lib/chat/eval/grade.ts`: grades an answer against its tool evidence.
- `tests/fixtures/ask-mindy-regression.json`: scenarios R1–R10.
- `src/lib/ask-mindy/figure-grounding.ts`: deterministic dollar and date tracing (`ungroundedFiguresInText`).

The benchmark adds a **baseline column**, new **dimensions** and a **report**. It reuses the runner, the evidence
capture and the grader.

## 1. Prompt set (fixed, versioned)

`tests/fixtures/claude-mcp-baseline/prompts.json`. Each entry has an id, the prompt, attachments (synthetic files only),
the surface (`app` / `map`), the mode (`research` / `standard`) and the dimensions that apply.

| id | Prompt (shape) | Notes |
|---|---|---|
| B1 | Market report for a company, capability statement attached | Upload path, claims-by-audience, How They Buy Now heading |
| B2 | Events near a place for a buyer | Confirmed events only |
| B3 | Event action plan | ACTION_PLAN_STRUCTURE, contacts with their notice date |
| B4 | Where is the least competition for X | COMPETITION_AND_START_PLAYBOOK |
| B5 | Capability statement from a UEI or file | Document shape, file claims stated as written |
| B6 | The SDVOSB question near a named base | FY-aware statutory goal (#2556), set-aside language |
| B7 | Outreach email to a named office | OUTREACH rules 0–6 |
| H1–H15 | The help questions in `src/lib/ask-mindy/help-answers.ts` | Short, sourced, no invented figures |

Every attachment is a **synthetic** file (made-up company, made-up figures) committed under
`tests/fixtures/claude-mcp-baseline/files/`. The repository is public: never a customer's file.

## 2. Baseline column (operator-run)

- An operator (not an agent) runs each prompt in Claude with the Mindy MCP connector on a TEST account, with the same
  synthetic files. The operator saves the transcript as `tests/fixtures/claude-mcp-baseline/baseline/<id>.json`:
  - the answer text;
  - the tool calls with arguments;
  - the tool results, trimmed;
  - the Claude model and connector version;
  - the date run.
- Rule for a stored transcript: no customer data and no personal emails of private individuals; public federal
  records only. Contacts from public SAM notices are kept as the tool returned them.
- The baseline is refreshed only when the prompt set changes or the MCP catalog changes materially. Each refresh is its
  own PR, reviewed like code.

## 3. Ask Mindy column

`scripts/ask-mindy-baseline.mts --set claude-mcp-baseline`. This is a new flag; the runner is unchanged otherwise. It
runs the same prompts on the preview with the same files, in both `research` and `standard` where the surface offers
both. It saves the answer, the trace evidence, any `create_document` model and the notices, as today.

## 4. Grading

Each dimension is graded per prompt as `better` / `same` / `worse` against the baseline, with the evidence quoted.

### HARD gates (any `worse` blocks release)

| Dimension | How it is checked |
|---|---|
| **Wrong or invented facts** | Deterministic first: every dollar figure and date in Ask Mindy's answer must trace to its own tool evidence or an attached file (`ungroundedFiguresInText`). Then a grader model, separate from the answering model, checks named entities (offices, people, contract numbers, vehicles) against the evidence. |
| **Facts the baseline found that Ask Mindy misses** | A fact list is extracted from the baseline answer and kept only where the baseline's own tool results support it. Each fact is looked for in Ask Mindy's answer: present, paraphrased or missing. Missing a decision-critical fact (an open notice, an incumbent, an end date, a named contracting officer, an eligibility gate) is `worse`. A fact the baseline stated **without** tool support is never held against Ask Mindy; it is logged as a baseline error. |
| **Dates policy** | Deterministic: no data-freshness dates (`as of`, `retrieved`, `data through`…), using the same patterns as `no-data-date-instructions.unit.test.ts`. Contacts name their source record and that record's own date (#2569). Work dates (deadlines, end dates) are present where the baseline has them. |
| **Sourcing / attribution** | Every named contact carries a `[n]` in documents. File claims follow the audience rule (#2569): as written in a document for the company, attributed in third-party content. SAM wins a status conflict. File-only eligibility is not pitched. "Not established" is used only where neither the tools nor the file show the fact. |

### SOFT signals (reported, never blocking)

| Signal | Examples |
|---|---|
| Structure | How They Buy Now section present and in order, ranked moves first, action-plan order |
| Tone and length | Plain language, no em dashes, outreach under 150 words, length versus the baseline |
| Approach | Which tools were called, how many, and in what order (efficiency, not correctness) |

## 5. Report (each run)

`tasks/ask-mindy-vs-claude-mcp-<YYYY-MM-DD>.md`, committed with the PR whose release it gates:

1. Header: the Ask Mindy commit and preview URL, the baseline set version, the flags in effect.
2. Gate table: prompt × hard dimension, showing `better` / `same` / `worse` with a one-line reason and the evidence
   pointer.
3. Soft table: the same shape, for the soft signals.
4. **Learnings**: concrete techniques from the baseline worth trying (e.g. "it put each contact's newest notice and
   date in the why-column"). Each gets a proposed owner and next step, and becomes a separate PR if adopted.
5. **Where Ask Mindy is better**: so a change does not regress our own strengths.
6. Baseline errors found (unsupported baseline claims), so they are never copied.

The report holds only synthetic company data and public federal records, the same rule as the fixtures.

## 6. Release bar

For any PR that changes Ask Mindy answers (prompts, rules, tools offered, grounding, document generation):

- run the benchmark on the PR's preview;
- any HARD `worse` blocks release until it is fixed or Eric explicitly accepts it in writing on the PR;
- SOFT differences are reported in the PR, not blocking;
- the existing verify-ask-mindy R1–R10 before/after rule still applies alongside.

## 7. Build plan (after Mindy Day)

1. Fixtures: the prompt set and synthetic files (B1–B7, H1–H15). One PR.
2. Runner `--set` flag and attachment upload in the runner (uses `/api/app/chat/documents` on the test session). One PR.
3. Deterministic graders: figures, dates and attribution patterns, reusing the existing helpers. One PR with unit tests
   that use fixed answer pairs.
4. Grader-model rubric for facts present or missing and invented entities, with a fixed rubric and a model other than
   the answering model, following `src/lib/ask-mindy/evaluator.ts`. One PR.
5. Report writer plus the `--compare-baseline` exit code. One PR.
6. First operator baseline run and the first report.

## Open questions for Agent 4 / Eric

- Who runs the baseline transcripts (Eric, or a named operator), and how often?
- Should `standard` mode be benchmarked at all, or only `research` (the default for everyone after Mindy Day)?
- Is a `worse` on "facts missed" acceptable when Ask Mindy's answer is shorter by design (e.g. the help answers)?
  The proposal is to judge help answers on their own short contract, not on fact-count parity.
