# Codex review brief — SAM attachment fetch fallback (2026-06-03)

## Context
Pursuits in `user_pipeline` auto-fetch their SAM.gov attachments into
`pursuit_documents` (rendered in the pipeline drawer + fed to Proposal Assist).
Fetcher: `src/lib/sam/fetch-pursuit-docs.ts`. Dispatcher (SAM vs grants.gov):
`src/lib/grants/fetch-grant-docs.ts` (`fetchPursuitDocsAuto`).

## The bug this commit fixes
A pursuit ("Laboratory Renovation", solicitation `1232SA26Q0454`) showed
"no attachments" in the drawer, but sam.gov shows **12 public attachments**.

Root cause, proven live via an admin trace (`/api/admin/heal-pursuit-attachments?sam_trace=`):
- The pursuit's stored `notice_id` is `2839942d9e5b41359bdf3aebc420eb46` — a
  **wrong/stale UUID**. SAM's real noticeId is `5b6ea90470e143b4bc86e31a942a6c0c`.
- `GET /opportunities/v2/search?noticeid=<UUID>` → **HTTP 200, totalRecords:0**
  (SAM's search index simply does not return this notice by that UUID).
- `GET /opportunities/v2/search?solnum=1232SA26Q0454` → **totalRecords:1**,
  title "Laboratory Renovation", **resourceLinks:12**, and the correct noticeId.
- `?title=Laboratory Renovation` also returns it.

So SAM's `noticeid` exact-match is incomplete; `solnum` and `title` recover the
notice (and the correct UUID).

## The fix (commit on `main`)
`discoverFiles(noticeId, apiKey, {solicitationNumber, title})` now probes in
order, stopping at the first hit:
1. `noticeid` (when id is a 32-hex UUID)
2. `solnum` (the solicitation number, or the id itself if it isn't a UUID)
3. `title` (last resort — always available on the pursuit; SAM `title` is fuzzy)

On a hit it returns `resolvedUuid` (SAM's `opp.noticeId`); the caller heals
`user_pipeline.notice_id` to it. `solicitationNumber` + `title` are threaded
from all 4 call sites (pipeline POST, add-to-pipeline GET+POST, pursuit-docs
retry, heal endpoint).

## Questions for Codex
1. Is probing `noticeid → solnum → title` the right order, or is there a
   cleaner SAM endpoint that returns a notice's resourceLinks by UUID directly
   (e.g. a notice-detail / resources endpoint) that avoids the search-index gap?
2. `title` search is fuzzy — the code accepts the first `opportunitiesData[0]`.
   Risk of matching the WRONG notice when two pursuits share a generic title
   ("236220 - COMMERCIAL... CONSTRUCTION"). Should we add a guard (match the
   resolved solicitationNumber/agency before accepting a title hit)?
3. Any concern with healing `notice_id` to SAM's resolved UUID mid-fetch
   (a stale/wrong UUID being silently rewritten)?

## Files
- `src/lib/sam/fetch-pursuit-docs.ts` — `discoverFiles` + `fetchPursuitDocs`
- `src/lib/grants/fetch-grant-docs.ts` — `fetchPursuitDocsAuto`
- call sites: `src/app/api/pipeline/route.ts`, `src/app/api/actions/add-to-pipeline/route.ts`,
  `src/app/api/app/proposal/pursuit-docs/route.ts`, `src/app/api/admin/heal-pursuit-attachments/route.ts`

---

## Follow-up (2026-06-11) — Display names in Market Dashboard / Alerts

**Separate bug:** Even when attachments were fetched for pursuits, opportunity *detail*
views in `/app/market-intel` and Daily Alerts showed "Document 1 / Document 2" because
SAM download URLs are bare `/download` paths with no filename segment.

**Fix:**
- `src/lib/sam/attachment-metadata.ts` — shared parse + HEAD for Content-Disposition
- `GET /api/sam-attachment/metadata?url=` — returns `{ filename }`
- `src/components/app/SamAttachmentLinks.tsx` — lazy client-side resolve
- `sync-sam-opportunities` — do not overwrite `attachments` when list API returns empty
- `backfill-sam-attachments` — uses shared lib; `?retry-names=1` refreshes stale "Document N" rows

**Files:** `AlertsPanel.tsx`, `market-intel/page.tsx`, `DashboardPanel.tsx`
