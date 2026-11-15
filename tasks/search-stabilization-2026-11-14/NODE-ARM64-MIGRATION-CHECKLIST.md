# Native arm64 Node 24 migration — checklist for every agent (draft by Agent 3, 2026-11-14)

**Why:** the Mac Studio (Apple M4 Max) runs Intel Node builds under Rosetta (`~/local/nodejs` = v22.14 x64, the default via
`~/.zshrc`; nvm v24.13.0 is also x64). The repo requires `engines.node: 24.x`. Under Rosetta the pre-push unit step crashed
in 2 of 4 runs ("rosetta error: target for 19-bit branch is out-of-range") and pglite setup exceeded 10 s. On native arm64
the full unit suite passed in 51 s (11,995 tests) with no crash.

**Rule:** the machine default does NOT change until every active agent has completed steps 1–4 and confirmed.

## Steps (per worktree; take the heavy-test lock for step 3)

1. Use the installed native Node for this shell only:
   `export PATH="$HOME/local/node-v24.13.0-darwin-arm64/bin:$PATH"`
   Check: `node -p 'process.arch+" "+process.version'` → `arm64 v24.13.0`.
   (Installed from the official tarball; SHA-256 verified against nodejs.org SHASUMS256.txt.)
2. Reinstall dependencies in THIS worktree (native binaries: esbuild, rollup, sharp…):
   `rm -rf node_modules && npm ci --no-audit --no-fund`
   Never symlink `node_modules` from another checkout (the pre-push gate refuses it; see the npm-ci memory note).
   Check: `ls node_modules/@esbuild/` shows `darwin-arm64`.
3. Lock, run, release:
   `until mkdir /tmp/mindy-heavy-tests.lock 2>/dev/null; do sleep 30; done; echo "<agent> <session> $(date -u +%FT%TZ) test:unit" > /tmp/mindy-heavy-tests.lock/owner; npm run test:unit; rm -f /tmp/mindy-heavy-tests.lock/owner; rmdir /tmp/mindy-heavy-tests.lock`
   (Release only a lock you created; a lock older than 30 min is stale.)
4. Push normally (the pre-push gate inherits the shell PATH). Never `--no-verify`.
5. Reply to Agent 5 with: worktree path, `node -p process.arch`, `npm run test:unit` totals, gate result.

## Switching the default (only after all confirmations)

- Change `~/.zshrc` line `export PATH="$HOME/local/nodejs/bin:$PATH"` to the arm64 directory (or move `~/local/nodejs` aside
  and symlink it to the arm64 install). Keep the x64 directory for rollback.
- Any worktree still holding Intel `node_modules` must `npm ci` again before its next run.
- Rollback: restore the line; Intel worktrees keep working.

## Confirmations

| Agent | Worktree(s) | arm64 `npm ci` | `test:unit` | gate |
|---|---|---|---|---|
| Agent 3 | `.claude/worktrees/agent3-search` | done | 11,995 passed | passed (2 pushes) |
| Agent 4 | | | | |
| Agent 5 | | | | |
| Agent 1 / 2 / others | | | | |
