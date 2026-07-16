/**
 * /api/mcp/crm-connection — manage the signed-in MCP user's CRM connection (the
 * GoHighLevel credential that add_contacts_to_crm writes through). Token-only auth
 * via resolveMcpEmail (same as the other /api/mcp/* account routes).
 *
 *   GET    → { connected, provider?, location_id?, provisioned?, ... }  (never the token)
 *   POST   { token, location_id } → verifies against GHL, then saves (encrypted)
 *   DELETE → removes the connection
 *
 * The token is a GHL Private Integration Token with contacts.write scope. It is
 * encrypted at rest (secretbox) and never returned to the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getCrmConnectionStatus, saveCrmConnection, deleteCrmConnection } from '@/lib/crm/connections';
import { verifyGhlConnection } from '@/lib/ghl/contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const status = await getCrmConnectionStatus(email);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { token?: string; location_id?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const token = (body.token || '').trim();
  const locationId = (body.location_id || '').trim();
  if (!token || !locationId) {
    return NextResponse.json({ error: 'token and location_id are required' }, { status: 400 });
  }

  // Verify the credential actually works before saving (immediate feedback).
  const check = await verifyGhlConnection(token, locationId);
  if (!check.ok) {
    return NextResponse.json(
      { error: `Could not reach GoHighLevel with that token + location (${check.error || 'unknown'}). Check the token has contacts scope and the Location ID is correct.` },
      { status: 400 },
    );
  }

  try {
    await saveCrmConnection(email, { token, locationId, provider: 'ghl', provisioned: false, label: body.label ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'save failed' }, { status: 500 });
  }
  return NextResponse.json({ connected: true, provider: 'ghl', location_id: locationId });
}

export async function DELETE(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await deleteCrmConnection(email);
  return NextResponse.json({ connected: false });
}
