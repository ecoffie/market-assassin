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
import { getAwardIdByPiid } from '@/lib/bigquery/awards';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ piid: string }>;
}

export default async function ContractByPiid({ params }: PageProps) {
  const { piid } = await params;
  if (!piid) notFound();

  const match = await getAwardIdByPiid(decodeURIComponent(piid));
  if (!match) notFound();

  // 308 permanent redirect (Next.js default for redirect()) preserves
  // method + signals Google that this is a stable canonical move.
  redirect(`/awards/${encodeURIComponent(match.award_id)}`);
}
