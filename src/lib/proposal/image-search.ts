/**
 * Image search for the proposal editor — ONLY images that are free to use in a commercial proposal.
 *
 * Two keyless sources:
 *  - Wikimedia Commons (public domain, CC0, CC BY, CC BY-SA): includes most U.S. government photos.
 *  - Openverse (WordPress.org's open-license index: Flickr, museums, government collections), asked
 *    for `license_type=commercial` so non-commercial licenses never come back.
 *
 * Every result carries its creator, license and a credit line, which the editor puts in the caption.
 * A result whose license we can't read as commercial-safe is dropped, never shown as "free".
 */

export type ImageSource = 'wikimedia' | 'openverse';

export interface ImageResult {
  id: string;
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  creator: string;
  license: string;
  licenseUrl: string;
  source: ImageSource;
  sourceLabel: string;
  publicDomain: boolean;
  credit: string;
  width?: number;
  height?: number;
}

const COMMERCIAL_SAFE = /^(public domain|pd|cc0|cc[- ]?by(?:[- ]?sa)?(?:[- ]?\d(\.\d)?)?(?:[- ]?[a-z]{2,})?|no restrictions)\b/i;
const NON_COMMERCIAL = /\b(nc|nd|non[- ]?commercial|no[- ]?deriv)/i;

export function isCommercialSafeLicense(license: string): boolean {
  const l = license.trim();
  if (!l || NON_COMMERCIAL.test(l)) return false;
  return COMMERCIAL_SAFE.test(l) || /public domain|pdm|cc0/i.test(l);
}

export function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

export function creditLine(creator: string, license: string, sourceLabel: string): string {
  const who = creator && !/^unknown/i.test(creator) ? creator : sourceLabel;
  return `Photo: ${who} (${license})`;
}

const cleanTitle = (t: string) => stripHtml(t).replace(/^File:/i, '').replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '').replace(/_/g, ' ').trim();

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseWikimedia(json: any): ImageResult[] {
  const pages: any[] = Object.values(json?.query?.pages || {});
  pages.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
  const out: ImageResult[] = [];
  for (const p of pages) {
    const ii = p?.imageinfo?.[0];
    if (!ii?.url || !/^image\/(jpeg|png|gif|webp)$/i.test(ii.mime || '')) continue;
    const meta = ii.extmetadata || {};
    const license = stripHtml(meta.LicenseShortName?.value || '');
    if (!isCommercialSafeLicense(license)) continue;
    const creator = stripHtml(meta.Artist?.value || '').slice(0, 120);
    const sourceLabel = 'Wikimedia Commons';
    out.push({
      id: `wm-${p.pageid}`,
      title: cleanTitle(meta.ObjectName?.value || p.title || ''),
      thumbUrl: ii.thumburl || ii.url,
      imageUrl: ii.thumburl && ii.thumbwidth >= 1000 ? ii.thumburl : (ii.responsiveUrls?.['2'] || ii.thumburl || ii.url),
      pageUrl: ii.descriptionurl || '',
      creator,
      license,
      licenseUrl: stripHtml(meta.LicenseUrl?.value || ''),
      source: 'wikimedia',
      sourceLabel,
      publicDomain: /public domain|cc0|pd/i.test(license),
      credit: creditLine(creator, license, sourceLabel),
      width: ii.width,
      height: ii.height,
    });
  }
  return out;
}

export function parseOpenverse(json: any): ImageResult[] {
  const out: ImageResult[] = [];
  for (const r of (json?.results || []) as any[]) {
    if (!r?.id || !r?.url) continue;
    const code = String(r.license || '').toLowerCase();
    const license = code === 'pdm' ? 'Public domain' : code === 'cc0' ? 'CC0' : `CC ${code.toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''}`;
    if (!isCommercialSafeLicense(license)) continue;
    const creator = stripHtml(r.creator || '').slice(0, 120);
    const provider = stripHtml(r.source || r.provider || 'Openverse');
    const sourceLabel = provider ? `${provider.charAt(0).toUpperCase()}${provider.slice(1)} via Openverse` : 'Openverse';
    out.push({
      id: `ov-${r.id}`,
      title: cleanTitle(r.title || ''),
      thumbUrl: r.thumbnail || `https://api.openverse.org/v1/images/${r.id}/thumb/`,
      // The original can sit on any host; the export proxy only fetches known image hosts, so fall
      // back to Openverse's own copy when the original's host is not one of them.
      imageUrl: isProxyableImageUrl(r.url) ? r.url : (r.thumbnail || `https://api.openverse.org/v1/images/${r.id}/thumb/`),
      pageUrl: r.foreign_landing_url || '',
      creator,
      license,
      licenseUrl: r.license_url || '',
      source: 'openverse',
      sourceLabel,
      publicDomain: code === 'pdm' || code === 'cc0',
      credit: creditLine(creator, license, sourceLabel),
      width: r.width || undefined,
      height: r.height || undefined,
    });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function wikimediaUrl(q: string, limit = 12): string {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6',
    gsrsearch: `${q} filetype:bitmap`, gsrlimit: String(limit), prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size', iiurlwidth: '1200',
    iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName|LicenseUrl',
  });
  return `https://commons.wikimedia.org/w/api.php?${p.toString()}`;
}

export function openverseUrl(q: string, limit = 12): string {
  const p = new URLSearchParams({ q, license_type: 'commercial', page_size: String(limit), mature: 'false' });
  return `https://api.openverse.org/v1/images/?${p.toString()}`;
}

/** Hosts the editor's image proxy may fetch from (the search sources' image servers only). */
export const IMAGE_PROXY_HOSTS = [
  'upload.wikimedia.org',
  'api.openverse.org',
  'live.staticflickr.com',
  'farm1.staticflickr.com', 'farm2.staticflickr.com', 'farm3.staticflickr.com', 'farm4.staticflickr.com',
  'farm5.staticflickr.com', 'farm6.staticflickr.com', 'farm7.staticflickr.com', 'farm8.staticflickr.com',
  'farm9.staticflickr.com', 'farm66.staticflickr.com',
  'images-assets.nasa.gov',
  'd34w7g4gy10iej.cloudfront.net',
];

export function isProxyableImageUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return IMAGE_PROXY_HOSTS.includes(u.hostname.toLowerCase());
}

/** Interleave two ranked lists, dropping duplicate image URLs. */
export function mergeResults(a: ImageResult[], b: ImageResult[], limit = 16): ImageResult[] {
  const out: ImageResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && (i < a.length || i < b.length); i++) {
    for (const r of [a[i], b[i]]) {
      if (r && !seen.has(r.imageUrl) && out.length < limit) { seen.add(r.imageUrl); out.push(r); }
    }
  }
  return out;
}
