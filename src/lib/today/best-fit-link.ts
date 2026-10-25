/**
 * Where the "⭐ Best fit for you" card's CTA goes — decided in ONE pure function.
 *
 * THE BUG (customer report, 2026-10-25): "View opportunity" on the Best Fit card opened a
 * list of 604 matches instead of the opportunity on the card. The card held the correct
 * notice_id and then discarded it — every non-Sources-Sought click called
 * `onPanelChange('alerts')`, i.e. the profile-wide Source Feed ("604 matches found").
 *
 * The rule (docs/engineering/record-links-vs-market-links.md): a record CTA carries the
 * record's id and NOTHING that can exclude it. The map's typed address for one SAM notice is
 * `/opportunity-map?opp=<notice_id>` — the same contract Share, Favorites, /today and the
 * daily alert (#1441) use. With `opp` alone the map's scope-params IIFE early-returns and the
 * return-continuity restorer stands down, so no other writer can replace the record.
 *
 * Sources Sought keeps its existing workflow (draft a response in Proposal Assist, with the
 * notice context) — unchanged by this fix.
 */

/** A canonical SAM notice id — the only id shape `?opp=` resolves via opportunity-detail. */
const SAM_NOTICE_ID = /^[a-f0-9]{32}$/i;

export interface BestFitCardInput {
  noticeId: string | null | undefined;
  title: string;
  agency: string | null;
  isSourcesSought: boolean;
}

export type BestFitAction =
  /** Existing Sources Sought workflow: open Proposal Assist framed on THIS notice. */
  | { kind: 'sources_sought'; panel: 'proposals'; context: { noticeId: string; title: string; agency: string | null; isSourcesSought: true } }
  /** Open exactly this opportunity on the map. */
  | { kind: 'record'; href: string; noticeId: string }
  /** No resolvable id (e.g. the demo card's 'demo-collab'): fall back to the feed, honestly labeled. */
  | { kind: 'feed'; panel: 'alerts' };

/** `/opportunity-map?opp=<id>` for a canonical SAM notice id, otherwise null. Never adds market params. */
export function bestFitViewHref(noticeId: string | null | undefined): string | null {
  const id = typeof noticeId === 'string' ? noticeId.trim() : '';
  if (!SAM_NOTICE_ID.test(id)) return null;
  return `/opportunity-map?opp=${encodeURIComponent(id)}`;
}

export function bestFitAction(hot: BestFitCardInput): BestFitAction {
  if (hot.isSourcesSought) {
    return {
      kind: 'sources_sought',
      panel: 'proposals',
      context: { noticeId: String(hot.noticeId ?? ''), title: hot.title, agency: hot.agency, isSourcesSought: true },
    };
  }
  const href = bestFitViewHref(hot.noticeId);
  if (href) return { kind: 'record', href, noticeId: String(hot.noticeId).trim() };
  return { kind: 'feed', panel: 'alerts' };
}
