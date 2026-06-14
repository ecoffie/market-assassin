/**
 * /api/app/disa/notice-docx?email=&id=
 *
 * Generate the incumbent expiry notice for ONE watched vehicle as a clean,
 * official-looking .docx — a tangible leave-behind for the DISA demo. Editable,
 * looks like a real contracting-office memo. Still a notice DISA APPROVES before
 * any send; this just makes it hand-able. (DISA-VEHICLE-WATCH-SPEC.md)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { currentStage, buildIncumbentNotice, daysUntil, type WatchedVehicle } from '@/lib/disa/vehicle-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const id = request.nextUrl.searchParams.get('id');
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id are required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const sb = getSupabase();
  const { data: v, error } = await sb
    .from('disa_watched_vehicles')
    .select('*')
    .eq('org_email', email)
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!v) return NextResponse.json({ success: false, error: 'vehicle not found' }, { status: 404 });

  const vehicle = v as WatchedVehicle;
  const now = new Date();
  // If past all windows, still produce a notice at the closest stage so the
  // leave-behind is always generatable; default to 6mo framing otherwise.
  const stage = currentStage(vehicle, now) || '6mo';
  const notice = buildIncumbentNotice(vehicle, stage, now);
  const d = daysUntil(vehicle.expiration_date, now);
  const today = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const body = (text: string, opts: { bold?: boolean; size?: number } = {}) =>
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 22 })] });

  const children: Paragraph[] = [];

  // Header — looks like an official notice memo.
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'NOTICE OF CONTRACT VEHICLE EXPIRATION', bold: true, size: 26 })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: 'Automated Vehicle Tracking — Incumbent Notification', italics: true, size: 18, color: '666666' })],
  }));

  children.push(body(`Date: ${today}`));
  children.push(body(`To: ${vehicle.incumbent_name || '[Incumbent Contractor]'}${vehicle.incumbent_email ? `  (${vehicle.incumbent_email})` : ''}`));
  children.push(body(`Re: Contract Vehicle ${vehicle.vehicle_piid}${vehicle.vehicle_title ? ` — ${vehicle.vehicle_title}` : ''}`, { bold: true }));
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));

  // Key facts block
  children.push(body('SUMMARY', { bold: true }));
  children.push(body(`Contract / Vehicle Number: ${vehicle.vehicle_piid}`));
  if (vehicle.naics) children.push(body(`NAICS: ${vehicle.naics}`));
  children.push(body(`Period of Performance Ends: ${vehicle.expiration_date || '[expiration date]'}`));
  if (typeof d === 'number') children.push(body(`Time Remaining: approximately ${d} days`));
  if (vehicle.ceiling_value) children.push(body(`Contract Ceiling: $${Number(vehicle.ceiling_value).toLocaleString()}`));
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));

  // The notice body (same text the system would send).
  children.push(body('NOTICE', { bold: true }));
  for (const line of notice.body.split('\n')) {
    children.push(line.trim() ? body(line) : new Paragraph({ spacing: { after: 80 }, children: [] }));
  }

  children.push(new Paragraph({ spacing: { before: 240 }, children: [
    new TextRun({ text: 'Generated automatically from the vehicle tracking system — review before distribution.', italics: true, size: 16, color: '999999' }),
  ] }));

  const doc = new Document({
    creator: 'Vehicle Expiry Watch',
    title: `Expiry Notice — ${vehicle.vehicle_piid}`,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `expiry-notice-${(vehicle.vehicle_piid || 'vehicle').replace(/[^a-z0-9-_.]/gi, '_')}.docx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
