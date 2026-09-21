# SAM.gov Contract Awards API — Investigation Notes (2026-05-22)

**Trigger:** Eric — "i think we should try the new sam api from gsa"
**Status:** Blocked on API key enrollment.

## What we learned about the API

It's a real, well-spec'd API with **massive** advantages over USASpending for our specific problems:

### Endpoint

- **Production:** `https://api.sam.gov/contract-awards/v1/search`
- **Alpha (sandbox):** `https://api-alpha.sam.gov/contract-awards/v1/search`
- HTTP GET; auth via `?api_key=...` query param
- JSON sync (up to 100 records/page, ~400K records max via paging) or CSV/JSON extract (up to 1M records, async-delivered)

### Killer parameters for our SAT mix problem

| Parameter | Why it matters |
|---|---|
| `dollarsObligated=[0,250000]` | **Directly filter by SAT threshold.** No more "USASpending doesn't have this field." |
| `typeOfSetAsideName` / `typeOfSetAsideCode` | Filter by SBA, BUY INDIAN, 8(a), WOSB, SDVOSB, HUBZone — real set-aside data |
| `coBusSizeDeterminationName=SMALL BUSINESS` | Direct small-business filter |
| `socioEconomicData.smallBusiness=Y` (returned per record) | Award-level socioeconomic flag |
| `deletedStatus=yes` | **Surface deleted/withdrawn contracts — the moat HigherGov doesn't have** |

### Killer parameters for our top-N leaderboards

| Parameter | Notes |
|---|---|
| `naicsCode=513310~513311` | Up to 100 comma/tilde-separated codes |
| `productOrServiceCode` | PSC filter, up to 100 codes |
| `contractingDepartmentCode=9700` (DoD example) | Filter by buying agency |
| `awardOrIDV=IDV` or `Award` | Separate IDVs from individual orders |

### Rate limits (better than USASpending)

| Account type | Daily limit |
|---|---|
| Personal API key (non-federal, no role) | 10/day ⚠️ |
| Personal (with role) | 1,000/day |
| Federal user | 1,000/day |
| **System user (federal)** | **10,000/day** |

USASpending is essentially uncapped per-IP per-day but rate-limits by request frequency (~1 req/sec). The SAM API trades request-rate flexibility for a hard daily ceiling.

## What blocked us today

Our `SAM_API_KEY` returns **HTTP 400 with empty body** on every Contract Awards API request — including the simplest possible query. The 400 comes from the Istio Envoy gateway BEFORE reaching the application, which is the signature of an auth/scope/role issue.

This matches what `CLAUDE.md` already documented in the "SAM.gov API Integration" section:

> | API | Status |
> |---|---|
> | Contract Awards | ✅ Working **via USASpending MCP** |
> | Subaward | ⏳ Waiting (Needs System Account) |

And the env var note:

```
SAM_API_KEY=xxx                    # Opportunities (existing)
SAM_CONTRACT_AWARDS_API_KEY=xxx    # Needs System Account
```

So our existing `SAM_API_KEY` is scoped for SAM Opportunities only. To unlock the Contract Awards API, we need either:

1. **Apply for a SAM.gov System Account** — get a `SAM_CONTRACT_AWARDS_API_KEY` with the Contract Awards role. This was on the roadmap since at least April per the CLAUDE.md note; never completed.
2. **Add the "Contract Awards" role to the existing key** — if it's possible to add roles to an existing personal/system key without re-applying. Worth checking in the SAM.gov workspace UI.

### What the System Account enrollment requires

Federal users get system accounts automatically. Non-federal businesses need to:
1. Have an active SAM.gov entity registration (we presumably have this since `SAM_API_KEY` works)
2. Request a system account via the SAM.gov workspace → "API Keys" → "System Account"
3. Provide a justification (e.g., "Daily federal opportunity monitoring for our SaaS product")
4. Wait for approval (CLAUDE.md note says we never finished this — probably abandoned the request)

## Smoke test commands used (for future reference)

