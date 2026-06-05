/**
 * Returns the DoDAAC code→name directory as a flat map, for client-side panels
 * (Alerts/Recompetes/Pipeline) that decode offices in the browser. Cached hard
 * (the directory changes slowly); fetched once per session by the client hook.
 */
import { NextResponse } from 'next/server';
import { loadDodaacNames } from '@/lib/gov-contacts/dodaac-directory';

export const dynamic = 'force-dynamic';

export async function GET() {
  const map = await loadDodaacNames();
  // Plain object for JSON; ~4.8K entries, small.
  const names: Record<string, string> = {};
  for (const [k, v] of map) names[k] = v;
  return NextResponse.json(
    { success: true, names, count: Object.keys(names).length },
    { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } },
  );
}
