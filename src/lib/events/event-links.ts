/**
 * Links and place on one event, taken from notice or calendar text.
 * registration_url is the register link when one is stated, otherwise the official source.
 * When those differ, the official source (and a separate virtual-meeting link) is kept in
 * contact_info as `source_url=` / `virtual_url=` lines. The column already exists and no reader
 * treats it as prose.
 */
import { cleanEventLocation, extractLocation } from './location';

const HTTP_URL = /https?:\/\/[^\s<>"')\]]+/gi;
const VIRTUAL_HOST = /(teams\.microsoft\.com|teams\.live\.com|zoom\.us|zoomgov\.com|webex\.com|meet\.google\.com|gotowebinar\.com|global\.gotowebinar\.com)/i;
const REGISTER_CUE = /\b(register|registration|rsvp|sign[\s-]?up)\b/i;

export interface CapturedLinks {
  registrationUrl: string | null;
  virtualUrl: string | null;
  location: string | null;
  sourceUrl: string | null;
}

function cleanUrl(raw: string): string | null {
  const url = raw.replace(/&amp;/g, '&').replace(/[.,;]+$/, '');
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function samNoticeSourceUrl(noticeId: string, uiLink: string | null | undefined): string | null {
  if (uiLink && /^https:\/\//i.test(uiLink)) return uiLink;
  if (/^[0-9a-f]{32}$/i.test(noticeId)) return `https://sam.gov/opp/${noticeId}/view`;
  return null;
}

export function extractCapturedLinks(text: string, sourceUrl: string | null): CapturedLinks {
  const source = sourceUrl && /^https:\/\//i.test(sourceUrl) ? sourceUrl : null;
  const urls: { url: string; index: number }[] = [];
  const re = new RegExp(HTTP_URL.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const url = cleanUrl(match[0]);
    if (url) urls.push({ url, index: match.index });
  }
  const virtual = urls.find((u) => VIRTUAL_HOST.test(u.url))?.url ?? null;
  let registration: string | null = null;
  for (const u of urls) {
    const before = text.slice(Math.max(0, u.index - 80), u.index);
    if (!REGISTER_CUE.test(before)) continue;
    if (u.url !== virtual) {
      registration = u.url;
      break;
    }
    if (!registration) registration = u.url;
  }
  const place = cleanEventLocation(extractLocation(text));
  const location = place || (virtual ? 'Virtual' : null);
  return { registrationUrl: registration, virtualUrl: virtual, location, sourceUrl: source };
}

export function linkColumns(links: CapturedLinks): { registration_url: string | null; contact_info: string | null } {
  const source = links.sourceUrl;
  const registration = links.registrationUrl;
  const virtual = links.virtualUrl && links.virtualUrl !== registration ? links.virtualUrl : null;
  const lines: string[] = [];
  if (source && source !== registration) lines.push(`source_url=${source}`);
  if (virtual) lines.push(`virtual_url=${virtual}`);
  return {
    registration_url: registration || source,
    contact_info: lines.length ? lines.join('\n') : null,
  };
}
