# Keyword Derivation — DSBS-grounded test report

_Ground truth = the vocabulary of real top-value winning awards per NAICS (live USASpending) — Eric's "copy successful firms' keywords" method, made measurable._

## Headline metrics

**Sample:** 5 cases across 1 industries (2-word → full-sentence phrasings).

| Metric | Score | What it means |
|---|---|---|
| **Defining term present** | **100%** | Our keywords contain the industry's defining word (e.g. "welding"). Binary, trustworthy — the keyword-quality gate. |
| **Lead NAICS correct** | **0%** | The profile's #1 NAICS is the expected trade code. The 236220-over-238220 class of bug. |
| Keyword recall (directional) | 0% | Share of our keyword words found in raw award text. NOISY — award text is project-verb-heavy; a right keyword can be absent. Trend only. |

> **Read the two bold rows.** "Defining term present" and "Lead NAICS correct" are the real signals. Keyword recall is directional (award descriptions are noisy).

## ⚠️ Wrong lead NAICS (5)

| Industry | Phrasing | Got | Expected |
|---|---|---|---|
| nurse-staffing | nurse staffing | — | 561320 / 621399 / 622110 |
| nurse-staffing | medical staffing | — | 561320 / 621399 / 622110 |
| nurse-staffing | registered nurse staffing | — | 561320 / 621399 / 622110 |
| nurse-staffing | nurse staffing for VA hospitals | — | 561320 / 621399 / 622110 |
| nurse-staffing | we supply registered nurses and medical staf | — | 561320 / 621399 / 622110 |

## Full results

### nurse-staffing

| Phrasing | Lead | ok | Defining | Recall | Keywords |
|---|---|---|---|---|---|
| nurse staffing | — | ✗ | ✓ | 0% |  |
| medical staffing | — | ✗ | ✓ | 0% |  |
| registered nurse staffing | — | ✗ | ✓ | 0% |  |
| nurse staffing for VA hospitals | — | ✗ | ✓ | 0% |  |
| we supply registered nurses and medical staffing t | — | ✗ | ✓ | 0% |  |

