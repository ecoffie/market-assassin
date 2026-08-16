/**
 * POST /api/gov/apex-intro — an APEX counselor introduces a public buying organization.
 *
 * The NAPEX conversion. NOT a signup: the counselor is not becoming a user, and the
 * buying organization has not agreed to anything yet. This records a warm
 * introduction so a human can follow up with the COUNSELOR first.
 *
 * FOUNDING 50 IS THE BUYERS, NOT APEX (Eric, 2026-08-16). The 50 are cities,
 * counties, transit and districts; APEX opens the door to their procurement
 * leadership. That is why this captures the buyer's org and type as first-class
 * fields, and why nothing here provisions an account.
 *
 * Stored in `leads` with source=napex2026 (or gov-apex) so conference attribution
 * survives into follow-up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase/client';
import { sendOpsAlert } from '@/lib/ops-alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGENCY_TYPES = ['Federal', 'State', 'County', 'City', 'School District', 'Higher Education', 'Transit', 'Utility', 'Other'];

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  const str = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
  const name = str(body.name, 120);
  const org = str(body.org, 160);
  const email = str(body.email, 160).toLowerCase();
  const buyer = str(body.buyer, 200);

  // Only the four fields a follow-up genuinely needs. Everything else is optional —
  // a conference form that rejects a submission for a missing dropdown loses the lead.
  if (!name || !org || !email || !buyer) {
    return NextResponse.json({ success: false, error: 'Name, APEX, email and buying organization are required' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ success: false, error: 'That email does not look right' }, { status: 400 });
  }

  const agencyType = AGENCY_TYPES.includes(str(body.agencyType, 40)) ? str(body.agencyType, 40) : 'Other';
  const record = {
    email,
    name,
    source: str(body.source, 60) || 'gov-apex',
    // `company` is a first-class leads column — put the APEX there so it shows in
    // any existing lead view without needing to open the JSON.
    company: org,
    // The introduction detail goes in `context` — the leads table's existing JSON
    // column. There is NO `metadata` column; assuming one would have failed the
    // insert at the booth. Verified against the live schema.
    context: {
      kind: 'apex_buyer_introduction',
      apex_accelerator: org,
      phone: str(body.phone, 40) || null,
      buying_organization: buyer,
      agency_type: agencyType,
      primary_challenge: str(body.challenge, 80) || null,
      has_requirement: str(body.hasRequirement, 10) || 'No',
      notes: str(body.notes, 2000) || null,
      submitted_at: new Date().toISOString(),
    },
  };

  const sb = getSupabase();
  if (!sb) {
    // No DB configured — alert with the full payload rather than silently
    // dropping a conference introduction on the floor.
    console.error('[gov/apex-intro] no supabase client');
    await sendOpsAlert({
      subject: `APEX introduction NOT saved (no DB) — ${org} → ${buyer}`,
      html: `<pre>${JSON.stringify(record, null, 2)}</pre>`,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Could not save — we have been alerted' }, { status: 500 });
  }

  const { error } = await sb.from('leads').insert(record);
  if (error) {
    // Surface it AND still alert — losing a conference introduction to a schema
    // error would be the worst possible failure here.
    console.error('[gov/apex-intro] insert failed:', error.message);
    await sendOpsAlert({
      subject: `APEX introduction could NOT be saved — ${org} → ${buyer}`,
      html: `<p>DB insert failed: <code>${error.message}</code></p><pre>${JSON.stringify(record, null, 2)}</pre>`,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Could not save — we have been alerted' }, { status: 500 });
  }

  // Fire-and-forget: a Slack failure must not fail the counselor's submission.
  sendOpsAlert({
    subject: `APEX introduction: ${org} → ${buyer}`,
    html:
      `<p><b>${name}</b> (${org}) is introducing <b>${buyer}</b> — ${agencyType}.</p>`
      + `<p>Challenge: ${record.context.primary_challenge ?? '—'} · Requirement already identified: ${record.context.has_requirement}</p>`
      + `<p>Reply to: ${email}${record.context.phone ? ` · ${record.context.phone}` : ''}</p>`
      + (record.context.notes ? `<p>Notes: ${record.context.notes}</p>` : '')
      + `<p>Source: <code>${record.source}</code></p>`,
  }).catch((e) => console.error('[gov/apex-intro] alert failed:', e));

  return NextResponse.json({ success: true });
}
