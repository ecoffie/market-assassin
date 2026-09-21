/**
 * Diagnostic: peek at sample sam_opportunities.raw_data shapes so we
 * can see which fields SAM actually populates vs. which only come
 * from per-opportunity detail fetches. Used once to decide whether
 * the backfill can extract from raw_data alone or needs SAM API calls.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('sam_opportunities')
    .select('notice_id, title, raw_data')
    .not('raw_data', 'is', null)
    .limit(3);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // For each sample, list the top-level keys present in raw_data and
  // a few summary stats on the interesting array fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const summary = (data || []).map((row: any) => {
    const raw = row.raw_data || {};
    const keys = Object.keys(raw);
    return {
      notice_id: row.notice_id,
      title: row.title?.slice(0, 60),
      keys_present: keys,
      resourceLinks: {
        present: 'resourceLinks' in raw,
        type: Array.isArray(raw.resourceLinks) ? 'array' : typeof raw.resourceLinks,
        length: Array.isArray(raw.resourceLinks) ? raw.resourceLinks.length : null,
        sample: Array.isArray(raw.resourceLinks) ? raw.resourceLinks[0] : null,
      },
      pointOfContact: {
        present: 'pointOfContact' in raw,
        type: Array.isArray(raw.pointOfContact) ? 'array' : typeof raw.pointOfContact,
        length: Array.isArray(raw.pointOfContact) ? raw.pointOfContact.length : null,
        sample: Array.isArray(raw.pointOfContact) ? raw.pointOfContact[0] : null,
      },
      officeAddress: raw.officeAddress ?? null,
      fairOpportunity: raw.fairOpportunity ?? null,
      additionalInfoLink: raw.additionalInfoLink ?? null,
      // The crux: is raw_data.description a LINK (needs a 2nd fetch) or inline TEXT?
      description: {
        value: typeof raw.description === 'string' ? raw.description.slice(0, 120) : raw.description ?? null,
        isLink: typeof raw.description === 'string' && raw.description.startsWith('http'),
        length: typeof raw.description === 'string' ? raw.description.length : null,
      },
    };
  });

  return NextResponse.json({ samples: summary });
}
