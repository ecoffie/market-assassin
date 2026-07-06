/**
 * fetch-notice-resources — get a SAM notice's attachments the RELIABLE way.
 *
 * The old backfill used `GET /opportunities/v2/search?noticeId=X` to re-discover
 * resourceLinks, but that search endpoint returns NOTHING for most individual notices
 * (verified 2026-07-06: 16,976 active opps with attachments=NULL all failed the search
 * re-fetch, even with a valid prod key, both noticeId/noticeid casings). The notices ARE
 * reachable — just not via search-by-id.
 *
 * The endpoint that actually works per-notice is SAM's UI resources API (the same one the
 * sam.gov "Attachments/Links" tab calls):
 *   GET https://sam.gov/api/prod/opps/v3/opportunities/{noticeId}/resources
 *       ?api_key=<key>&excludeDeleted=false&withScanResult=false
 * → 200 { _embedded: { opportunityAttachmentList: [ { attachments: [ ... ] } ] } }
 *
 * Each attachment is one of two shapes (both seen live):
 *   - type "file": { name: "RFP.pdf", resourceId, mimeType, size } — a SAM-hosted file.
 *       Download URL = https://sam.gov/api/prod/opps/v3/opportunities/resources/files/{resourceId}/download
 *   - type "link": { uri: "https://www.dibbs.bsm.dla.mil/..." } — an external URL, no name.
 *
 * We normalize both into the { url, name?, fileId? } shape the DB + SamAttachmentLinks
 * UI already expect, so nothing downstream changes.
 */

const RESOURCES_URL = (noticeId: string) =>
  `https://sam.gov/api/prod/opps/v3/opportunities/${encodeURIComponent(noticeId)}/resources`;
const FILE_DOWNLOAD_PREFIX = 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/';

export interface NoticeAttachment {
  url: string;
  name?: string;
  fileId?: string | null;
}

/**
 * The result distinguishes the three real outcomes so callers can decide correctly:
 *   - { attachments: [...] }  → resolved, has N attachments (write them)
 *   - { attachments: [] }     → resolved, genuinely NONE (write the _no_attachments sentinel)
 *   - null                    → FETCH FAILED (SAM down / rate-limited) — do NOT stamp, retry later
 */
export async function fetchNoticeResources(
  noticeId: string,
  apiKey: string,
  timeoutMs = 30000,
): Promise<NoticeAttachment[] | null> {
  const url = `${RESOURCES_URL(noticeId)}?api_key=${encodeURIComponent(apiKey)}&excludeDeleted=false&withScanResult=false`;

  let res: Response;
  try {
    // NOTE: this SAM UI endpoint returns 406 "Not Acceptable" if you send
    // `Accept: application/json` — it wants `*/*` (curl's default, which is why curl
    // gets 200 but an explicit JSON Accept fails). Use */* and parse the JSON body.
    res = await fetch(url, { headers: { Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null; // network / timeout — retryable
  }
  // 429 (rate limit) / 5xx are retryable → null. A 404 means the notice has no resources
  // record → treat as "genuinely none" ([]). 200 → parse.
  if (res.status === 404) return [];
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try { body = await res.json(); } catch { return null; }

  const list: unknown[] = body?._embedded?.opportunityAttachmentList ?? [];
  const out: NoticeAttachment[] = [];
  for (const group of list) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atts: unknown[] = (group as any)?.attachments ?? [];
    for (const a of atts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const att = a as any;
      // Skip deleted / missing files (fileExists === "0").
      if (att.fileExists != null && String(att.fileExists) === '0') continue;

      if (att.type === 'file' || att.name) {
        // SAM-hosted file → build the canonical download URL from the resourceId.
        const resourceId: string | undefined = att.resourceId || att.attachmentId;
        if (!resourceId) continue;
        out.push({
          url: `${FILE_DOWNLOAD_PREFIX}${resourceId}/download`,
          name: att.name || undefined,
          fileId: resourceId,
        });
      } else if (att.type === 'link' && att.uri) {
        // External link (DIBBS, NECO, etc.) — the uri IS the destination; no file id.
        out.push({ url: String(att.uri), name: att.name || undefined, fileId: null });
      }
    }
  }
  return out;
}
