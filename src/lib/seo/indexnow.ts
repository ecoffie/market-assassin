/**
 * IndexNow — instant ping to Bing/Yandex/Seznam (and read by Google) when pages
 * publish, instead of waiting for a crawl (Phase 5 indexation engineering).
 *
 * The key is PUBLIC by design (it's verified via a key file at the domain root),
 * so a default is fine; override with INDEXNOW_KEY env if desired. The matching
 * key file is served at /<key>.txt by src/app/[indexnowKey]/route handling
 * (see src/app/indexnow-key.txt convention — here via a dedicated route).
 */
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '12c75f97be500168ec347e0ed4d74808';
const HOST = (process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai').replace(/^https?:\/\//, '');
const SITE_URL = `https://${HOST}`;

/**
 * Submit up to 10,000 URLs to IndexNow in one call. Returns the HTTP status.
 * Best-effort: never throws (SEO pings must not break callers).
 */
export async function submitToIndexNow(urls: string[]): Promise<{ ok: boolean; status: number; submitted: number }> {
  const list = urls.filter(Boolean).slice(0, 10000);
  if (!list.length) return { ok: false, status: 0, submitted: 0 };
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: list,
      }),
    });
    return { ok: res.ok, status: res.status, submitted: list.length };
  } catch {
    return { ok: false, status: 0, submitted: 0 };
  }
}
