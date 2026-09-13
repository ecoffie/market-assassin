# Record links identify records. Market links identify markets.

**Frozen 2026-09-12 (Eric), after the daily-alert "View opportunity" incident.**

> **Record links identify records. Market links identify markets. Profile filters belong on
> market links, never on record links.**
> — Eric

A direct consequence of a real customer incident. This is a **link-design invariant**, and it
belongs beside the filter/measurement rules because it fails the same way they do: nothing
throws, nothing 500s, and the page renders — it just renders the wrong thing, a second late.

---

## The two link classes

| | **Record link** | **Market link** |
|---|---|---|
| Answers | "show me THIS thing" | "show me this KIND of thing" |
| Addressed by | the record's own id | a scope (naics / agency / state / …) |
| Examples | `?opp=<notice_id>` · `?recompete=<contract_id>` · `?company=<uei>` · `?buyer=<id>` · `?forecast=<id>` | `?naics=` · `?agency=` · `?subAgency=` · `?state=` · `?ss=<saved_search_id>` · `?mode=` |
| A filter that excludes the target is | **a bug — it deletes the destination** | fine, that is the feature |
| Profile facts about the READER | **never** | appropriate |

**The test:** if the user clicked a link that names ONE thing, every parameter on that URL must
be able to *find* that thing. A parameter that can exclude it does not "scope" the link — it
**destroys** it.

## The incident this came from

The daily alert's "View opportunity" CTA (`api/cron/daily-alerts/route.ts` `mapUrl()`) emitted
market filters instead of the opportunity's identity:

```
/opportunity-map?naics=<code>&subAgency=<sub_tier>&state=<RECIPIENT's profile state>
```

…while `trackUrl()`, eight lines above it in the same file, already set `notice_id`. The CTA
that says "View opportunity" could not name an opportunity. Two halves, both measured on prod:

1. **Temporal.** The map's scope-params deep-link IIFE (`opportunity-map/route.ts` ~8141) parses
   those params and applies them through `__applySavedSearch` inside a 40×150ms retry loop. Boot's
   own `setTimeout(fetchView,300)` painted broad results **first**; the filters landed ~1–2s later
   and emptied the map. Same bbox on prod: **5,416 → 0**. The customer saw results, then
   "No opportunities match" — which is why the final URL alone could not explain it.
2. **Data.** `state` was the **recipient's** profile state — a fact about the reader, not the
   opportunity. It filters `pop_state`, populated on only **4,047 of 10,993** open rows (36.8%,
   the documented SAM sparsity), while the opportunity was chosen for that email by NAICS/agency
   and need never carry one. **571 of 2,078** live NAICS × sub-agency scopes (**27.5%**) go to
   EXACTLY 0 under any state filter.

**The fix was not to make the race less likely.** Switching to `?opp=<notice_id>` removes the
wrong writer from this link class entirely: with no scope param present the IIFE early-returns
("nothing asked for"), so there is no delayed writer left to race. Fixed in PR #1441; guarded by
`src/app/api/cron/daily-alerts/alert-opp-deeplink.unit.test.ts`.

## Rules that fall out

1. **A record link carries the record's id and nothing that can exclude it.** Prefer the id
   alone. Context is allowed only when it is *derived from the record itself* and cannot
   contradict it.
2. **Never put a profile fact on a record link.** The reader's state / NAICS / set-aside describe
   the reader. The record was already selected for them upstream; re-filtering by the reader at
   the destination can only remove it.
3. **Reuse the existing typed address — do not invent a second path.** `?opp=` was already the
   contract for Share, the Favorites page and `/today`. The email was the one surface ignoring it.
   One path, so the surfaces cannot drift.
4. **A sparse column is a deletion risk, not a narrowing.** Filtering on a field most rows lack
   (`pop_state`: 36.8%) removes the majority by default. Measure fill rate before filtering.
5. **"It renders, then it doesn't" means a late writer.** Diagnose from a *state timeline*, never
   the final URL — a two-stage failure looks identical to a data bug at T+5s.

## Where else this applies

Any surface emitting a per-record link: alert + briefing emails, Share buttons, Favorites,
`/today` Featured cards, watchlist CTAs, push/SMS. `grantsMapUrl()` deliberately **keeps** the
profile state — it is a market link by design and correctly belongs in the right-hand column.

## See also
- `docs/engineering/silent-failure-registry.md` — the same family: a successful-looking answer
  that was never the thing it claims to represent
- `src/app/opportunity-map/opp-deeplink.unit.test.ts` — the map side of the `?opp=` contract
- `CLAUDE.md` → "PERSIST vs QUERY" — the sibling rule about broad-vs-exact taxonomy handling
