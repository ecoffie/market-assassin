Prove everything the latest ship touched is actually working in production. Optional focus: $ARGUMENTS

**"It compiles" ≠ "it works." A 200 with 0 rows is a FAIL, not a pass.** Never report success from a green build.

## 1. Work out what to check

Read the diff that shipped (`git log --oneline -5`, `git diff HEAD~1 --name-only`, or the PR). Map changed files → live surfaces:

| changed | verify |
|---|---|
| `src/app/**/page.tsx` / `route.ts` | that URL returns 200 with real content |
| `src/app/api/**` | that endpoint returns rows, not just 200 |
| `supabase/migrations/*` | the table/column actually exists |
| `src/mcp/tools/*` / `tool-registry.ts` | the tool answers through the hosted MCP |
| a cron | there's an enabled `cron_jobs` row |
| env-dependent code | the var is in production |

If `$ARGUMENTS` names a surface, check that instead of inferring.

## 2. Run the checks

```bash
npm run verify:live -- /route /api/route            # status + rows + timing, exits 1 on fail
npm run verify:live -- /page --expect-text "..." --no-rows
npm run db:check -- <table> <column>                # migration really landed
npm run db -- cron_jobs --select job_name,cron_expr,enabled --eq enabled=true
vercel env ls production | grep -i <VAR>
```

Prefer these over hand-rolled curl — they encode the rows rule and return a real exit code.

## 3. Rules

- **Wait for READY first.** Never verify against the old build. Poll the live URL for the new behaviour (a route that 404s before and 200s after is the cleanest signal) rather than parsing `vercel ls` — its ANSI codes break `grep -oE`.
- **Beware the cache.** `cached: true` proves nothing about new compute. Note it, and find a path that forces a fresh result (a new cache key, an uncacheable route, `refresh: true` for staff on TMR).
- **A pre-existing failure is not your failure.** If something's broken, check whether it's broken on `main` too before blaming the ship — then say which.

## 4. Report

A table: surface → evidence → pass/fail. Lead with anything that failed. State plainly what you could NOT verify and why (auth-gated, cache-served, no fresh path) — an unverified surface is unverified, not passed.
