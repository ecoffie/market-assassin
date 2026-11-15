# Headless search runner for the holdout

Built for Agent 4's revised holdout protocol (2026-11-15). It runs the search code **as frozen at a tag** against a
snapshot of open SAM notices. For each phrasing it writes the matched set and the top 20.

The runner contains no ranking logic. Every decision is imported from the `--src` checkout, so each tag is judged by its
own code. It is research tooling only and is not wired into the app.

## Guarantees

- **Read-only.**
  - `run` and `verify` read local files only. During `run`, `fetch` is replaced by a function that throws, so any
    network attempt from imported code fails loudly instead of returning data.
  - `dump` issues SELECTs only.
- **Deterministic.**
  - Object keys are sorted recursively.
  - Matched ids are sorted.
  - The output contains no wall-clock timestamp.
  - `today` (the plan context) is taken from the cutoff date unless `--today` is given.
  - Two runs produce byte-identical output; the sha256 of the output is printed on stderr.
- **Tag identity.**
  - The output carries `src.commit`, `src.tags` and `src.dirty`.
  - A checkout with uncommitted tracked changes is refused unless `--allow-dirty` is passed.
- **Emulation.** The same procedure as `tasks/search-stabilization-2026-11-14/harness/eval.mts`, which produced the
  published matched sets:
  - **Matched set:** a notice matches on any of three paths: code recall (`openRetrievalNaics` / `openRetrievalPsc`),
    preset vocabulary (an exact phrase over `cap.direct.vocabCols`), or the discovery text matcher over `OPEN_TEXT_COLS`.
  - **Window:** the first 500 matched notices by `response_deadline`, ties broken by `notice_id`.
  - **Top 20:** the window is labelled with `labelOpenRow`, then sorted by tier, then breadth, then score, then window
    position. `demoteDuplicateVersions` is applied when the tag has it (RC3 onward).
- **Runtime:** native arm64 Node 24 (see the arm64 checklist).

## Commands

> **The runner file must sit inside a checkout that has `node_modules`** (this branch's worktree, or a copy placed inside the tag checkout). Run from a copy outside any checkout, `dump` cannot resolve `@supabase/supabase-js`. Agent 4 hit this during validation, 2026-11-15.

Run each command from inside the tag checkout, so that its `tsconfig.json` resolves the `@/…` imports:

```bash
export PATH="$HOME/local/node-v24.13.0-darwin-arm64/bin:$PATH"
git worktree add --detach /path/rc2 search-rc2-2026-11-14     # give it its own node_modules (npm ci, or an APFS clone)
cd /path/rc2

# 1. snapshot — read-only SELECT; needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Refuses an incomplete read.
npx tsx <runner>/runner.mts dump --cutoff 2026-12-12T00:00:00Z --out snapshot-2026-12-12.json

# 2. run — offline
npx tsx <runner>/runner.mts run --src . --snapshot snapshot-2026-12-12.json \
    --phrasings <runner>/fixtures/queries_v4.json --cutoff 2026-12-12T00:00:00Z --out rc2-2026-12-12.json

# 3. verify against a published matched-sets file (acceptance checks a + b)
npx tsx <runner>/runner.mts verify --result rc2.json \
    --expected tasks/search-stabilization-2026-11-14/matched-sets-rc2-classification.json --key rc2
```

### Cutoff

A notice counts as open at the cutoff when all of these hold:

- `active` is not false;
- `response_deadline` is after the cutoff;
- `posted_date` is at or before the cutoff;
- `created_at` is at or before the cutoff, when the snapshot has that column (`dump` includes it).

**Bound.** A cutoff can only remove rows. It cannot restore notices that later closed, or undo edits made after the
cutoff. The faithful Dec 12 input is therefore a `dump` taken on Dec 12. Applying a cutoff to an older snapshot is exact.
Applying it to a newer snapshot is approximate.

`--phrasings` accepts `queries_v4.json` (`{ biz: { q: [...] } }`) or a list of `{ business, phrasing, query }`.

## Output schema

```text
{
  runner:     { name, version, emulation },
  src:        { commit, tags[], dirty },
  snapshot:   { file, file_sha256, snapshot_at, cutoff, rows_in_file, rows_open_at_cutoff, open_ids_sha256 },
  context:    { today, fiscal_year, policy: "MCP_POLICY", text_cols[] },
  phrasings:  { file, file_sha256 },
  results: [{
    business, phrasing, query,
    interpretation: { kind, source, retrieval_naics[], retrieval_psc[] },
    matched_count, matched[]          // notice_ids, sorted
    window_count,                     // ≤ 500
    top20: [{ rank, notice_id, cls, tier, basis[] }]
  }]
}
```

## Fixture run (2026-11-15, snapshot `2026-11-15T00:52:58.895Z`, 9,701 open notices, 28 phrasings)

| tag | commit | (a) matched sets | (b) top 20 in order | (c) two runs | time |
|---|---|---|---|---|---|
| search-rc2-2026-11-14 | 065451a66 | 28/28 identical to `matched-sets-rc2-classification.json` (`rc2`) | 28/28 identical | byte-identical | ~10.5 s |
| search-rc1-2026-11-14 | 8c4ba2ea1 | 28/28 identical (`rc1`) | 28/28 identical | — | ~10.5 s |

Cutoff check: the same Nov 14 file at cutoff `2026-12-12T00:00:00Z` keeps 1,020 notices (only those with deadlines after Dec 12).
