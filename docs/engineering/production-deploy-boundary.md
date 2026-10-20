# The production deploy boundary

> **The guard in `scripts/guard-prod-deploy.mjs` is a seatbelt, not a locked door.**
> It removes the accident. It does not remove the capability.

## What the guard does and does not cover

`npm run deploy` runs the guard, the check suite, the guard again, then `vercel --prod`.
Every one of these **bypasses it completely**:

```bash
vercel --prod                 # what actually happened on 2026-09-21
vercel deploy --prod
vercel promote <deployment>   # changes what production serves, builds nothing
vercel alias set <url> getmindy.ai
```

They are the same binary with the same credentials, invoked without the wrapper. Nothing
in this repository can intercept them: a script only runs if something runs it. The
2026-09-21 incident was recorded by Vercel as `source: cli`, `actor: cursor-cli` — an
agent invoking the CLI directly, exactly the path the wrapper cannot see.

A local shell shim (aliasing `vercel` to a function that calls the guard first) is
**advisory only** and deliberately not shipped here. It is defeated by a different shell,
a non-interactive process, `command vercel`, an absolute path, or any agent that spawns
the binary. Shipping it would buy the *appearance* of a boundary, and a boundary people
believe in but which does not hold is worse than a known gap.

## The real control is a credential/permission change

**Nothing below has been applied.** These need an account/team change and are Eric's call.

### Option 1 — make Git the only production path (recommended)

Production deploys already happen automatically from the GitHub integration on merge to
`main`; the `1262c59e` build that now serves production was exactly that. The CLI path is
redundant for shipping and exists mainly for emergencies.

1. In **Project → Settings → Git**, confirm Production Branch is `main`.
2. Remove any `VERCEL_TOKEN` / `~/.vercel` credential from developer and agent machines, so
   a local `vercel --prod` cannot authenticate at all.
3. Keep a deploy token in CI only.

The enforcement then lives with the **credential**, which no script can route around.
Cost: an emergency CLI deploy requires deliberately fetching a token — which is the point.

### Option 2 — team role restriction

Vercel team roles can separate "can view/preview" from "can deploy to production". Give
day-to-day and agent identities a role without production rights for `market-assassin`;
reserve production for an owner identity or CI. Narrower than Option 1 and keeps CLI
previews working.

### Option 3 — deployment protection as a backstop

Project → Settings → Deployment Protection. Does not stop a production deploy from being
*created*, so it is a complement to 1 or 2, not a substitute.

### What none of them cover

`vercel promote` and `vercel alias set` change **what production serves without building
anything**. Any control must be about *who holds production rights*, not about which
command they type. That is another reason the answer is permissions, not tooling.

## Recommendation

**Option 1, plus keeping the guard** for the case it genuinely covers: a human or agent
who *is* authorised, deploying from the wrong checkout. That is the accident that happened,
and the guard now refuses it before upload and again at upload time.

Until a control is adopted, the honest statement is: *production deploys are conventionally
gated, not enforced.* Do not describe the boundary as enforced in any runbook.

## Related

- `scripts/guard-prod-deploy.mjs` — the wrapper gate (`--final`, `--json`, `--self-test`)
- `src/lib/deploy/prod-deploy-guard.unit.test.ts` — regression tests
- `CLAUDE.md` → "⛔ A PRODUCTION deploy must come from `origin/main`"
- `.vercelignore` — records that the CLI uploads the working directory and does **not**
  honour `.gitignore`, which is why untracked files are treated as deployable
