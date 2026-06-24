/**
 * Backfill alert_recipient_email for EXISTING Coach-Mode clients.
 *
 * Clients added before the add-time auto-route fix have a real primary_email on
 * org_clients but a null alert_recipient_email on their notification row — so their
 * alerts route to the synthetic {workspaceId}@clients.getmindy.ai address, which is
 * now guarded out of sendEmail() (no bounce) but also undelivered. This copies the
 * coach-supplied primary_email onto the notification row so those clients' daily/
 * weekly alerts start flowing to their real inbox.
 *
 * GET  ?password=...            → dry-run: how many rows WOULD update (+ sample)
 * POST ?password=...&mode=execute → apply the update
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clientNotificationEmail } from '@/lib/app/workspace';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Coach-supplied email → deliverable recipient, or null (mirrors coach/route). */
function recipientFromPrimary(primaryEmail?: string | null): string | null {
  const e = (primaryEmail || '').trim().toLowerCase();
  if (!e || !e.includes('@') || e.endsWith('@clients.getmindy.ai')) return null;
  return e;
}

interface Candidate {
  workspaceId: string;
  businessName: string | null;
  clientEmail: string;       // synthetic notification-row key
  primaryEmail: string;      // where alerts SHOULD go
  currentRecipient: string | null;
}

/** Find active clients with a real primary_email whose notification row has no
 *  alert_recipient_email yet. Returns the rows that a backfill would update. */
async function findCandidates(): Promise<{ candidates: Candidate[]; scannedClients: number; missingProfileRow: number }> {
  const supabase = getSupabase();

  // 1) Active clients that carry a deliverable email.
  const { data: clients } = await supabase
    .from('org_clients')
    .select('workspace_id, business_name, primary_email, status')
    .eq('status', 'active');

  const withEmail = (clients || [])
    .map((c) => ({ ...c, recipient: recipientFromPrimary(c.primary_email as string | null) }))
    .filter((c) => c.workspace_id && c.recipient);

  if (withEmail.length === 0) {
    return { candidates: [], scannedClients: (clients || []).length, missingProfileRow: 0 };
  }

  // 2) Pull their notification rows and keep only those missing a recipient.
  const emailToClient = new Map<string, { workspaceId: string; businessName: string | null; recipient: string }>();
  for (const c of withEmail) {
    emailToClient.set(clientNotificationEmail(c.workspace_id as string), {
      workspaceId: c.workspace_id as string,
      businessName: (c.business_name as string) || null,
      recipient: c.recipient as string,
    });
  }
  const clientEmails = Array.from(emailToClient.keys());

  const { data: rows } = await supabase
    .from('user_notification_settings')
    .select('user_email, alert_recipient_email')
    .in('user_email', clientEmails);

  const haveRow = new Set((rows || []).map((r) => r.user_email as string));
  const missingProfileRow = clientEmails.filter((e) => !haveRow.has(e)).length;

  const candidates: Candidate[] = [];
  for (const r of rows || []) {
    const current = (r.alert_recipient_email as string | null) || null;
    if (current && current.trim()) continue;   // already set — skip
    const meta = emailToClient.get(r.user_email as string);
    if (!meta) continue;
    candidates.push({
      workspaceId: meta.workspaceId,
      businessName: meta.businessName,
      clientEmail: r.user_email as string,
      primaryEmail: meta.recipient,
      currentRecipient: current,
    });
  }

  return { candidates, scannedClients: (clients || []).length, missingProfileRow };
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const { candidates, scannedClients, missingProfileRow } = await findCandidates();
  return NextResponse.json({
    success: true,
    message: `Dry-run: ${candidates.length} client row(s) would get alert_recipient_email set. POST ?mode=execute to apply.`,
    data: {
      mode: 'preview',
      scannedActiveClients: scannedClients,
      wouldUpdate: candidates.length,
      missingProfileRow,
      sample: candidates.slice(0, 25).map((c) => ({
        client: c.businessName,
        deliverTo: c.primaryEmail,
        notificationKey: c.clientEmail,
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get('mode') !== 'execute') {
    return NextResponse.json(
      { success: false, message: 'Add ?mode=execute to apply the backfill (GET for a dry-run first).' },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const { candidates } = await findCandidates();
  const errors: string[] = [];
  let updated = 0;

  for (const c of candidates) {
    const { error } = await supabase
      .from('user_notification_settings')
      .update({ alert_recipient_email: c.primaryEmail })
      .eq('user_email', c.clientEmail);
    if (error) errors.push(`${c.clientEmail}: ${error.message}`);
    else updated++;
  }

  return NextResponse.json({
    success: errors.length === 0,
    message: `Backfilled alert_recipient_email for ${updated}/${candidates.length} client row(s).`,
    data: { mode: 'execute', updated, attempted: candidates.length },
    ...(errors.length > 0 ? { errors } : {}),
  });
}
