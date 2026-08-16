/**
 * Refresh the shared PSC catalog in KV.
 *
 * The catalog is the ONE source both the recommender and the validator read
 * (lib/codes/psc-catalog-live.ts). Without a scheduled refresh it would only
 * warm on a cold cache, so a new PSC could stay invisible to Settings for a
 * day while the recommender — which reads live spending — already surfaced it.
 * That gap is exactly the contradiction this whole change removes.
 *
 * Weekly is right: the PSC manual changes a few times a year. Register it by
 * INSERTing a cron_jobs row AFTER this route is live on prod (never a
 * vercel.json cron — the 100-cron cap blocks the whole deploy).
 */
import { NextRequest, NextResponse } from 'next/server';
import { refreshPscCatalog } from '@/lib/codes/psc-catalog-live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await refreshPscCatalog();
  // A failed refresh is NOT fatal — the shipped floor still answers every
  // lookup. Report it honestly rather than 500ing a non-critical warm-up.
  if (!result.ok) {
    console.error(`[refresh-psc-catalog] ${result.error}`);
    return NextResponse.json({ ...result, note: 'shipped catalog still serving' }, { status: 200 });
  }
  return NextResponse.json({ ...result });
}
