# D-002 root cause (before patch)

## Reproduction
- Host: `https://market-assassin-dqsk2w920-eric-coffies-projects.vercel.app` (dpl_4d2R6Kre)
- Auth: minted MI session `eric@govcongiants.com` (TWO_FACTOR_SECRET / ADMIN_PASSWORD)
- Route: `POST /api/app/market-research`
- Payload: valid public intake (Vandenberg SABER / FA4610 / NAICS 236220 / `public_data_only_confirmed: true`)
- Response: **HTTP 500** `{ success:false, error:"Unable to start market research." }`

## Call chain
1. `parsePublicMrrIntake` — succeeds (normalize OK locally with same payload)
2. `createOrGetMrrJobAsync` → no KV dedup hit → `createOrGetMrrJob`
3. `createOrGetMrrJob` → `persistJob` → `mkdirSync(jobDir)` under **`process.cwd()/out/mrr-workspace/<runId>`**
4. Exception caught by route → generic 500 (no exception body to client)

## Exact exception class (local proof of same code path)
With a read-only store root, `createOrGetMrrJob` throws:

```
EACCES: permission denied, mkdir '<storeRoot>/<runId>'
code: EACCES
syscall: mkdir
```

On Vercel serverless the deployment FS is read-only at `cwd` → same failure mode as **EROFS/EACCES** on `mkdir` for `out/mrr-workspace`.

## Why CLI works and API does not
- `scripts/mrr-run.mts` runs on a writable workstation disk under `out/…`
- Hosted API uses the same `persistJob` path, which **requires local persistent disk before the job is accepted**
- KV mirror exists (`run-store-remote.ts`) but is **best-effort after** disk write (`void mirrorMrrJob`) — never reached if mkdir throws
- `createOrGetMrrJobAsync` does not await durable KV create for new jobs

## Dependency verdict
**YES — start path depends on local persistent disk (`cwd/out/mrr-workspace`).**
That is not durable across Vercel instances and is not writable on the feature deployment.

## Required fix direction (Phase 2)
- Accept job via **in-memory + awaited Vercel KV** (already present for reopen)
- Use **ephemeral** writable dir (`/tmp/mrr-workspace` on `VERCEL`) only for Phase 1 assembly on the same invocation
- Do **not** treat `/tmp` as reopen durability — review/job metadata must live in KV
