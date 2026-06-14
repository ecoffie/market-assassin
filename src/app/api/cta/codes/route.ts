/**
 * GET /api/cta/codes — list DoD Critical Technology Areas for filter UI.
 * Public read; falls back to in-code definitions if DB migration not run yet.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CTA_DEFINITIONS } from '@/lib/cta/definitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from('cta_codes')
      .select('cta_id, name, short_name, description, priority_order')
      .order('priority_order', { ascending: true });

    if (!error && data?.length) {
      return NextResponse.json({
        success: true,
        source: 'database',
        ctas: data,
      });
    }
  }

  return NextResponse.json({
    success: true,
    source: 'static',
    ctas: CTA_DEFINITIONS.map((c) => ({
      cta_id: c.cta_id,
      name: c.name,
      short_name: c.short_name,
      description: c.description,
      priority_order: c.priority_order,
    })),
  });
}
