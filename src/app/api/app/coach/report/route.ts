/**
 * /api/app/coach/report — Quarterly Funder Report export (PRD §4).
 *
 * Org-admin only. Rolls up businesses served + capability milestones + pipeline outcomes
 * for a quarter across ALL the org's clients, and returns CSV (always) or PDF.
 *
 * GET ?email=&quarter=YYYY-Qn&format=csv|pdf|html
 *
 * Isolation: reads org_clients / client_milestones / user_pipeline (all org-scoped by the
 * org's own workspace_ids). Writes nothing. Only reachable by an org_admin member.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  parseQuarter,
  buildFunderReport,
  reportToCsv,
  reportToHtml,
} from '@/lib/mindy/funder-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Cap the rollup so a huge org can't build an unbounded query. GCAP ~1,000; headroom to 5k.
const REPORT_CLIENT_CAP = 5000;

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const quarterParam = request.nextUrl.searchParams.get('quarter') || '';
  const format = (request.nextUrl.searchParams.get('format') || 'csv').toLowerCase();
  const quarter = parseQuarter(quarterParam);
  if (!quarter) {
    return NextResponse.json({ success: false, error: 'quarter must be YYYY-Qn (e.g. 2026-Q1)' }, { status: 400 });
  }

  const supabase = sb();

  // Org-admin only — the funder report is an org-wide rollup, not a coach's slice.
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_email', email)
    .eq('status', 'active')
    .eq('role', 'org_admin')
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ success: false, error: 'Org admin access required' }, { status: 403 });
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', membership.org_id)
    .maybeSingle();

  const { data: clientRows } = await supabase
    .from('org_clients')
    .select('workspace_id, business_name, assigned_coach')
    .eq('org_id', membership.org_id)
    .eq('status', 'active')
    .limit(REPORT_CLIENT_CAP);
  const clients = (clientRows || []).map((c: Record<string, unknown>) => ({
    businessName: c.business_name as string,
    workspaceId: c.workspace_id as string,
    assignedCoach: (c.assigned_coach as string) || null,
  }));
  const workspaceIds = clients.map((c: { workspaceId: string }) => c.workspaceId);

  let milestoneRows: Array<Record<string, unknown>> = [];
  let pipelineRows: Array<Record<string, unknown>> = [];
  if (workspaceIds.length) {
    const [ms, pl] = await Promise.all([
      supabase
        .from('client_milestones')
        .select('workspace_id, milestone_key, achieved_at')
        .in('workspace_id', workspaceIds),
      supabase
        .from('user_pipeline')
        .select('workspace_id, stage, outcome_date, updated_at, created_at')
        .in('workspace_id', workspaceIds),
    ]);
    milestoneRows = ms.data || [];
    pipelineRows = pl.data || [];
  }

  const report = buildFunderReport({
    quarter,
    orgName: (org?.name as string) || 'Organization',
    generatedAt: new Date().toISOString(),
    clients,
    milestoneRows: milestoneRows as Parameters<typeof buildFunderReport>[0]['milestoneRows'],
    pipelineRows: pipelineRows as Parameters<typeof buildFunderReport>[0]['pipelineRows'],
  });

  const safeName = report.orgName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const base = `funder-report-${safeName}-${report.quarter}`;

  if (format === 'csv') {
    return new NextResponse(reportToCsv(report), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
      },
    });
  }

  const html = reportToHtml(report);
  if (format === 'html') {
    return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (format === 'pdf') {
    // Render via Puppeteer. If Chromium can't launch in this environment, degrade to the
    // printable HTML rather than 500 — the counselor can still Print-to-PDF from the browser.
    try {
      const puppeteer = (await import('puppeteer')).default;
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16px', bottom: '16px', left: '16px', right: '16px' } });
        return new NextResponse(Buffer.from(pdf), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${base}.pdf"`,
          },
        });
      } finally {
        await browser.close();
      }
    } catch {
      // Graceful fallback: serve printable HTML with a header the client can detect.
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-PDF-Fallback': 'print-html' },
      });
    }
  }

  return NextResponse.json({ success: false, error: 'format must be csv, pdf, or html' }, { status: 400 });
}
