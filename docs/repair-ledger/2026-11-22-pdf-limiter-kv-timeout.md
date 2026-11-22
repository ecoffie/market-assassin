| Date | Area | Fix | Proof anchor | Verified | Status |
|---|---|---|---|---|---|
| 2026-11-22 | Market report PDF / rate limit | A KV call that hangs is now treated like one that throws. After 1.5 s the PDF route's limiter switches to its in-process caps instead of holding the request until maxDuration (Agent 4 note on #2307). | `export const KV_TIMEOUT_MS = 1500;` → `src/lib/pdf/render-rate-limit.ts` | `render-rate-limit.unit.test.ts`: a KV that never settles falls back within the timeout and the fallback cap is still enforced; the default timeout is ≤ 2 s; earlier cases unchanged. | PR |
