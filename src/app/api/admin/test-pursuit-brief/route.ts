/**
 * Admin: Test Pursuit Brief Generation
 *
 * GET /api/admin/test-pursuit-brief?password=...&email=user@example.com&contract=W91RUS18C0024
 *
 * Or POST with opportunity details in body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generatePursuitBrief } from '@/lib/briefings/delivery/pursuit-brief-generator';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const contractNumber = searchParams.get('contract');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  // If contract number provided, look it up in snapshots
  let opportunity: Record<string, unknown> = {};

  if (contractNumber) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Search in recompete snapshots
    const { data: snapshots } = await supabase
      .from('briefing_snapshots')
      .select('raw_data')
      .eq('user_email', email)
      .eq('tool', 'recompete')
      .order('snapshot_date', { ascending: false })
      .limit(1);

    if (snapshots?.[0]?.raw_data) {
      const data = snapshots[0].raw_data as { contracts?: unknown[] };
      const contracts = data.contracts || [];
      const found = contracts.find((c: unknown) => {
        const contract = c as Record<string, unknown>;
        return contract.contractNumber === contractNumber || contract.piid === contractNumber;
      });
      if (found) {
        opportunity = found as Record<string, unknown>;
      }
    }
  }

  // If no contract found, use mock data for testing
  if (Object.keys(opportunity).length === 0) {
    opportunity = {
      contractName: 'Navy NIWC Cyberspace Operations Support',
      contractNumber: contractNumber || 'N66001-21-C-0001',
      agency: 'Navy / NIWC Pacific',
      incumbent: 'BAE, Booz Allen, Leidos, SAIC, Peraton',
      value: 500000000,
      naicsCode: '541512',
      description: 'Cyberspace operations support services including defensive cyber operations, vulnerability assessments, and incident response for Navy networks.',
      deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
    };
  }

  try {
    console.log(`[TestPursuitBrief] Generating for ${opportunity.contractName || contractNumber}...`);

    const brief = await generatePursuitBrief(email, opportunity);

    if (!brief) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate pursuit brief - check profile or OpenAI config',
      });
    }

    return NextResponse.json({
      success: true,
      email,
      contractName: brief.contractName,
      opportunityScore: brief.opportunityScore,
      processingTimeMs: brief.processingTimeMs,
      brief,
    });

  } catch (err) {
    console.error('[TestPursuitBrief] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  try {
    const opportunity = await request.json();

    console.log(`[TestPursuitBrief] POST - Generating for ${opportunity.contractName}...`);

    const brief = await generatePursuitBrief(email, opportunity);

    if (!brief) {
      return NextResponse.json({
        success: false,
        error: 'Failed to generate pursuit brief',
      });
    }

    return NextResponse.json({
      success: true,
      email,
      contractName: brief.contractName,
      opportunityScore: brief.opportunityScore,
      processingTimeMs: brief.processingTimeMs,
      brief,
    });

  } catch (err) {
    console.error('[TestPursuitBrief] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
    }, { status: 500 });
  }
}