```bash
KEY=$(grep -E "^SAM_API_KEY=" .env.local | head -1 | cut -d'=' -f2 | tr -d '"' | tr -d "'" | tr -d ' ')

# Simplest possible query → HTTP 400 (gateway reject, no body)
curl -sS -D - "https://api.sam.gov/contract-awards/v1/search?api_key=${KEY}&limit=1"

# With NAICS + date range → still HTTP 400
curl -sS -D - "https://api.sam.gov/contract-awards/v1/search?api_key=${KEY}&naicsCode=236220&lastModifiedDate=%5B01/01/2025,12/31/2025%5D&limit=1"

# Alpha sandbox endpoint → same 400
curl -sS -D - "https://api-alpha.sam.gov/contract-awards/v1/search?api_key=${KEY}&limit=1"
```

The empty body + `x-envoy-upstream-service-time: 0` is the diagnostic — request never reached application logic; rejected at the API gateway based on key scope.

## Recommendation

Two-track approach:

### Track 1 (today, no blocker)

**Ship the USASpending-based satSpending fix** (Task #234, deferred when we pivoted). The Set-Aside Mix donut needs SAT data; we already have the pipeline; it just needs the SAT-threshold filter wired into `/api/usaspending/find-agencies`. Time: ~30-60 min.

Eric's NAICS 236/237 profile would get a populated donut TODAY.

### Track 2 (this week, behind-the-scenes)

**Apply for the SAM.gov System Account.** Without it, the Contract Awards API is dead-letter for us.

1. Go to https://sam.gov → log in → Workspace → API Keys
2. Look for "System Account" or "Add Role" options
3. If the existing key can have Contract Awards role added: easy path
4. If full re-application needed: submit it, document the URL for tracking
5. Once approved → migrate the highest-value surfaces:
   - Contractor sales-history page (richer data + deleted contracts)
   - SAT mix calculation (direct $250K filter — way better than USASpending workaround)
   - Set-aside breakdowns by NAICS

Don't block product work waiting for SAM enrollment. The USASpending workaround we have is fine for the immediate user complaints; SAM is the long-term upgrade path.

## What I'd write if I shipped the SAM integration today

For documentation purposes — when the System Account lands, here's the rough shape:

```typescript
// src/lib/sam/contract-awards-v2.ts
const BASE = 'https://api.sam.gov/contract-awards/v1';

export async function searchContractAwards(opts: {
  naicsCodes: string[];
  fiscalYear?: number;
  dollarsObligatedMax?: number;  // for SAT filter
  typeOfSetAside?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams({
    api_key: process.env.SAM_CONTRACT_AWARDS_API_KEY!,
    naicsCode: opts.naicsCodes.join('~'),
    limit: String(opts.limit || 100),
    offset: String(opts.offset || 0),
  });
  if (opts.fiscalYear) params.set('fiscalYear', String(opts.fiscalYear));
  if (opts.dollarsObligatedMax !== undefined) {
    params.set('dollarsObligated', `[0,${opts.dollarsObligatedMax}]`);
  }
  if (opts.typeOfSetAside) params.set('typeOfSetAsideName', opts.typeOfSetAside);

  const res = await fetch(`${BASE}/search?${params.toString()}`);
  if (!res.ok) throw new Error(`SAM Contract Awards HTTP ${res.status}`);
  return res.json();
}

// SAT mix calculation becomes one call:
//   searchContractAwards({ naicsCodes: ['236220'], dollarsObligatedMax: 250000 })
//   → total_records + sum(dollarsObligated) = SAT spend in that NAICS
```

Compared to USASpending which needs no auth, this is straightforward when the key works.

## Files touched (in flight, not committed)

None — all investigation was via curl. No code shipped today for SAM API.

## What's captured for the next session

- `docs/sam-contract-awards-transition.md` — original transition spec
- `docs/sam-contract-awards-api-investigation-2026-05-22.md` — this doc
- `tasks/TODO-migrate-to-sam-contract-awards-api.md` — full migration plan when key unblocks
- Task #236 in progress — close it when System Account is applied for
