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
import { redirect, notFound } from 'next/navigation';

// EMERGENCY STOP (2026-06-01): the per-PIID lookup below was full-table
// scanning the 63M-row awards table on every bot crawl (piid is not in the
// awards cluster key). ~55K crawls/day × ~830 MB = ~46 TiB/day — 2.3× the
// 20 TiB daily BQ quota — blowing the quota by ~1 AM PT and 500-ing the whole
// site. Until the piid_lookup table (Option A) is built, do NOT call BQ here:
// bounce every /contracts/* to /awards with no scan.
//
// 307 (temporary) on purpose — this is a stopgap, not the permanent mapping.
// Restore the 308-to-/awards/[award_id] resolution once piid_lookup ships.
//
//   import { permanentRedirect } from 'next/navigation';
//   import { getAwardIdByPiid } from '@/lib/bigquery/awards';
//   const match = await getAwardIdByPiid(decodeURIComponent(piid));
//   if (!match) notFound();
//   permanentRedirect(`/awards/${encodeURIComponent(match.award_id)}`);

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ piid: string }>;
}

export default async function ContractByPiid({ params }: PageProps) {
  const { piid } = await params;
  if (!piid) notFound();

  redirect('/awards');
}
