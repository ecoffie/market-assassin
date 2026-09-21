/**
 * Canonical opportunity identity for beginner A/B dedupe.
 *
 * search_sam_opportunities does not return notice_id. The live item has
 * `link` (SAM ui_link) and `solicitation`. The tool itself already dedupes
 * internally by solicitation_number || title|deadline — we need a key that
 * is stable across two independent searches.
 *
 * Preference: notice id embedded in the SAM workspace/opp URL, then
 * solicitation number. Title+deadline is NOT used: two searches can return
 * the same notice with slightly different titles and we'd fail to collapse
 * them, inflating the "hidden" count.
 */
import type { SamSearchItem } from './types';

const NOTICE_IN_LINK =
  /\/(?:opp|opportunity)\/([0-9a-f]{32})\b/i;

export function opportunityKey(item: SamSearchItem): string | null {
  const link = (item.link || '').trim();
  if (link) {
    const m = link.match(NOTICE_IN_LINK);
    if (m) return `notice:${m[1].toLowerCase()}`;
  }
  const solicitation = (item.solicitation || '').trim();
  if (solicitation) return `sol:${solicitation.toLowerCase()}`;
  // A SAM url without a 32-char notice id is still a stable identity when
  // solicitation is missing. Do not fall through to title — that inflates hidden.
  if (link) {
    try {
      const url = new URL(link);
      const path = url.pathname.replace(/\/+$/, '');
      if (path && path !== '/') return `link:${url.origin}${path}`;
    } catch {
      /* not a URL */
    }
  }
  return null;
}

export function keyedItems(items: readonly SamSearchItem[]): {
  keyed: Array<{ key: string; item: SamSearchItem }>;
  unkeyed: number;
} {
  const keyed: Array<{ key: string; item: SamSearchItem }> = [];
  let unkeyed = 0;
  for (const item of items) {
    const key = opportunityKey(item);
    if (!key) {
      unkeyed += 1;
      continue;
    }
    keyed.push({ key, item });
  }
  return { keyed, unkeyed };
}
