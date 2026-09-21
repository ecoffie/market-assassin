/**
 * /contracts/[piid] — vanity URL that matches how searchers actually
 * type federal contract numbers (e.g. "n0018925fz703"). GSC week-2
 * data showed contract-number queries hitting Mindy with no matching
 * URL, so the searcher landed on the recipient's contractor profile
 * page instead of the actual award.
 *
 * This route looks up the canonical award_id for the PIID and
 * permanent-redirects (301) to /awards/[award_id]. Google passes
 * link equity through 301 and treats the /awards URL as canonical.
 *
 * Case-insensitive: lowercase URLs are common in organic search
 * traffic. We uppercase before BQ lookup since USASpending stores
 * PIID in uppercase.
 *
 * Dynamic — never prerender. Cache hits the BQ-side queryCached
 * layer (7-day TTL on the PIID→award_id mapping).
 */
import { permanentRedirect, redirect, notFound } from 'next/navigation';
import { getAwardIdByPiid } from '@/lib/bigquery/awards';

// Resolution restored 2026-06-01 after the piid_lookup table (build-derived.sql)
// replaced the full-table scan that drained the BQ quota. getAwardIdByPiid now
// reads a clustered-by-piid_upper table (~MB/lookup), validates+normalizes the
// PIID before BQ, and negatively caches misses — so this route is safe to crawl.
//
// ISR instead of force-dynamic: cache each resolved redirect at the edge for
// 30 days. generateStaticParams returns [] so nothing prerenders at build
// (63M+ PIIDs can't be enumerated); pages render on first hit, then cache.
export const revalidate = 2592000; // 30d
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ piid: string }>;
}

export default async function ContractByPiid({ params }: PageProps) {
  const { piid } = await params;
  if (!piid) notFound();

  const match = await getAwardIdByPiid(decodeURIComponent(piid));

  // Unknown PIID: don't 404 (kills the page for a plausibly-real contract
  // number) and don't dead-end. Send to /awards. 307 (temporary) so Google
  // doesn't permanently bind a bad alias — a later ingest may add the PIID.
  if (!match) redirect('/awards');

  // 308 permanent redirect for a resolved PIID: this URL is a permanent alias
  // for /awards/[award_id], and 308 passes link equity through cleanly.
  permanentRedirect(`/awards/${encodeURIComponent(match.award_id)}`);
}
