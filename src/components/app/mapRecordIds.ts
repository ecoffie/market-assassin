/**
 * Pick the SAM notice_id out of whatever an app row carries, for an "Open on the map" link.
 *
 * The map's `?opp=` is a RECORD address keyed on `sam_opportunities.notice_id` (32 hex). Several
 * app rows carry a solicitation number in a field called `noticeId` (briefing deadlines do), and a
 * solicitation number is NOT that record's id: one sol# can name several notices. So this accepts
 * only a value that IS a notice id, or a SAM link that contains one, and returns null otherwise.
 * Callers then render no map link rather than a link to the wrong record.
 */
import { normalizeNoticeUuid } from '@/lib/sam/notice-identity';

const SAM_OPP_URL = /sam\.gov\/(?:workspace\/contract\/)?opp\/([a-f0-9-]{32,36})(?:[/?#]|$)/i;

export function samNoticeIdFrom(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const v = c.trim();
    if (!v) continue;
    const direct = normalizeNoticeUuid(v);
    if (direct) return direct;
    const m = v.match(SAM_OPP_URL);
    if (m) {
      const fromUrl = normalizeNoticeUuid(m[1]);
      if (fromUrl) return fromUrl;
    }
  }
  return null;
}
