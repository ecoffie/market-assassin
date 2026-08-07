/**
 * Admin: the Mindy Institute Research Library — the publications pipeline.
 *
 * Lists every publication (the honest forthcoming pipeline; nothing fabricated as published), each
 * resolving its cited OBS-### metrics to their live standard (name + maturity + confidence) so the
 * library shows the dependency honestly + a data-readiness signal per publication. Public /research
 * inherits this later.
 *
 * READ-ONLY — pure registry reads, no DB.
 */
import { NextRequest, NextResponse } from 'next/server';
import { publicationsForDisplay, resolveCitations, publishReadiness } from '@/lib/analytics/research-publications';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const publications = publicationsForDisplay().map((pub) => ({
    ...pub,
    // resolve each cited OBS id to just what the UI needs (id + name + maturity + confidence)
    cited: resolveCitations(pub).map(({ id, standard }) => ({
      id,
      name: standard?.name ?? null,
      maturity: standard?.lifecycle ?? null,
      confidence: standard?.confidence ?? null,
    })),
    readiness: publishReadiness(pub),
  }));
  return NextResponse.json({
    ok: true,
    publications,
    note: 'The Mindy Institute Research Library — publications cite Observatory metrics by their permanent OBS-### id and inherit their maturity. HONEST: nothing is listed as published that isn\'t; the pipeline is the real forthcoming work, seeded as planned. A publication is only as credible as its least-mature cited metric.',
  });
}
