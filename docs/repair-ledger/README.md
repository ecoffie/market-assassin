# Repair ledger entries (one file per fix)

New ledger entries go here, **one file per PR**, so two PRs never edit the same lines and ledger rows
stop conflicting. `docs/REPAIR-LEDGER.md` is the frozen archive of every earlier row; both are read
together by the audits (`scripts/lib/ledger-sources.mjs`).

- **Name:** `<YYYY-MM-DD>-<pr-or-slug>.md`, e.g. `2026-11-22-pr-2290.md` or `2026-11-22-map-legend.md`.
- **Content:** the same table as the archive: header, separator, one row (more if the PR has several
  fixes). Each row needs a **proof anchor**: `` `<exact string>` `` → `` `<repo-relative path>` ``.
  Use `` `ABSENT: <text>` `` to assert something removed stays removed.
- **Audit:** `npm run ledger:audit` (fails on a vanished anchor, an unresolvable path, a bad file name or
  an entry with no anchor). The pre-push gate runs it.
- **Combined view:** `npm run ledger:render` prints entries (newest first) followed by the archive.
  Its output is not committed.

Template:

```markdown
| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-11-22 | Area | What changed and why | `exact string` → `src/path/file.ts` | how it was proven | PR |
```
